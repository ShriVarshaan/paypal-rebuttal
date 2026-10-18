import { z } from "zod";
import { Money } from "./money.js";

/** Plan §2: NEW → GATHERING → TRIAGED → AWAITING_APPROVAL → FILING → FILED → WAITING_PAYPAL → WON | LOST | REFUNDED | OFFER_PENDING → (APPEAL_DRAFTED) */
export const CaseState = z.enum([
  "NEW",
  "GATHERING",
  "TRIAGED",
  "AWAITING_APPROVAL",
  "FILING",
  "FILED",
  "WAITING_PAYPAL",
  "OFFER_PENDING",
  "WON",
  "LOST",
  "REFUNDED",
  "APPEAL_DRAFTED",
]);
export type CaseState = z.infer<typeof CaseState>;

export const TERMINAL_STATES: ReadonlySet<CaseState> = new Set(["WON", "LOST", "REFUNDED"]);

export const DisputedTransaction = z.object({
  sellerTransactionId: z.string().nullable(),
  buyerTransactionId: z.string().nullable(),
  grossAmount: Money.nullable(),
  createdAt: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  buyerName: z.string().nullable(),
  items: z.array(z.object({ name: z.string().nullable(), quantity: z.string().nullable() })),
});
export type DisputedTransaction = z.infer<typeof DisputedTransaction>;

export const DisputeMessage = z.object({
  postedBy: z.string(),
  postedAt: z.string().nullable(),
  content: z.string(),
});
export type DisputeMessage = z.infer<typeof DisputeMessage>;

/**
 * The PayPal-derived fields of a Case. PayPal enum fields stay plain strings so an
 * unknown value from PayPal never breaks sync; compare them against `paypal-enums.ts`.
 */
export const CaseSnapshot = z.object({
  paypalDisputeId: z.string(),
  reason: z.string(),
  status: z.string(),
  disputeState: z.string().nullable(),
  stage: z.string(),
  channel: z.string().nullable(),
  amount: Money,
  sellerResponseDueAt: z.string().nullable(),
  buyerResponseDueAt: z.string().nullable(),
  outcomeCode: z.string().nullable(),
  disputedTransactions: z.array(DisputedTransaction),
  messages: z.array(DisputeMessage),
  paypalCreatedAt: z.string(),
  paypalUpdatedAt: z.string(),
});
export type CaseSnapshot = z.infer<typeof CaseSnapshot>;

export const Case = CaseSnapshot.extend({
  id: z.string(),
  state: CaseState,
  withdrawn: z.boolean(),
});
export type Case = z.infer<typeof Case>;
