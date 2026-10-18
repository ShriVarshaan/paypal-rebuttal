import { z } from "zod";
import { DecisionOption } from "./decision.js";

/**
 * Per-merchant policy: autonomy rules plus the economic assumptions the EV engine uses.
 * All money is in minor units of the dispute currency. Every default is a documented
 * assumption (docs/decision-engine.md); merchants override them in settings.
 */
export const AutonomyPolicy = z.object({
  /** Off = every decision waits for a human. */
  enabled: z.boolean().default(true),
  /** "auto-file when amount < $50 and p_win > 0.8; otherwise ask for approval" (plan §1.6). */
  maxAmountCents: z.number().int().nonnegative().default(5000),
  minPWinToFight: z.number().min(0).max(1).default(0.8),
  /** Options the engine may file without approval. */
  options: z.array(DecisionOption).default(["FIGHT", "ACCEPT"]),
  /** Never auto-file a FIGHT when a required piece of evidence is missing. */
  requireCompleteEvidence: z.boolean().default(true),
  /** A FIGHT also needs this evidence completeness score to auto-file. */
  minCompletenessToFight: z.number().min(0).max(1).default(0.8),
  /** Dispute reasons that always need a human, whatever the numbers say. */
  requireApprovalReasons: z.array(z.string()).default([]),
});
export type AutonomyPolicy = z.infer<typeof AutonomyPolicy>;

export const Economics = z.object({
  /** Fee charged when a fought dispute is lost (PayPal dispute/chargeback fee). */
  lossFeeCents: z.number().int().nonnegative().default(2000),
  laborCostPerHourCents: z.number().int().nonnegative().default(3000),
  fightMinutes: z.number().nonnegative().default(20),
  offerMinutes: z.number().nonnegative().default(8),
  acceptMinutes: z.number().nonnegative().default(2),
  /** Share of the price recovered when an item comes back. Returned "not as described" items rarely resell at full price. */
  returnRecoveryRatio: z.number().min(0).max(1).default(0.3),
  returnShippingCents: z.number().int().nonnegative().default(800),
  /** Cost of a replacement as a share of the price (cost of goods + shipping). */
  replacementCostRatio: z.number().min(0).max(1).default(0.45),
  /** Merchant's current dispute ratio and the level where PayPal starts reviewing accounts. */
  disputeRatio: z.number().min(0).max(1).default(0.004),
  disputeRatioThreshold: z.number().min(0).max(1).default(0.01),
  /** Cost of one more lost dispute when the ratio is at the threshold; scales linearly below it. */
  ratioPenaltyCents: z.number().int().nonnegative().default(1500),
});
export type Economics = z.infer<typeof Economics>;

export const OfferPolicy = z.object({
  minRatio: z.number().min(0).max(1).default(0.1),
  maxRatio: z.number().min(0).max(1).default(0.9),
  step: z.number().positive().max(0.5).default(0.05),
  /**
   * Assumed buyer acceptance curve P_accept(r) = 1 / (1 + e^(-steepness·(r - midpoint))),
   * r = offer / amount. A documented assumption, not fitted (plan §3).
   */
  acceptMidpoint: z.number().min(0).max(1).default(0.45),
  acceptSteepness: z.number().positive().default(9),
  /** Buyers are less keen when they must ship the item back. */
  returnAcceptPenalty: z.number().min(0).max(1).default(0.15),
  /**
   * Shift of the curve's midpoint by dispute reason. Not-as-described buyers usually want
   * compensation and accept less; not-received buyers want the item or all their money.
   */
  reasonShift: z
    .record(z.string(), z.number().min(-0.5).max(0.5))
    .default({ MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: -0.05, MERCHANDISE_OR_SERVICE_NOT_RECEIVED: 0.1 }),
});
export type OfferPolicy = z.infer<typeof OfferPolicy>;

export const Policy = z.object({
  autonomy: AutonomyPolicy.prefault({}),
  economics: Economics.prefault({}),
  offer: OfferPolicy.prefault({}),
  /** Due within this many hours and nobody approved: the engine's choice is auto-approved. */
  deadlineAutoApproveHours: z.number().nonnegative().default(24),
  llm: z
    .object({
      enabled: z.boolean().default(true),
      /** CLAUDE.md: the LLM may move p_win by at most ±0.10, with a cited reason. */
      maxAdjustment: z.number().min(0).max(0.1).default(0.1),
    })
    .prefault({}),
  /** Which win-model weights to use: hand-set, or tuned on the eval train split. */
  winModel: z.enum(["hand", "calibrated"]).default("hand"),
});
export type Policy = z.infer<typeof Policy>;

export const DEFAULT_POLICY: Policy = Policy.parse({});

/** Parses a stored policy, falling back to defaults for anything missing or invalid. */
export function policyFrom(raw: unknown): Policy {
  const parsed = Policy.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DEFAULT_POLICY;
}
