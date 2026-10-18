import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@rebuttal/db";
import { createSimulatorClient } from "@rebuttal/paypal";
import { createTestDatabase } from "@rebuttal/testkit";
import type { JobQueue } from "@rebuttal/worker";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { buildApp } from "../src/app.js";
import { apiConfigFromEnv } from "../src/config.js";

let db: Db;
let drop: () => Promise<void>;
let api: FastifyInstance;
const sent: { name: string; data: object }[] = [];
const queue: JobQueue = {
  send: async (name, data) => (sent.push({ name, data }), "job"),
  cancel: async () => {},
};
const headers = { authorization: "Bearer t" };

beforeAll(async () => {
  const t = await createTestDatabase(inject("pgAdminUrl"));
  db = createDb(t.url);
  drop = t.drop;
  const paypal = createSimulatorClient({
    stateFile: join(mkdtempSync(join(tmpdir(), "rebuttal-api-b-")), "s.json"),
  });
  api = await buildApp(
    { db, paypal, queue, config: { ...apiConfigFromEnv({}), apiToken: "t" }, checkQueue: async () => {} },
    { logger: false },
  );
});
afterAll(async () => {
  await api?.close();
  await db?.$disconnect();
  await drop?.();
});
beforeEach(async () => {
  sent.length = 0;
  await db.$executeRawUnsafe(`TRUNCATE "Decision", "CaseEvent", "Case", "Policy", "AgentRun" CASCADE`);
});

async function seed(option: "FIGHT" | "OFFER" = "OFFER") {
  const c = await db.case.create({
    data: {
      paypalDisputeId: "PP-D-90002",
      reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
      status: "WAITING_FOR_SELLER_RESPONSE",
      stage: "INQUIRY",
      amountCents: 6450,
      currency: "USD",
      disputedTransactions: [{ items: [{ name: "Waxed canvas jacket", quantity: "1" }] }],
      messages: [],
      raw: {},
      paypalCreatedAt: new Date("2026-10-16T17:40:02Z"),
      paypalUpdatedAt: new Date("2026-10-16T17:40:02Z"),
    },
  });
  const d = await db.decision.create({
    data: {
      caseId: c.id,
      option,
      note: "n",
      ...(option === "OFFER" ? { offerType: "REFUND", offerAmountCents: 3900 } : {}),
    },
  });
  return { c, d };
}

describe("policy routes", () => {
  it("returns defaults, then stores a validated partial policy", async () => {
    const before = (await api.inject({ method: "GET", url: "/policy", headers })).json();
    expect(before).toMatchObject({ isDefault: true, policy: { autonomy: { maxAmountCents: 5000 } } });

    const put = await api.inject({
      method: "PUT",
      url: "/policy",
      headers,
      payload: { policy: { autonomy: { maxAmountCents: 10000 } }, updatedBy: "owner" },
    });
    expect(put.statusCode).toBe(200);
    const after = (await api.inject({ method: "GET", url: "/policy", headers })).json();
    expect(after).toMatchObject({
      isDefault: false,
      policy: { autonomy: { maxAmountCents: 10000, minPWinToFight: 0.8 } },
    });
  });

  it("rejects an LLM bound above ±0.10 and requires the token", async () => {
    const bad = await api.inject({
      method: "PUT",
      url: "/policy",
      headers,
      payload: { policy: { llm: { maxAdjustment: 0.5 } } },
    });
    expect(bad.statusCode).toBe(400);
    expect((await api.inject({ method: "GET", url: "/policy" })).statusCode).toBe(401);
  });
});

describe("decision edits", () => {
  it("edits an offer amount and records the change", async () => {
    const { c, d } = await seed();
    const r = await api.inject({
      method: "PATCH",
      url: `/decisions/${d.id}`,
      headers,
      payload: { offerAmountCents: 3000, editedBy: "owner" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ offerAmountCents: 3000, option: "OFFER", status: "PROPOSED" });
    const ev = await db.caseEvent.findFirstOrThrow({ where: { caseId: c.id, type: "DECISION_EDITED" } });
    expect(ev.payload).toMatchObject({ editedBy: "owner", override: false, to: { offerAmountCents: 3000 } });
  });

  it("an override to ACCEPT needs a new note and clears the offer", async () => {
    const { d } = await seed();
    expect(
      (
        await api.inject({
          method: "PATCH",
          url: `/decisions/${d.id}`,
          headers,
          payload: { option: "ACCEPT" },
        })
      ).statusCode,
    ).toBe(400);
    const r = await api.inject({
      method: "PATCH",
      url: `/decisions/${d.id}`,
      headers,
      payload: { option: "ACCEPT", note: "Refunded in full." },
    });
    expect(r.json()).toMatchObject({
      option: "ACCEPT",
      offerType: null,
      offerAmountCents: null,
      note: "Refunded in full.",
    });
  });

  it("refuses offers above the disputed amount and edits after approval", async () => {
    const { d } = await seed();
    expect(
      (
        await api.inject({
          method: "PATCH",
          url: `/decisions/${d.id}`,
          headers,
          payload: { offerAmountCents: 9999 },
        })
      ).statusCode,
    ).toBe(400);
    await db.decision.update({ where: { id: d.id }, data: { status: "APPROVED" } });
    expect(
      (await api.inject({ method: "PATCH", url: `/decisions/${d.id}`, headers, payload: { note: "x" } }))
        .statusCode,
    ).toBe(409);
  });
});

describe("triage and buyer message", () => {
  it("queues a re-triage", async () => {
    const { c } = await seed();
    const r = await api.inject({ method: "POST", url: `/cases/${c.id}/triage`, headers });
    expect(r.statusCode).toBe(202);
    expect(sent).toEqual([{ name: "case.triage", data: { caseId: c.id } }]);
    expect((await api.inject({ method: "POST", url: `/cases/nope/triage`, headers })).statusCode).toBe(404);
  });

  it("drafts a buyer message for the current offer (template without a key)", async () => {
    const { c, d } = await seed();
    const r = (await api.inject({ method: "POST", url: `/cases/${c.id}/buyer-message`, headers })).json();
    expect(r).toMatchObject({ source: "template", decisionId: d.id, error: null });
    expect(r.message).toContain("$39.00");
    expect(r.message).toContain("Waxed canvas jacket");
  });
});

describe("agent metrics", () => {
  it("summarizes spend and latency per agent", async () => {
    const { c } = await seed();
    const run = (agent: string, costUsd: number, latencyMs: number) => ({
      caseId: c.id,
      agent,
      model: "claude-opus-5-5",
      inputTokens: 1000,
      outputTokens: 100,
      costUsd,
      latencyMs,
    });
    await db.agentRun.createMany({
      data: [run("triage", 0.02, 900), run("triage", 0.04, 1500), run("narrative", 0.03, 2000)],
    });
    const r = (await api.inject({ method: "GET", url: "/metrics/agents", headers })).json();
    expect(r).toMatchObject({ calls: 3, cases: 1 });
    expect(r.totalCostUsd).toBeCloseTo(0.09);
    expect(r.costPerCaseUsd).toBeCloseTo(0.09);
    expect(r.byAgent).toEqual([
      expect.objectContaining({ agent: "narrative", calls: 1, p50LatencyMs: 2000 }),
      expect.objectContaining({ agent: "triage", calls: 2, p50LatencyMs: 1500, p95LatencyMs: 1500 }),
    ]);
  });
});
