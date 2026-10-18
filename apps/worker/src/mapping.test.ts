import { DisputeSchema } from "@rebuttal/paypal";
import { describe, expect, it } from "vitest";
import capture from "../../../fixtures/paypal/capture-3VK13355SM0012345.json" with { type: "json" };
import order from "../../../fixtures/paypal/order-5O190127TN364715T.json" with { type: "json" };
import raw from "../../../fixtures/paypal/dispute-not-received.json" with { type: "json" };
import {
  buildTransactionContext,
  diffCase,
  nextState,
  snapshotFromDispute,
  stateForOutcome,
  type ComparableCase,
} from "./mapping.js";
import { CaptureSchema, OrderSchema } from "@rebuttal/paypal";

const dispute = DisputeSchema.parse(raw);

function stored(overrides: Partial<ComparableCase> = {}): ComparableCase {
  const s = snapshotFromDispute(dispute);
  return {
    status: s.status,
    stage: s.stage,
    disputeState: s.disputeState,
    sellerResponseDueAt: new Date(s.sellerResponseDueAt!),
    outcomeCode: s.outcomeCode,
    messages: s.messages,
    ...overrides,
  };
}

describe("snapshotFromDispute", () => {
  it("maps a recorded dispute into the core Case fields", () => {
    const s = snapshotFromDispute(dispute);
    expect(s).toMatchObject({
      paypalDisputeId: "PP-D-90001",
      reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
      status: "WAITING_FOR_SELLER_RESPONSE",
      stage: "CHARGEBACK",
      amount: { cents: 8900, currency: "USD" },
      sellerResponseDueAt: "2026-10-29T23:59:59.000Z",
      outcomeCode: null,
    });
    expect(s.disputedTransactions[0]).toMatchObject({
      sellerTransactionId: "3VK13355SM0012345",
      grossAmount: { cents: 8900 },
    });
    expect(s.messages[0]).toMatchObject({ postedBy: "BUYER" });
  });
});

describe("diffCase", () => {
  it("reports nothing when nothing changed", () => {
    expect(diffCase(stored(), snapshotFromDispute(dispute))).toEqual([]);
  });

  it("reports status, stage, due date, new buyer messages and outcome", () => {
    const next = snapshotFromDispute(
      DisputeSchema.parse({
        ...raw,
        status: "RESOLVED",
        dispute_life_cycle_stage: "ARBITRATION",
        seller_response_due_date: "2026-10-30T23:59:59.000Z",
        messages: [
          ...raw.messages,
          { posted_by: "BUYER", time_posted: "2026-10-21T00:00:00Z", content: "Hello?" },
          { posted_by: "SELLER", time_posted: "2026-10-21T01:00:00Z", content: "Hi" },
        ],
        dispute_outcome: { outcome_code: "RESOLVED_SELLER_FAVOUR" },
      }),
    );
    expect(diffCase(stored(), next).map((c) => c.type)).toEqual([
      "STATUS_CHANGED",
      "STAGE_CHANGED",
      "DUE_DATE_CHANGED",
      "BUYER_MESSAGE",
      "OUTCOME",
    ]);
  });
});

describe("outcomes", () => {
  it("maps outcome codes to case states", () => {
    expect(stateForOutcome("RESOLVED_SELLER_FAVOUR", { resolvedByUs: false })).toEqual({
      state: "WON",
      withdrawn: false,
    });
    expect(stateForOutcome("RESOLVED_BUYER_FAVOUR", { resolvedByUs: false })).toEqual({
      state: "LOST",
      withdrawn: false,
    });
    expect(stateForOutcome("RESOLVED_BUYER_FAVOUR", { resolvedByUs: true })).toEqual({
      state: "REFUNDED",
      withdrawn: false,
    });
    expect(stateForOutcome("ACCEPTED", { resolvedByUs: false })).toEqual({
      state: "REFUNDED",
      withdrawn: false,
    });
    expect(stateForOutcome("CANCELED_BY_BUYER", { resolvedByUs: false })).toEqual({
      state: "WON",
      withdrawn: true,
    });
    expect(stateForOutcome("NONE", { resolvedByUs: false })).toBeNull();
  });

  it("moves FILED to WAITING_PAYPAL when PayPal starts reviewing", () => {
    const s = snapshotFromDispute(DisputeSchema.parse({ ...raw, status: "UNDER_REVIEW" }));
    expect(nextState("FILED", s, false)).toEqual({ state: "WAITING_PAYPAL" });
    expect(nextState("AWAITING_APPROVAL", s, false)).toEqual({ state: "AWAITING_APPROVAL" });
  });
});

describe("buildTransactionContext", () => {
  it("extracts items, shipping and tracking numbers from order trackers", () => {
    const ctx = buildTransactionContext(
      CaptureSchema.parse(capture),
      OrderSchema.parse(order),
      [],
      new Date("2026-10-20T00:00:00Z"),
    );
    expect(ctx.capture).toMatchObject({ id: "3VK13355SM0012345", amount: { cents: 8900 } });
    expect(ctx.order?.items).toEqual([
      {
        name: "Wireless headphones",
        sku: "SKU-HEADPHONES-01",
        quantity: "1",
        unitAmount: { cents: 8900, currency: "USD" },
      },
    ]);
    expect(ctx.order?.trackingNumbers).toEqual([{ trackingNumber: "EZ4000000004", status: "SHIPPED" }]);
    expect(ctx.order?.shipping?.address?.["postal_code"]).toBe("95131");
    expect(JSON.stringify(ctx)).not.toContain("buyer@example.com");
  });
});
