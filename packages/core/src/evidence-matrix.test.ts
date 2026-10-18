import { describe, expect, it } from "vitest";
import type { EvidenceLike } from "./evidence-kinds.js";
import {
  assessCompleteness,
  completenessScore,
  evidenceMatrix,
  requirementsFor,
  SIGNATURE_STRONG_CENTS,
  SIGNATURE_THRESHOLD_CENTS,
  type MatrixContext,
} from "./evidence-matrix.js";

const tracking = (over: Record<string, unknown> = {}): EvidenceLike => ({
  id: "trk",
  source: "easypost",
  type: "PROOF_OF_FULFILLMENT",
  data: {
    trackingCode: "EZ4000000004",
    status: "delivered",
    deliveredTo: { zip: "95131" },
    shippingPostalCode: "95131-1234",
    signedBy: "J. DOE",
    ...over,
  },
});

const item = (kind: string, data: Record<string, unknown> = {}, id = kind): EvidenceLike => ({
  id,
  source: "store",
  type: "OTHER",
  data: { kind, ...data },
});

const NR: MatrixContext = {
  reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  amountCents: 8900,
  digital: false,
};

/** Evidence that satisfies every requirement of each reason. */
const FULL: Record<string, { ctx: Partial<MatrixContext>; items: EvidenceLike[] }> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: {
    ctx: {},
    items: [tracking(), item("order"), item("message_thread")],
  },
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: {
    ctx: {},
    items: [
      item("listing_snapshot", { capturedAt: "2026-10-01T00:00:00Z", orderedAt: "2026-10-05T00:00:00Z" }),
      item("message_thread"),
      item("return_policy"),
      item("item_photos"),
      tracking(),
    ],
  },
  UNAUTHORISED: {
    ctx: {},
    items: [
      tracking(),
      item("buyer_history", { priorOrders: 2 }),
      item("checkout_risk", { avsMatch: true, ipMatch: true }),
    ],
  },
  CREDIT_NOT_PROCESSED: { ctx: {}, items: [item("refund"), item("message_thread")] },
  DUPLICATE_TRANSACTION: {
    ctx: {},
    items: [item("order", { distinctFromOtherCharge: true }), item("refund")],
  },
  INCORRECT_AMOUNT: { ctx: {}, items: [item("order", { agreedAmountCents: 8900 }), item("message_thread")] },
  CANCELED_RECURRING_BILLING: {
    ctx: {},
    items: [
      item("subscription", { chargedAt: "2026-10-01T00:00:00Z", cancelledAt: null }),
      item("access_log", { accessCount: 4 }),
      item("message_thread"),
    ],
  },
  PAYMENT_BY_OTHER_MEANS: { ctx: {}, items: [item("order", { singlePaymentMethod: true }), item("refund")] },
};

describe("evidenceMatrix", () => {
  it("covers every PayPal reason except the catch-alls", () => {
    expect(Object.keys(evidenceMatrix).sort()).toEqual(Object.keys(FULL).sort());
  });

  for (const [reason, { ctx, items }] of Object.entries(FULL)) {
    it(`${reason}: full evidence scores 1, none scores 0`, () => {
      const c = { ...NR, reason, ...ctx };
      expect(assessCompleteness(c, items)).toMatchObject({
        score: 1,
        requiredMet: true,
        missingRequired: [],
      });
      const empty = assessCompleteness(c, []);
      expect(empty.score).toBe(0);
      expect(empty.requiredMet).toBe(false);
      expect(requirementsFor(c).some((r) => r.level === "required")).toBe(true);
    });
  }

  it("lists required first, then strong, then nice", () => {
    const levels = requirementsFor(NR).map((r) => r.level);
    expect(levels).toEqual(["required", "strong", "nice", "nice", "nice"]);
  });

  it("signature confirmation: nice, strong above $250, required from $750", () => {
    const sig = (amountCents: number) =>
      requirementsFor({ ...NR, amountCents }).find((r) => r.id === "signature_confirmation")?.level;
    expect(sig(SIGNATURE_STRONG_CENTS)).toBe("nice");
    expect(sig(SIGNATURE_STRONG_CENTS + 1)).toBe("strong");
    expect(sig(SIGNATURE_THRESHOLD_CENTS - 1)).toBe("strong");
    expect(sig(SIGNATURE_THRESHOLD_CENTS)).toBe("required");
  });

  it("uses access logs instead of tracking for digital goods", () => {
    const ids = requirementsFor({ ...NR, digital: true }).map((r) => r.id);
    expect(ids).toContain("digital_access");
    expect(ids).not.toContain("carrier_delivered");
    expect(requirementsFor({ ...NR, reason: "UNAUTHORISED", digital: true })[0]!.id).toBe("digital_access");
  });

  it("falls back to nice-to-have items for OTHER", () => {
    expect(requirementsFor({ ...NR, reason: "OTHER" }).every((r) => r.level === "nice")).toBe(true);
  });
});

