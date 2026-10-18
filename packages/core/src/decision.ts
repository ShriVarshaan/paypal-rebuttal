import { z } from "zod";
import { Money } from "./money.js";
import { OfferType } from "./paypal-enums.js";

export const DecisionOption = z.enum(["FIGHT", "OFFER", "ACCEPT"]);
export type DecisionOption = z.infer<typeof DecisionOption>;

export const DecisionStatus = z.enum([
  "PROPOSED",
  "APPROVED",
  "AUTO_APPROVED",
  "REJECTED",
  "EXECUTED",
  "FAILED",
]);
export type DecisionStatus = z.infer<typeof DecisionStatus>;

/** What the policy engine hands the executor. */
export const DecisionInput = z.object({
  option: DecisionOption,
  offerAmount: Money.optional(),
  offerType: OfferType.optional(),
  note: z.string().min(1).max(2000),
  reason: z.string().optional(),
});
export type DecisionInput = z.infer<typeof DecisionInput>;
