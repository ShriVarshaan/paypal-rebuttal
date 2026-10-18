import type { DecisionCase } from "./types.js";
import type { Signals } from "./signals.js";
import calibrated from "./weights.calibrated.json" with { type: "json" };

/**
 * p_win = logistic(base(reason) + stage + Σ wᵢ·xᵢ)  (plan §3).
 * Features are reason-aware: a feature that doesn't bear on this reason is 0, so one weight
 * vector serves every reason. Weights are hand-set; `pnpm eval:calibrate` tunes them on the
 * train half of the eval set and writes weights.calibrated.json.
 */
export const FEATURES = [
  "completeness",
  "required_met",
  "delivery_proof",
  "signature",
  "shipment_problem",
  "no_tracking",
  "digital_access",
  "listing_snapshot",
  "item_photos",
  "seller_responsive",
  "checkout_verified",
  "device_ip_match",
  "repeat_customer",
  "fraud_signals",
  "buyer_dispute_history",
  "refund_proof",
  "late_dispute",
  "amount_log",
] as const;
export type Feature = (typeof FEATURES)[number];
export type FeatureVector = Record<Feature, number>;

export interface WinWeights {
  version: string;
  /** Logit of the base win rate for each reason; `default` for anything else. */
  base: Record<string, number>;
  stage: Record<string, number>;
  features: FeatureVector;
}

const logit = (p: number) => Math.log(p / (1 - p));
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export const HAND_WEIGHTS: WinWeights = {
  version: "hand-v2",
  // Base win rates with no evidence at all. Assumptions agreed for the decision design; see
  // docs/decision-engine.md. Not-as-described is hardest to win, not-received easiest.
  base: {
    MERCHANDISE_OR_SERVICE_NOT_RECEIVED: logit(0.4),
    MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: logit(0.25),
    UNAUTHORISED: logit(0.3),
    CREDIT_NOT_PROCESSED: logit(0.25),
    DUPLICATE_TRANSACTION: logit(0.35),
    INCORRECT_AMOUNT: logit(0.3),
    CANCELED_RECURRING_BILLING: logit(0.3),
    PAYMENT_BY_OTHER_MEANS: logit(0.35),
    default: logit(0.25),
  },
  stage: { INQUIRY: 0, CHARGEBACK: -0.15, PRE_ARBITRATION: -0.3, ARBITRATION: -0.4 },
  features: {
    completeness: 1.2,
    required_met: 0.7,
    delivery_proof: 1.1,
    signature: 0.6,
    shipment_problem: -1.6,
    no_tracking: -1.2,
    digital_access: 1.3,
    listing_snapshot: 1.0,
    item_photos: 0.4,
    seller_responsive: 0.3,
    checkout_verified: 0.9,
    device_ip_match: 0.6,
    repeat_customer: 0.5,
    fraud_signals: -1.8,
    buyer_dispute_history: -0.8,
    refund_proof: 1.8,
    late_dispute: 0.2,
    amount_log: -0.15,
  },
};

/** Tuned weights from `pnpm eval:calibrate`; any feature missing from the file keeps its hand-set weight. */
export const CALIBRATED_WEIGHTS: WinWeights = {
  ...HAND_WEIGHTS,
  ...(calibrated as unknown as Partial<WinWeights>),
  features: { ...HAND_WEIGHTS.features, ...(calibrated as unknown as Partial<WinWeights>).features },
};

const NR = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED";
const NAD = "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED";
const UNAUTH = "UNAUTHORISED";
const REFUND_REASONS = new Set(["CREDIT_NOT_PROCESSED", "DUPLICATE_TRANSACTION", "PAYMENT_BY_OTHER_MEANS"]);

export function features(c: DecisionCase, s: Signals): FeatureVector {
  const physical = !s.digital;
  const shipping = physical && (c.reason === NR || c.reason === UNAUTH);
  const amountUsd = Math.max(1, c.amount.cents / 100);
  return {
    completeness: s.completeness.score - 0.5,
    required_met: s.completeness.requiredMet ? 1 : 0,
    // Delivery to another address is weak proof for not-received, and a fraud sign for unauthorised.
    delivery_proof:
      shipping && s.tracking === "delivered" ? (s.deliveredToAddress ? 1 : c.reason === NR ? 0.4 : 0) : 0,
    signature: c.reason === NR && physical && s.signature ? 1 : 0,
    shipment_problem:
      c.reason === NR && physical ? (s.tracking === "failed" ? 1 : s.tracking === "in_transit" ? 0.5 : 0) : 0,
    no_tracking: c.reason === NR && physical && s.tracking === "none" ? 1 : 0,
    digital_access:
      s.digital && (c.reason === NR || c.reason === UNAUTH || c.reason === NAD) && s.digitalAccess ? 1 : 0,
    listing_snapshot: c.reason === NAD && s.listingSnapshot ? 1 : 0,
    item_photos: c.reason === NAD && s.itemPhotos ? 1 : 0,
    seller_responsive: s.sellerReplied ? 1 : 0,
    checkout_verified: c.reason === UNAUTH && s.checkoutVerified ? 1 : 0,
    device_ip_match: c.reason === UNAUTH && s.deviceOrIpMatch ? 1 : 0,
    repeat_customer: c.reason === UNAUTH ? Math.min(1, Math.log2(1 + s.priorOrders) / 2) : 0,
    fraud_signals: c.reason === UNAUTH ? s.fraudSignals / 3 : 0,
    buyer_dispute_history: Math.min(3, s.priorDisputes) / 3,
    refund_proof: REFUND_REASONS.has(c.reason) && s.refundIssued ? 1 : 0,
    late_dispute: s.daysToDispute === null ? 0 : Math.min(1, s.daysToDispute / 180),
    amount_log: Math.log10(amountUsd / 50),
  };
}

export interface WinPrediction {
  pWin: number;
  logit: number;
  /** Per-feature contribution to the logit, largest magnitude first (the "why"). */
  contributions: { feature: string; value: number; contribution: number }[];
}

export function intercept(w: WinWeights, reason: string, stage: string): number {
  return (w.base[reason] ?? w.base["default"] ?? 0) + (w.stage[stage] ?? 0);
}

export function predictWin(c: DecisionCase, s: Signals, w: WinWeights = HAND_WEIGHTS): WinPrediction {
  const x = features(c, s);
  const base = intercept(w, c.reason, c.stage);
  const contributions = FEATURES.map((f) => ({
    feature: f,
    value: x[f],
    contribution: w.features[f] * x[f],
  }));
  const z = base + contributions.reduce((sum, k) => sum + k.contribution, 0);
  return {
    pWin: sigmoid(z),
    logit: z,
    contributions: [{ feature: "base_rate", value: 1, contribution: base }, ...contributions]
      .filter((k) => k.contribution !== 0)
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)),
  };
}