describe("assessCompleteness", () => {
  it("weighs tiers 0.6 / 0.3 / 0.1", () => {
    // Delivered (required) but to another postal code (strong missing), signature present (nice).
    const r = assessCompleteness(NR, [tracking({ deliveredTo: { zip: "10001" } })]);
    expect(r.requiredMet).toBe(true);
    expect(r.missingOptional).toEqual(["delivered_to_address", "order_details", "message_thread"]);
    expect(r.score).toBeCloseTo(0.6 + 0.1 / 3);
  });

  it("tolerates ZIP+4 when matching the address on file", () => {
    expect(assessCompleteness(NR, [tracking()]).missingOptional).not.toContain("delivered_to_address");
  });

  it("does not count tracking that wasn't delivered", () => {
    const r = assessCompleteness(NR, [tracking({ status: "return_to_sender" })]);
    expect(r.missingRequired).toEqual(["carrier_delivered"]);
    expect(r.score).toBe(0);
  });

  it("requires the listing snapshot to predate the order", () => {
    const ctx = { ...NR, reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED" };
    const snap = (capturedAt: string) =>
      item("listing_snapshot", { capturedAt, orderedAt: "2026-10-05T00:00:00Z" });
    expect(assessCompleteness(ctx, [snap("2026-10-01T00:00:00Z")]).requiredMet).toBe(true);
    expect(assessCompleteness(ctx, [snap("2026-10-09T00:00:00Z")]).requiredMet).toBe(false);
  });

  it("checks subscription cancellation against the charge date", () => {
    const ctx = { ...NR, reason: "CANCELED_RECURRING_BILLING" };
    const sub = (cancelledAt: string | null) =>
      item("subscription", { chargedAt: "2026-10-01T00:00:00Z", cancelledAt });
    expect(assessCompleteness(ctx, [sub("2026-10-03T00:00:00Z")]).requiredMet).toBe(true);
    expect(assessCompleteness(ctx, [sub("2026-09-28T00:00:00Z")]).missingRequired).toEqual([
      "not_cancelled_before_charge",
    ]);
  });

  it("accepts a return policy instead of a refund for credit-not-processed", () => {
    const ctx = { ...NR, reason: "CREDIT_NOT_PROCESSED" };
    expect(assessCompleteness(ctx, [item("return_policy")]).requiredMet).toBe(true);
  });

  it("matches the agreed amount exactly", () => {
    const ctx = { ...NR, reason: "INCORRECT_AMOUNT" };
    expect(assessCompleteness(ctx, [item("order", { agreedAmountCents: 7900 })]).requiredMet).toBe(false);
  });

  it("reports which items satisfied each requirement", () => {
    const r = assessCompleteness({ ...NR, reason: "UNAUTHORISED" }, [
      tracking(),
      item("checkout_risk", { avsMatch: true, cvvMatch: false, ipMatch: false, deviceMatch: true }, "risk"),
      item("buyer_history", { priorOrders: 0 }, "hist"),
    ]);
    expect(Object.fromEntries(r.requirements.map((q) => [q.id, q.satisfiedBy]))).toEqual({
      delivered_to_address: ["trk"],
      repeat_customer: [],
      device_ip_match: ["risk"],
      checkout_verification: ["risk"],
    });
  });

  it("completenessScore returns the missing requirements", () => {
    const r = completenessScore(NR, [tracking({ signedBy: null })]);
    expect(r.missing.map((m) => m.id)).toEqual(["signature_confirmation", "order_details", "message_thread"]);
  });
});
