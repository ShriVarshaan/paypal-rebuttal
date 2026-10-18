// Builders shared by this package's tests and the eval harness.
import type { EvidenceLike } from "@rebuttal/core";
import type { DecisionCase } from "./types.js";

export function testCase(over: Partial<DecisionCase> = {}): DecisionCase {
  return {
    paypalDisputeId: "PP-D-TEST",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    stage: "CHARGEBACK",
    amount: { cents: 8900, currency: "USD" },
    sellerResponseDueAt: "2026-10-29T23:59:59.000Z",
    paypalCreatedAt: "2026-10-15T09:12:44.000Z",
    disputedTransactions: [{ createdAt: "2026-10-02T14:21:07.000Z" }],
    transactionContext: null,
    allowedResponseOptions: null,
    ...over,
  };
}

export const ev = {
  tracking: (status = "delivered", over: Record<string, unknown> = {}): EvidenceLike => ({
    id: `trk-${status}`,
    source: "easypost",
    type: "PROOF_OF_FULFILLMENT",
    title: `Carrier tracking: ${status}`,
    data: {
      trackingCode: "EZ4000000004",
      carrier: "USPS",
      status,
      deliveredAt: status === "delivered" ? "2026-10-05T15:00:00Z" : null,
      deliveredTo: status === "delivered" ? { zip: "95131" } : null,
      shippingPostalCode: "95131",
      signedBy: null,
      ...over,
    },
  }),
  of: (kind: string, data: Record<string, unknown> = {}, type = "OTHER"): EvidenceLike => ({
    id: kind,
    source: "store",
    type,
    title: kind,
    data: { kind, ...data },
  }),
};
