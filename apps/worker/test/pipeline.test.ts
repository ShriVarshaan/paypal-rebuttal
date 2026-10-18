import type { TransactionContext } from "@rebuttal/core";
import { createOfflineEasyPostSource, type EvidenceSource } from "@rebuttal/connectors";
import { beforeEach, describe, expect, it } from "vitest";
import { enrichCase } from "../src/jobs/enrich.js";
import { gatherEvidence } from "../src/jobs/gather.js";
import { syncDispute } from "../src/jobs/sync.js";
import { QUEUES } from "../src/queues.js";
import { clock, setupTestEnv, type TestEnv } from "./helpers.js";

const broken: EvidenceSource = {
  id: "storefront",
  supports: () => true,
  gather: async () => {
    throw new Error("store API down");
  },
};

const fresh = setupTestEnv([createOfflineEasyPostSource(() => clock.now), broken]);
let t: TestEnv;
beforeEach(async () => {
  t = await fresh();
});

describe("case.enrich", () => {
  it("attaches capture, order, shipping and tracking, then queues gathering", async () => {
    const { caseId } = await syncDispute(t.deps, "PP-D-90001");
    await enrichCase(t.deps, caseId);
    const c = await t.db.case.findUniqueOrThrow({ where: { id: caseId } });
    const ctx = c.transactionContext as TransactionContext;
    expect(c.state).toBe("GATHERING");
    expect(ctx.capture?.id).toBe("3VK13355SM0012345");
    expect(ctx.order).toMatchObject({
      id: "5O190127TN364715T",
      trackingNumbers: [{ trackingNumber: "EZ4000000004" }],
    });
    expect(ctx.order?.shipping?.address?.["admin_area_2"]).toBe("San Jose");
    expect(ctx.errors).toEqual([]);
    expect(t.queue.take(QUEUES.caseGather).map((s) => s.data)).toEqual([{ caseId }]);
  });

  it("records a missing capture instead of failing", async () => {
    const d = t.sim.sim.state().disputes["PP-D-90003"]!;
    t.sim.sim.createDispute({
      ...d,
      dispute_id: "PP-D-NOCAP",
      disputed_transactions: [
        { ...d.disputed_transactions![0]!, seller_transaction_id: "MISSING0000000000" },
      ],
    });
    const { caseId } = await syncDispute(t.deps, "PP-D-NOCAP");
    await enrichCase(t.deps, caseId);
    const ctx = (await t.db.case.findUniqueOrThrow({ where: { id: caseId } }))
      .transactionContext as TransactionContext;
    expect(ctx.capture).toBeNull();
    expect(ctx.errors[0]).toMatch(/capture MISSING0000000000/);
  });
});

describe("case.gather", () => {
  it("stores evidence from working connectors even when another one fails", async () => {
    const { caseId } = await syncDispute(t.deps, "PP-D-90001");
    await enrichCase(t.deps, caseId);
    const r = await gatherEvidence(t.deps, caseId);
    expect(r).toEqual({ stored: 1, failures: ["storefront: store API down"] });
    const items = await t.db.evidenceItem.findMany({ where: { caseId } });
    expect(items.map((i) => [i.source, i.type, (i.data as { status: string }).status])).toEqual([
      ["easypost", "PROOF_OF_FULFILLMENT", "delivered"],
    ]);
    const ev = await t.db.caseEvent.findFirstOrThrow({ where: { caseId, type: "EVIDENCE_GATHERED" } });
    expect(ev.payload).toEqual({ sources: { easypost: 1 }, failures: ["storefront: store API down"] });
    expect(t.queue.take(QUEUES.caseTriage).map((s) => s.data)).toEqual([{ caseId }]);
  });

  it("is idempotent: gathering twice keeps one row per item", async () => {
    const { caseId } = await syncDispute(t.deps, "PP-D-90001");
    await enrichCase(t.deps, caseId);
    await gatherEvidence(t.deps, caseId);
    await gatherEvidence(t.deps, caseId);
    expect(await t.db.evidenceItem.count({ where: { caseId } })).toBe(1);
  });
});
