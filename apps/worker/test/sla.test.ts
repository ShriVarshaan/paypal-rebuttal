import { beforeEach, describe, expect, it } from "vitest";
import { enrichCase } from "../src/jobs/enrich.js";
import { executeDecision } from "../src/jobs/execute.js";
import { gatherEvidence } from "../src/jobs/gather.js";
import { fireSla, scheduleSla } from "../src/jobs/sla.js";
import { syncDispute } from "../src/jobs/sync.js";
import { QUEUES } from "../src/queues.js";
import { clock, setupTestEnv, type TestEnv } from "./helpers.js";

const fresh = setupTestEnv();
let t: TestEnv;
beforeEach(async () => {
  t = await fresh();
});

const job = (caseId: string, kind: string) =>
  t.db.slaJob.findFirstOrThrow({ where: { caseId, kind: kind as never, status: "SCHEDULED" } });

describe("SLA scheduler", () => {
  it("reminds with a CaseEvent and a Notification", async () => {
    const { caseId } = await syncDispute(t.deps, "PP-D-90001");
    const j = await job(caseId, "REMIND_24H");
    clock.now = j.runAt;
    expect(await fireSla(t.deps, j.id)).toEqual({ outcome: "reminded" });
    expect(await t.db.caseEvent.findFirstOrThrow({ where: { caseId, type: "SLA_REMINDER" } })).toMatchObject({
      payload: { kind: "REMIND_24H", hoursLeft: 24 },
    });
    expect(await t.db.notification.findFirstOrThrow({ where: { caseId } })).toMatchObject({
      level: "warning",
      message: "PP-D-90001: response due in 24h",
    });
    // Firing the same job again does nothing.
    expect(await fireSla(t.deps, j.id)).toEqual({ outcome: "stale" });
  });

  it("forces the policy engine's safe default at T-2h and executes it", async () => {
    const { caseId } = await syncDispute(t.deps, "PP-D-90001");
    await enrichCase(t.deps, caseId);
    await gatherEvidence(t.deps, caseId);
    const j = await job(caseId, "FORCE_DECISION");
    clock.now = j.runAt;
    expect(await fireSla(t.deps, j.id)).toEqual({ outcome: "forced FIGHT" }); // delivered tracking → fight
    const d = await t.db.decision.findFirstOrThrow({ where: { caseId } });
    expect(d).toMatchObject({ status: "AUTO_APPROVED", reason: "DEADLINE", approvedBy: "sla-scheduler" });
    const [exec] = t.queue.take(QUEUES.actionExecute);
    expect(exec?.data).toEqual({ decisionId: d.id });
    // The forced FIGHT files with tracking info even though no PDF pack exists.
    expect((await executeDecision(t.deps, d.id, { retryCount: 0, retryLimit: 6 })).status).toBe("succeeded");
    expect((await t.db.case.findUniqueOrThrow({ where: { id: caseId } })).state).toBe("FILED");
  });

  it("does not force a decision once the case has been answered", async () => {
    const { caseId } = await syncDispute(t.deps, "PP-D-90003");
    await t.db.case.update({ where: { id: caseId }, data: { state: "FILED" } });
    const j = await job(caseId, "FORCE_DECISION");
    expect(await fireSla(t.deps, j.id)).toEqual({ outcome: "already responded" });
    expect(await t.db.decision.count()).toBe(0);
  });

  it("files an approved decision that is still waiting at T-2h", async () => {
    const { caseId } = await syncDispute(t.deps, "PP-D-90002");
    const d = await t.db.decision.create({
      data: { caseId, option: "OFFER", status: "APPROVED", note: "x", offerAmountCents: 500 },
    });
    const j = await job(caseId, "FORCE_DECISION");
    expect(await fireSla(t.deps, j.id)).toEqual({ outcome: "executing approved decision" });
    expect(t.queue.take(QUEUES.actionExecute).map((s) => s.data)).toEqual([{ decisionId: d.id }]);
  });

  it("ignores jobs for a due date that has since moved", async () => {
    const { caseId } = await syncDispute(t.deps, "PP-D-90001");
    const j = await job(caseId, "REMIND_72H");
    await t.db.case.update({
      where: { id: caseId },
      data: { sellerResponseDueAt: new Date("2026-11-05T00:00:00Z") },
    });
    expect(await fireSla(t.deps, j.id)).toEqual({ outcome: "stale" });
  });

  it("skips past reminders but runs an overdue forced decision immediately", async () => {
    const { caseId } = await syncDispute(t.deps, "PP-D-90001");
    const row = await t.db.case.update({
      where: { id: caseId },
      data: { sellerResponseDueAt: new Date(clock.now.getTime() + 90 * 60 * 1000) },
    });
    await scheduleSla(t.deps, row);
    const live = await t.db.slaJob.findMany({ where: { caseId, status: "SCHEDULED" } });
    expect(live.map((j) => [j.kind, j.runAt.getTime()])).toEqual([["FORCE_DECISION", clock.now.getTime()]]);
  });
});
