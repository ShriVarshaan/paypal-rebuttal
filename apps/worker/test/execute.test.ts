import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PayPalError, type PayPalClient } from "@rebuttal/paypal";
import { beforeEach, describe, expect, it } from "vitest";
import { enrichCase } from "../src/jobs/enrich.js";
import { executeDecision } from "../src/jobs/execute.js";
import { gatherEvidence } from "../src/jobs/gather.js";
import { syncDispute } from "../src/jobs/sync.js";
import { setupTestEnv, type TestEnv } from "./helpers.js";

const fresh = setupTestEnv();
let t: TestEnv;
beforeEach(async () => {
  t = await fresh();
});

const FIRST = { retryCount: 0, retryLimit: 6 };
const LAST = { retryCount: 6, retryLimit: 6 };

async function caseFor(disputeId: string) {
  const { caseId } = await syncDispute(t.deps, disputeId);
  await enrichCase(t.deps, caseId);
  await gatherEvidence(t.deps, caseId);
  return caseId;
}

function decide(
  caseId: string,
  data: {
    option: "FIGHT" | "OFFER" | "ACCEPT";
    offerAmountCents?: number;
    offerType?: string;
    status?: "APPROVED" | "PROPOSED";
  },
) {
  return t.db.decision.create({
    data: {
      caseId,
      note: "We shipped the order and it was delivered.",
      status: data.status ?? "APPROVED",
      option: data.option,
      offerAmountCents: data.offerAmountCents ?? null,
      offerType: data.offerType ?? null,
    },
  });
}

function writePdf(): string {
  const dir = mkdtempSync(join(tmpdir(), "rebuttal-pack-"));
  const path = join(dir, "evidence-pack.pdf");
  writeFileSync(path, Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(2048)]));
  return path;
}

/** The simulator, but the named dispute call fails with `errors` in order first. */
function withFaults(
  base: PayPalClient,
  method: "makeOffer" | "acceptClaim" | "provideEvidence",
  errors: Error[],
) {
  const calls: string[] = [];
  const disputes = {
    ...base.disputes,
    [method]: async (...args: unknown[]) => {
      calls.push(String(args.at(-1)));
      const e = errors.shift();
      if (e) throw e;
      return (base.disputes[method] as (...a: unknown[]) => Promise<unknown>)(...args);
    },
  };
  return { client: { ...base, disputes } as PayPalClient, calls };
}

const transient = () =>
  new PayPalError({
    status: 503,
    name: "SERVICE_UNAVAILABLE",
    message: "try later",
    method: "POST",
    path: "/x",
  });

