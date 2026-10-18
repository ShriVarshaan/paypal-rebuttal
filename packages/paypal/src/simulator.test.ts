import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EvidenceTooLargeError, PayPalError } from "./errors.js";
import { createSimulatorClient } from "./simulator.js";
import { pdf } from "./testing/files.js";

function sim() {
  const dir = mkdtempSync(join(tmpdir(), "rebuttal-sim-"));
  return createSimulatorClient({
    stateFile: join(dir, "state.json"),
    fixturesDir: join(import.meta.dirname, "../../../fixtures/paypal"),
  });
}

const evidence = {
  evidences: [{ evidence_type: "PROOF_OF_FULFILLMENT", documents: [{ name: "pack.pdf" }] }],
};

describe("simulator", () => {
  it("serves fixture disputes, captures and orders", async () => {
    const pp = sim();
    const list = await pp.disputes.list();
    expect(list.items.map((d) => d.dispute_id)).toEqual(["PP-D-90001", "PP-D-90002", "PP-D-90003"]);
    const d = await pp.disputes.show("PP-D-90001");
    const capture = await pp.payments.getCapture(d.disputed_transactions![0]!.seller_transaction_id!);
    const order = await pp.orders.get(capture.supplementary_data!.related_ids!.order_id!);
    expect(order.purchase_units[0]!.shipping!.trackers![0]!.id).toContain("EZ4000000004");
  });

  it("paginates list results", async () => {
    const pp = sim();
    const first = await pp.disputes.list({ page_size: 2 });
    expect(first.items).toHaveLength(2);
    const second = await pp.disputes.list({ page_size: 2, next_page_token: first.nextPageToken! });
    expect(second.items.map((d) => d.dispute_id)).toEqual(["PP-D-90003"]);
    expect(second.nextPageToken).toBeUndefined();
  });

  it("applies a write once per PayPal-Request-Id", async () => {
    const pp = sim();
    await pp.disputes.provideEvidence("PP-D-90001", evidence, [pdf("pack.pdf")], "k1");
    await pp.disputes.provideEvidence("PP-D-90001", evidence, [pdf("pack.pdf")], "k1");
    const s = pp.sim.state();
    expect(s.calls).toHaveLength(2);
    expect(Object.keys(s.writes)).toEqual(["k1"]);
    expect(s.disputes["PP-D-90001"]!.status).toBe("UNDER_REVIEW");
    expect(s.disputes["PP-D-90001"]!.evidences).toHaveLength(1);
  });

  it("enforces dispute state like PayPal does", async () => {
    const pp = sim();
    await pp.disputes.adjudicate("PP-D-90001", "SELLER_FAVOR", "adj");
    const err = await pp.disputes
      .provideEvidence("PP-D-90001", evidence, [pdf("pack.pdf")], "k2")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err).toMatchObject({ status: 422, issue: "DISPUTE_NOT_IN_REQUIRED_STATE" });
    await expect(
      pp.disputes.makeOffer(
        "PP-D-90003",
        { offer_type: "REFUND", note: "x", offer_amount: { currency_code: "USD", value: "1.00" } },
        "k3",
      ),
    ).rejects.toMatchObject({
      issue: "OFFER_NOT_ALLOWED",
    });
  });

  it("rejects oversize evidence before touching state", async () => {
    const pp = sim();
    await expect(
      pp.disputes.provideEvidence("PP-D-90001", evidence, [pdf("pack.pdf", 12 * 1024 * 1024)], "k"),
    ).rejects.toBeInstanceOf(EvidenceTooLargeError);
    expect(pp.sim.state().calls).toHaveLength(0);
  });

  it("sandbox helpers move a dispute through its lifecycle", async () => {
    const pp = sim();
    await pp.disputes.requireEvidence("PP-D-90002", "SELLER_EVIDENCE", "re");
    expect((await pp.disputes.show("PP-D-90002")).status).toBe("WAITING_FOR_SELLER_RESPONSE");
    await pp.disputes.adjudicate("PP-D-90002", "BUYER_FAVOR", "adj");
    const d = await pp.disputes.show("PP-D-90002");
    expect(d.status).toBe("RESOLVED");
    expect(d.dispute_outcome?.outcome_code).toBe("RESOLVED_BUYER_FAVOUR");
  });

  it("returns 404 for unknown disputes", async () => {
    await expect(sim().disputes.show("PP-D-NOPE")).rejects.toMatchObject({ status: 404 });
  });
});
