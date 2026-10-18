// Day 13 fault injection. The PayPal-client faults (429 then 200, expired token, 12MB file)
// are covered in packages/paypal; duplicate webhook deliveries in apps/api.
import type { PayPalClient } from "@rebuttal/paypal";
import { beforeEach, describe, expect, it } from "vitest";
import { executeDecision } from "../src/jobs/execute.js";
import { POLL_CURSOR, pollDisputes } from "../src/jobs/poll.js";
import { syncDispute } from "../src/jobs/sync.js";
import { QUEUES } from "../src/queues.js";
import { clock, setupTestEnv, type TestEnv } from "./helpers.js";

const fresh = setupTestEnv();
let t: TestEnv;
beforeEach(async () => {
  t = await fresh();
});

describe("chaos", () => {
  it("the same dispute synced 5 times produces one Case and one CREATED event", async () => {
    for (let i = 0; i < 5; i++) await syncDispute(t.deps, "PP-D-90001");
    expect(await t.db.case.count()).toBe(1);
    expect(await t.db.caseEvent.count({ where: { type: "CREATED" } })).toBe(1);
  });

  it("concurrent syncs of a new dispute still create one Case", async () => {
    await Promise.all(Array.from({ length: 5 }, () => syncDispute(t.deps, "PP-D-90002")));
    expect(await t.db.case.count()).toBe(1);
    expect(await t.db.caseEvent.count({ where: { type: "CREATED" } })).toBe(1);
  });

  it("worker dies after PayPal accepted the call: the rerun is a no-op at PayPal", async () => {
    const { caseId } = await syncDispute(t.deps, "PP-D-90002");
    const d = await t.db.decision.create({
      data: { caseId, option: "OFFER", status: "APPROVED", note: "Partial refund", offerAmountCents: 1200 },
    });

    // PayPal applies the offer, then the process "dies" before the response comes back.
    const dying: PayPalClient = {
      ...t.sim,
      disputes: {
        ...t.sim.disputes,
        makeOffer: async (...args) => {
          await t.sim.disputes.makeOffer(...args);
          return new Promise(() => {}); // never resolves
        },
      },
    };
    t.usePayPal(dying);
    void executeDecision(t.deps, d.id, { retryCount: 0, retryLimit: 6 });
    await expect.poll(() => t.sim.sim.state().calls.length).toBe(1);
    expect((await t.db.action.findFirstOrThrow({ where: { decisionId: d.id } })).status).toBe("IN_FLIGHT");

    // pg-boss hands the expired job to a fresh worker.
    t.usePayPal(t.sim);
    expect((await executeDecision(t.deps, d.id, { retryCount: 1, retryLimit: 6 })).status).toBe("succeeded");
    const s = t.sim.sim.state();
    expect(s.calls.map((c) => c.idempotencyKey)).toEqual([
      `${caseId}:${d.id}:MAKE_OFFER`,
      `${caseId}:${d.id}:MAKE_OFFER`,
    ]);
    expect(Object.keys(s.writes)).toEqual([`${caseId}:${d.id}:MAKE_OFFER`]); // applied once
    expect(await t.db.action.count({ where: { caseId, status: "SUCCEEDED" } })).toBe(1);
  });

  it("with webhooks down, polling finds a new dispute within 60s", async () => {
    await pollDisputes(t.deps);
    t.queue.sent.length = 0;
    // A buyer opens a dispute 10s after the last poll; no webhook ever arrives.
    const template = t.sim.sim.state().disputes["PP-D-90001"]!;
    const openedAt = new Date(clock.now.getTime() + 10_000).toISOString();
    t.sim.sim.createDispute({
      ...template,
      dispute_id: "PP-D-NEW1",
      create_time: openedAt,
      update_time: openedAt,
    });

    clock.now = new Date(clock.now.getTime() + 60_000); // the next cron tick
    await pollDisputes(t.deps);
    const syncs = t.queue.take(QUEUES.disputeSync);
    expect(syncs.map((s) => s.data["disputeId"])).toEqual(["PP-D-NEW1"]);
    await syncDispute(t.deps, "PP-D-NEW1");
    expect(await t.db.case.count({ where: { paypalDisputeId: "PP-D-NEW1" } })).toBe(1);
    expect((await t.db.syncCursor.findUniqueOrThrow({ where: { key: POLL_CURSOR } })).value).toBe(
      clock.now.toISOString(),
    );
  });
});
