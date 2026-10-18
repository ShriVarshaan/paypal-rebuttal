import { beforeEach, describe, expect, it } from "vitest";
import { pollDisputes } from "../src/jobs/poll.js";
import { syncDispute } from "../src/jobs/sync.js";
import { QUEUES } from "../src/queues.js";
import { clock, setupTestEnv, type TestEnv } from "./helpers.js";

const fresh = setupTestEnv();
let t: TestEnv;
beforeEach(async () => {
  t = await fresh();
});

const events = async (caseId: string) =>
  (await t.db.caseEvent.findMany({ where: { caseId }, orderBy: { createdAt: "asc" } })).map((e) => e.type);

describe("dispute.sync", () => {
  it("creates a Case, a CREATED event, the enrich job and SLA jobs", async () => {
    const r = await syncDispute(t.deps, "PP-D-90001");
    expect(r.created).toBe(true);
    const c = await t.db.case.findUniqueOrThrow({ where: { paypalDisputeId: "PP-D-90001" } });
    expect(c).toMatchObject({
      state: "NEW",
      amountCents: 8900,
      currency: "USD",
      sellerTransactionId: "3VK13355SM0012345",
    });
    expect(await events(c.id)).toEqual(["CREATED"]);
    expect(t.queue.take(QUEUES.caseEnrich).map((s) => s.data)).toEqual([{ caseId: c.id }]);
    const sla = await t.db.slaJob.findMany({ where: { caseId: c.id }, orderBy: { runAt: "asc" } });
    expect(sla.map((j) => [j.kind, j.runAt.toISOString()])).toEqual([
      ["REMIND_72H", "2026-10-26T23:59:59.000Z"],
      ["REMIND_24H", "2026-10-28T23:59:59.000Z"],
      ["REMIND_6H", "2026-10-29T17:59:59.000Z"],
      ["FORCE_DECISION", "2026-10-29T21:59:59.000Z"],
    ]);
  });

  it("writes nothing when nothing changed", async () => {
    await syncDispute(t.deps, "PP-D-90001");
    const before = await t.db.case.findUniqueOrThrow({ where: { paypalDisputeId: "PP-D-90001" } });
    t.queue.sent.length = 0;
    const r = await syncDispute(t.deps, "PP-D-90001");
    expect(r.events).toEqual([]);
    const after = await t.db.case.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(await events(before.id)).toEqual(["CREATED"]);
    expect(t.queue.sent).toEqual([]);
  });

  it("emits STATUS_CHANGED and reschedules SLA when the due date moves", async () => {
    const { caseId } = await syncDispute(t.deps, "PP-D-90002");
    const oldJobs = await t.db.slaJob.findMany({ where: { caseId } });
    clock.now = new Date("2026-10-21T00:00:00Z");
    await t.sim.disputes.requireEvidence("PP-D-90002", "BUYER_EVIDENCE", "re-1");
    const r = await syncDispute(t.deps, "PP-D-90002");
    expect(r.events).toEqual(["STATUS_CHANGED"]);

    // Move the seller deadline as PayPal would after an escalation.
    const s = t.sim.sim.state();
    const d = s.disputes["PP-D-90002"]!;
    t.sim.sim.createDispute({
      ...d,
      seller_response_due_date: "2026-11-02T23:59:59.000Z",
      update_time: "2026-10-21T00:00:01.000Z",
    });
    expect((await syncDispute(t.deps, "PP-D-90002")).events).toEqual(["DUE_DATE_CHANGED"]);
    expect(t.queue.cancelled.sort()).toEqual(oldJobs.map((j) => j.jobId).sort());
    const live = await t.db.slaJob.findMany({ where: { caseId, status: "SCHEDULED" } });
    expect(live).toHaveLength(4);
    expect(live.every((j) => j.dueAt.toISOString() === "2026-11-02T23:59:59.000Z")).toBe(true);
  });

  it("maps a resolution to WON and cancels SLA jobs", async () => {
    const { caseId } = await syncDispute(t.deps, "PP-D-90001");
    await t.sim.disputes.adjudicate("PP-D-90001", "SELLER_FAVOR", "adj-1");
    const r = await syncDispute(t.deps, "PP-D-90001");
    expect(r.events).toEqual(["STATUS_CHANGED", "OUTCOME"]);
    const c = await t.db.case.findUniqueOrThrow({ where: { id: caseId } });
    expect(c).toMatchObject({ state: "WON", outcomeCode: "RESOLVED_SELLER_FAVOUR", withdrawn: false });
    expect(await t.db.slaJob.count({ where: { caseId, status: "SCHEDULED" } })).toBe(0);
    expect(await t.db.notification.count({ where: { caseId, kind: "OUTCOME" } })).toBe(1);
  });

  it("records buyer replies as events and notifications", async () => {
    const { caseId } = await syncDispute(t.deps, "PP-D-90002");
    const d = t.sim.sim.state().disputes["PP-D-90002"]!;
    t.sim.sim.createDispute({
      ...d,
      update_time: "2026-10-20T13:00:00.000Z",
      messages: [
        ...(d.messages ?? []),
        {
          posted_by: "BUYER",
          time_posted: "2026-10-20T13:00:00.000Z",
          content: "Can I get a partial refund?",
        },
      ],
    });
    expect((await syncDispute(t.deps, "PP-D-90002")).events).toEqual(["BUYER_MESSAGE"]);
    expect(await t.db.notification.count({ where: { caseId, kind: "BUYER_MESSAGE" } })).toBe(1);
  });
});

describe("dispute.poll", () => {
  it("enqueues a sync per dispute and only looks back from the last run", async () => {
    expect(await pollDisputes(t.deps)).toEqual({ enqueued: 3 });
    expect(
      t.queue.take(QUEUES.disputeSync).map((s) => [s.data["disputeId"], s.options.singletonKey]),
    ).toEqual([
      ["PP-D-90001", "PP-D-90001"],
      ["PP-D-90002", "PP-D-90002"],
      ["PP-D-90003", "PP-D-90003"],
    ]);
    // Nothing updated since the last poll (fixtures are older than NOW - 5min).
    clock.now = new Date(clock.now.getTime() + 60_000);
    expect(await pollDisputes(t.deps)).toEqual({ enqueued: 0 });
  });
});
