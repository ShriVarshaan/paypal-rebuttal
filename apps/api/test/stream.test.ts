import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@rebuttal/db";
import { createSimulatorClient } from "@rebuttal/paypal";
import { createTestDatabase } from "@rebuttal/testkit";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, expect, inject, it } from "vitest";
import { buildApp } from "../src/app.js";
import { apiConfigFromEnv } from "../src/config.js";

let db: Db;
let drop: () => Promise<void>;
let api: FastifyInstance;
let base: string;

beforeAll(async () => {
  const t = await createTestDatabase(inject("pgAdminUrl"));
  db = createDb(t.url);
  drop = t.drop;
  api = await buildApp(
    {
      db,
      paypal: createSimulatorClient({
        stateFile: join(mkdtempSync(join(tmpdir(), "rebuttal-sse-")), "s.json"),
      }),
      queue: { send: async () => "job", cancel: async () => {} },
      config: { ...apiConfigFromEnv({}), apiToken: "t" },
      checkQueue: async () => {},
    },
    { logger: false },
  );
  base = await api.listen({ port: 0, host: "127.0.0.1" });
});
afterAll(async () => {
  await api?.close();
  await db?.$disconnect();
  await drop?.();
});

/** Reads the SSE body until `match` appears or the timeout passes. */
async function readUntil(
  body: ReadableStream<Uint8Array>,
  match: RegExp,
  timeoutMs = 8_000,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  // One read stays pending across timeouts; a dropped read would swallow its chunk.
  let pending: ReturnType<typeof reader.read> | null = null;
  try {
    while (Date.now() < deadline && !match.test(text)) {
      pending ??= reader.read();
      const chunk = await Promise.race([pending, new Promise<null>((r) => setTimeout(() => r(null), 500))]);
      if (!chunk) continue;
      pending = null;
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text;
}

it("needs the token and pushes new case events and notifications", { timeout: 20_000 }, async () => {
  expect((await fetch(`${base}/events/stream`)).status).toBe(401);
  const res = await fetch(`${base}/events/stream`, { headers: { authorization: "Bearer t" } });
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  expect(await readUntil(res.body!, /event: ready/)).toContain("event: ready");

  const live = await fetch(`${base}/events/stream`, { headers: { authorization: "Bearer t" } });
  const c = await db.case.create({
    data: {
      paypalDisputeId: "PP-D-SSE1",
      reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
      status: "OPEN",
      stage: "INQUIRY",
      amountCents: 4900,
      currency: "USD",
      disputedTransactions: [],
      messages: [],
      raw: {},
      paypalCreatedAt: new Date(),
      paypalUpdatedAt: new Date(),
    },
  });
  await db.caseEvent.create({ data: { caseId: c.id, type: "CREATED", payload: {} } });
  await db.notification.create({
    data: { caseId: c.id, kind: "SLA_REMINDER", level: "warning", message: "6h left" },
  });
  const text = await readUntil(live.body!, /event: notification[\s\S]*6h left/);
  expect(text).toMatch(/event: case\ndata: .*"type":"CREATED".*"paypalDisputeId":"PP-D-SSE1"/);
  expect(text).toContain("6h left");
});

const auth = { authorization: "Bearer t" };
async function newCase(paypalDisputeId: string) {
  return db.case.create({
    data: {
      paypalDisputeId,
      reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
      status: "OPEN",
      stage: "INQUIRY",
      amountCents: 4900,
      currency: "USD",
      disputedTransactions: [],
      messages: [],
      raw: {},
      paypalCreatedAt: new Date(),
      paypalUpdatedAt: new Date(),
    },
  });
}

it("delivers a row whose transaction committed after a newer one was sent", { timeout: 20_000 }, async () => {
  const c = await newCase("PP-D-SSE2");
  const live = await fetch(`${base}/events/stream`, { headers: auth });
  await new Promise((r) => setTimeout(r, 300));
  const sentFirst = await db.caseEvent.create({ data: { caseId: c.id, type: "GATHERED", payload: {} } });
  // Stamped before the event above but only visible after it was streamed, like the insert
  // of a slower transaction that committed later.
  await new Promise((r) => setTimeout(r, 2_000));
  await db.caseEvent.create({
    data: {
      caseId: c.id,
      type: "DECISION_PROPOSED",
      payload: {},
      createdAt: new Date(sentFirst.createdAt.getTime() - 1),
    },
  });
  const text = await readUntil(live.body!, /"type":"DECISION_PROPOSED"/);
  expect(text).toContain('"type":"GATHERED"');
  expect(text).toContain('"type":"DECISION_PROPOSED"');
});

it("sends every row of a burst bigger than one page, in both tables", { timeout: 30_000 }, async () => {
  const c = await newCase("PP-D-SSE3");
  const live = await fetch(`${base}/events/stream`, { headers: auth });
  await new Promise((r) => setTimeout(r, 300));
  const at = new Date();
  await db.caseEvent.createMany({
    data: Array.from({ length: 250 }, (_, i) => ({
      caseId: c.id,
      type: "GATHERED",
      payload: { i },
      createdAt: new Date(at.getTime() + (i % 3)),
    })),
  });
  await db.notification.create({
    data: { caseId: c.id, kind: "SLA_REMINDER", level: "warning", message: "burst done", createdAt: at },
  });
  // One tick pages through every case event before it sends the notification.
  const text = await readUntil(live.body!, /burst done/, 10_000);
  expect(text.match(/event: case\n/g)?.length).toBe(250);
});

it("resumes after Last-Event-ID without replaying what the client saw", { timeout: 20_000 }, async () => {
  const c = await newCase("PP-D-SSE4");
  const first = await fetch(`${base}/events/stream`, { headers: auth });
  await new Promise((r) => setTimeout(r, 300));
  await db.caseEvent.create({ data: { caseId: c.id, type: "ENRICHED", payload: {} } });
  const seen = await readUntil(first.body!, /"type":"ENRICHED"[^\n]*\n\n/);
  const lastId = [...seen.matchAll(/^id: (.+)$/gm)].at(-1)?.[1];
  expect(lastId).toMatch(/^\S+\|\S+$/);
  // Written while the client is disconnected.
  await db.caseEvent.create({ data: { caseId: c.id, type: "TRIAGED", payload: {} } });
  const resumed = await fetch(`${base}/events/stream`, { headers: { ...auth, "last-event-id": lastId! } });
  const text = await readUntil(resumed.body!, /"type":"TRIAGED"/);
  expect(text).toContain('"type":"TRIAGED"');
  expect(text).not.toContain('"type":"ENRICHED"');
});