describe("action.execute", () => {
  it("OFFER → make-offer with the optimizer's amount → OFFER_PENDING", async () => {
    const caseId = await caseFor("PP-D-90002");
    const d = await decide(caseId, { option: "OFFER", offerAmountCents: 1500, offerType: "REFUND" });
    expect((await executeDecision(t.deps, d.id, FIRST)).status).toBe("succeeded");

    const action = await t.db.action.findFirstOrThrow({ where: { decisionId: d.id } });
    expect(action).toMatchObject({
      kind: "MAKE_OFFER",
      status: "SUCCEEDED",
      attempts: 1,
      idempotencyKey: `${caseId}:${d.id}:MAKE_OFFER`,
    });
    expect((await t.db.case.findUniqueOrThrow({ where: { id: caseId } })).state).toBe("OFFER_PENDING");
    expect((await t.db.decision.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("EXECUTED");
    expect(t.sim.sim.state().disputes["PP-D-90002"]!.offer).toMatchObject({
      offer_type: "REFUND",
      seller_offered_amount: { currency_code: "USD", value: "15.00" },
    });
  });

  it("ACCEPT → accept-claim → FILED, then RESOLVED maps to REFUNDED", async () => {
    const caseId = await caseFor("PP-D-90003");
    const d = await decide(caseId, { option: "ACCEPT" });
    await executeDecision(t.deps, d.id, FIRST);
    expect((await t.db.case.findUniqueOrThrow({ where: { id: caseId } })).state).toBe("FILED");
    await syncDispute(t.deps, "PP-D-90003");
    expect((await t.db.case.findUniqueOrThrow({ where: { id: caseId } })).state).toBe("REFUNDED");
  });

  it("FIGHT waits for the PDF pack, then files it with tracking info", async () => {
    const caseId = await caseFor("PP-D-90001");
    const d = await decide(caseId, { option: "FIGHT" });
    expect(await executeDecision(t.deps, d.id, FIRST)).toEqual({
      status: "waiting",
      reason: "evidence pack not ready",
    });
    expect((await t.db.case.findUniqueOrThrow({ where: { id: caseId } })).state).toBe("FILING");
    expect(await t.db.action.count()).toBe(0);

    await t.db.evidencePack.create({
      data: {
        caseId,
        decisionId: d.id,
        status: "READY",
        files: [{ path: writePdf(), name: "evidence-pack.pdf", evidenceType: "PROOF_OF_FULFILLMENT" }],
      },
    });
    expect((await executeDecision(t.deps, d.id, FIRST)).status).toBe("succeeded");
    expect((await t.db.case.findUniqueOrThrow({ where: { id: caseId } })).state).toBe("FILED");
    const submitted = t.sim.sim.state().disputes["PP-D-90001"]!.evidences![0] as Record<string, unknown>;
    expect(submitted).toMatchObject({
      evidence_type: "PROOF_OF_FULFILLMENT",
      documents: [{ name: "evidence-pack.pdf" }],
      evidence_info: { tracking_info: [{ carrier_name: "USPS", tracking_number: "EZ4000000004" }] },
    });
  });

  it("a deadline decision files without waiting for the pack", async () => {
    const caseId = await caseFor("PP-D-90001");
    const d = await t.db.decision.create({
      data: { caseId, option: "FIGHT", status: "AUTO_APPROVED", note: "Delivered.", reason: "DEADLINE" },
    });
    expect((await executeDecision(t.deps, d.id, FIRST)).status).toBe("succeeded");
  });

  it("retries a transient failure with the same idempotency key", async () => {
    const caseId = await caseFor("PP-D-90002");
    const d = await decide(caseId, { option: "OFFER", offerAmountCents: 1000 });
    const faulty = withFaults(t.sim, "makeOffer", [transient()]);
    t.usePayPal(faulty.client);

    await expect(executeDecision(t.deps, d.id, FIRST)).rejects.toMatchObject({ status: 503 });
    expect(await t.db.action.findFirstOrThrow({ where: { decisionId: d.id } })).toMatchObject({
      status: "PENDING",
      attempts: 1,
    });
    await executeDecision(t.deps, d.id, { retryCount: 1, retryLimit: 6 });
    expect(faulty.calls).toEqual([`${caseId}:${d.id}:MAKE_OFFER`, `${caseId}:${d.id}:MAKE_OFFER`]);
    expect(await t.db.action.findFirstOrThrow({ where: { decisionId: d.id } })).toMatchObject({
      status: "SUCCEEDED",
      attempts: 2,
    });
  });

  it("a permanent failure marks the action FAILED and returns the case for approval", async () => {
    const caseId = await caseFor("PP-D-90003");
    await t.sim.disputes.adjudicate("PP-D-90003", "SELLER_FAVOR", "adj"); // now RESOLVED: accept-claim gets a 422
    const d = await decide(caseId, { option: "ACCEPT" });
    const r = await executeDecision(t.deps, d.id, FIRST);
    expect(r.status).toBe("failed");
    expect(await t.db.action.findFirstOrThrow({ where: { decisionId: d.id } })).toMatchObject({
      status: "FAILED",
    });
    expect((await t.db.case.findUniqueOrThrow({ where: { id: caseId } })).state).toBe("AWAITING_APPROVAL");
    const ev = await t.db.caseEvent.findFirstOrThrow({ where: { caseId, type: "ACTION_FAILED" } });
    expect(ev.payload).toMatchObject({
      kind: "ACCEPT_CLAIM",
      error: { status: 422, issue: "DISPUTE_RESOLVED" },
    });
  });

  it("gives up on a transient error once retries are exhausted", async () => {
    const caseId = await caseFor("PP-D-90002");
    const d = await decide(caseId, { option: "OFFER", offerAmountCents: 1000 });
    t.usePayPal(withFaults(t.sim, "makeOffer", [transient()]).client);
    expect((await executeDecision(t.deps, d.id, LAST)).status).toBe("failed");
  });

  it("skips decisions that are not approved", async () => {
    const caseId = await caseFor("PP-D-90002");
    const d = await decide(caseId, { option: "OFFER", offerAmountCents: 1000, status: "PROPOSED" });
    expect(await executeDecision(t.deps, d.id, FIRST)).toEqual({
      status: "skipped",
      reason: "decision is PROPOSED",
    });
    expect(await t.db.action.count()).toBe(0);
  });

  it("the database refuses a second successful action of the same kind", async () => {
    const caseId = await caseFor("PP-D-90002");
    const base = { caseId, kind: "MAKE_OFFER" as const, endpoint: "x", status: "SUCCEEDED" as const };
    await t.db.action.create({ data: { ...base, idempotencyKey: "k1" } });
    await expect(t.db.action.create({ data: { ...base, idempotencyKey: "k2" } })).rejects.toMatchObject({
      code: "P2002",
    });
    // Messages may repeat.
    await t.db.action.create({ data: { ...base, kind: "SEND_MESSAGE", idempotencyKey: "m1" } });
    await t.db.action.create({ data: { ...base, kind: "SEND_MESSAGE", idempotencyKey: "m2" } });
  });

  it("a second approved decision of the same kind fails instead of double-filing", async () => {
    const caseId = await caseFor("PP-D-90003");
    const d1 = await decide(caseId, { option: "ACCEPT" });
    await executeDecision(t.deps, d1.id, FIRST);
    // Reopen the dispute in the simulator so PayPal itself would accept another call.
    const s = t.sim.sim.state().disputes["PP-D-90003"]!;
    t.sim.sim.createDispute({ ...s, status: "WAITING_FOR_SELLER_RESPONSE", dispute_outcome: undefined });
    const d2 = await decide(caseId, { option: "ACCEPT" });
    expect((await executeDecision(t.deps, d2.id, FIRST)).status).toBe("failed");
    expect(await t.db.action.count({ where: { caseId, status: "SUCCEEDED" } })).toBe(1);
  });
});
