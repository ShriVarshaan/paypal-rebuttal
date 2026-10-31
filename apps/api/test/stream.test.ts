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
