import { z } from "zod";

// Enum values copied from the PayPal Customer Disputes v1 OpenAPI spec
// (github.com/paypal/paypal-rest-api-specifications, openapi/customer_disputes_v1.json).

export const DisputeReason = z.enum([
  "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
  "UNAUTHORISED",
  "CREDIT_NOT_PROCESSED",
  "DUPLICATE_TRANSACTION",
  "INCORRECT_AMOUNT",
  "PAYMENT_BY_OTHER_MEANS",
  "CANCELED_RECURRING_BILLING",
  "PROBLEM_WITH_REMITTANCE",
  "OTHER",
]);
export type DisputeReason = z.infer<typeof DisputeReason>;

export const DisputeStatus = z.enum([
  "OPEN",
  "WAITING_FOR_BUYER_RESPONSE",
  "WAITING_FOR_SELLER_RESPONSE",
  "UNDER_REVIEW",
  "RESOLVED",
  "OTHER",
]);
export type DisputeStatus = z.infer<typeof DisputeStatus>;

export const DisputeStage = z.enum(["INQUIRY", "CHARGEBACK", "PRE_ARBITRATION", "ARBITRATION"]);
export type DisputeStage = z.infer<typeof DisputeStage>;

export const DisputeOutcomeCode = z.enum([
  "RESOLVED_BUYER_FAVOUR",
  "RESOLVED_SELLER_FAVOUR",
  "RESOLVED_WITH_PAYOUT",
  "CANCELED_BY_BUYER",
  "ACCEPTED",
  "DENIED",
  "NONE",
]);
export type DisputeOutcomeCode = z.infer<typeof DisputeOutcomeCode>;

export const OfferType = z.enum([
  "REFUND",
  "REFUND_WITH_RETURN",
  "REFUND_WITH_REPLACEMENT",
  "REPLACEMENT_WITHOUT_REFUND",
]);
export type OfferType = z.infer<typeof OfferType>;

/** The evidence types Rebuttal produces. PayPal accepts many more (see `evidence_type` in the spec). */
export const EvidenceType = z.enum([
  "PROOF_OF_FULFILLMENT",
  "PROOF_OF_DELIVERY_SIGNATURE",
  "PROOF_OF_REFUND",
  "PROOF_OF_RETURN",
  "RETURN_POLICY",
  "ITEM_DESCRIPTION",
  "BILLING_AGREEMENT",
  "PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED",
  "ORDER_DETAILS",
  "LISTING_URL",
  "PHOTOS_OF_SHIPPED_ITEM",
  "MERCHANT_RESPONSE",
  "OTHER",
]);
export type EvidenceType = z.infer<typeof EvidenceType>;

export const WebhookEventType = z.enum([
  "CUSTOMER.DISPUTE.CREATED",
  "CUSTOMER.DISPUTE.UPDATED",
  "CUSTOMER.DISPUTE.RESOLVED",
]);
export type WebhookEventType = z.infer<typeof WebhookEventType>;
