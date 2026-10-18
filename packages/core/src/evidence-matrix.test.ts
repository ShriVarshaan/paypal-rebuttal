import { describe, expect, it } from "vitest";
import type { EvidenceLike } from "./evidence-kinds.js";
import { assessCompleteness, requirementsFor, SIGNATURE_THRESHOLD_CENTS } from "./evidence-matrix.js";

const tracking = (over: Record<string, unknown> = {}): EvidenceLike => ({
  id: "trk",
  source: "easypost",
  type: "PROOF_OF_FULFILLMENT",
  data: {
    trackingCode: "EZ4000000004",
    status: "delivered",
    deliveredTo: { zip: "95131" },
    shippingPostalCode: "95131-1234",
    signedBy: null,
    ...over,
  },
});

const item = (kind: string, data: Record<string, unknown> = {}, id = kind): EvidenceLike => ({
  id,
  source: "store",
  type: "OTHER",
  data: { kind, ...data },
});

const NR = { reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", amountCents: 8900, digital: false };

describe("requirementsFor", () => {
  it("lists required items first", () => {
    const levels = requirementsFor(NR).map((r) => r.level);
    expect(levels.indexOf("optional")).toBeGreaterThan(levels.lastIndexOf("required"));
  });

  it("asks for signature confirmation only at or above the threshold", () => {
    const sig = (amountCents: number) =>
      requirementsFor({ ...NR, amountCents }).find((r) => r.id === "signature_confirmation")?.level;
    expect(sig(SIGNATURE_THRESHOLD_CENTS - 1)).toBe("optional");
    expect(sig(SIGNATURE_THRESHOLD_CENTS)).toBe("required");
  });

  it("uses access logs instead of tracking for digital goods", () => {
    const ids = requirementsFor({ ...NR, digital: true }).map((r) => r.id);
    expect(ids).toContain("digital_access");
    expect(ids).not.toContain("carrier_delivered");
  });

  it("has requirements for every PayPal reason", () => {
    for (const reason of [
      "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
      "UNAUTHORISED",
      "CREDIT_NOT_PROCESSED",
      "DUPLICATE_TRANSACTION",
      "INCORRECT_AMOUNT",
      "CANCELED_RECURRING_BILLING",
      "PAYMENT_BY_OTHER_MEANS",
      "OTHER",
    ]) {
      expect(requirementsFor({ ...NR, reason }).length).toBeGreaterThan(0);
    }
  });
});

describe("assessCompleteness", () => {
  it("is complete for delivered tracking to the address on file (ZIP+4 tolerated)", () => {
    const r = assessCompleteness(NR, [tracking()]);
    expect(r.requiredMet).toBe(true);
    expect(r.missingRequired).toEqual([]);
    expect(r.missingOptional).toEqual(["signature_confirmation", "order_details", "message_thread"]);
    expect(r.score).toBeCloseTo(6 / 9);
  });

  it("flags delivery to a different postal code", () => {
    const r = assessCompleteness(NR, [tracking({ deliveredTo: { zip: "10001" } })]);
    expect(r.missingRequired).toEqual(["delivered_to_address"]);
    expect(r.requiredMet).toBe(false);
  });

  it("does not count tracking that wasn't delivered", () => {
    const r = assessCompleteness(NR, [tracking({ status: "return_to_sender" })]);
    expect(r.missingRequired).toEqual(["carrier_delivered", "delivered_to_address"]);
    expect(r.score).toBe(0);
  });

  it("requires the listing snapshot to predate the order", () => {
    const ctx = { ...NR, reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED" };
    const before = item("listing_snapshot", {
      capturedAt: "2026-10-01T00:00:00Z",
      orderedAt: "2026-10-05T00:00:00Z",
    });
    const after = item("listing_snapshot", {
      capturedAt: "2026-10-09T00:00:00Z",
      orderedAt: "2026-10-05T00:00:00Z",
    });
    expect(assessCompleteness(ctx, [before]).requiredMet).toBe(true);
    expect(assessCompleteness(ctx, [after]).requiredMet).toBe(false);
  });

  it("checks subscription cancellation against the charge date", () => {
    const ctx = { ...NR, reason: "CANCELED_RECURRING_BILLING" };
    const sub = (cancelledAt: string | null) =>
      item("subscription", { chargedAt: "2026-10-01T00:00:00Z", cancelledAt });
    expect(assessCompleteness(ctx, [sub(null)]).requiredMet).toBe(true);
    expect(assessCompleteness(ctx, [sub("2026-10-03T00:00:00Z")]).requiredMet).toBe(true);
    expect(assessCompleteness(ctx, [sub("2026-09-28T00:00:00Z")]).missingRequired).toEqual([
      "not_cancelled_before_charge",
    ]);
  });

  it("matches the agreed amount exactly", () => {
    const ctx = { ...NR, reason: "INCORRECT_AMOUNT" };
    expect(assessCompleteness(ctx, [item("order", { agreedAmountCents: 8900 })]).requiredMet).toBe(true);
    expect(assessCompleteness(ctx, [item("order", { agreedAmountCents: 7900 })]).requiredMet).toBe(false);
  });

  it("reports which items satisfied each requirement", () => {
    const r = assessCompleteness({ ...NR, reason: "UNAUTHORISED" }, [
      tracking(),
      item("checkout_risk", { avsMatch: true, cvvMatch: false, ipMatch: false, deviceMatch: true }, "risk"),
      item("buyer_history", { priorOrders: 0 }, "hist"),
    ]);
    expect(Object.fromEntries(r.requirements.map((q) => [q.id, q.satisfiedBy]))).toEqual({
      checkout_verification: ["risk"],
      delivered_to_address: ["trk"],
      device_ip_match: ["risk"],
      repeat_customer: [],
    });
  });

  it("scores zero with no evidence", () => {
    expect(assessCompleteness(NR, []).score).toBe(0);
  });
});
