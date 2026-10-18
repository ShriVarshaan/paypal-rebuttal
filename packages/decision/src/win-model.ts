import type { DecisionCase } from "./types.js";
import type { Signals } from "./signals.js";
import v0 from "./weights.v0.json" with { type: "json" };
import calibrated from "./weights.v1.json" with { type: "json" };

/**
 * p_win = logistic(base(reason) + stage + Σ wᵢ·xᵢ)  (plan §3).
 * Features are reason-aware: a feature that doesn't bear on this reason is 0, so one weight
 * vector serves every reason. Weights are hand-set (weights.v0.json); `pnpm eval:calibrate`
 * tunes them on the train half of the eval set and writes weights.v1.json.
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

/** Hand-set weights (weights.v0.json, with a note on every weight). */
export const HAND_WEIGHTS: WinWeights = {
  version: v0.version,
  base: Object.fromEntries(Object.entries(v0.baseRates).map(([reason, p]) => [reason, logit(p)])),
  stage: v0.stage,
  features: v0.features,
};

/** Tuned weights (weights.v1.json, from `pnpm eval:calibrate`); missing features keep their v0 weight. */
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

const LABELS: Record<string, [string, string]> = {
  base_rate: ["Base rate for this reason and stage", "Base rate for this reason and stage"],
  completeness: ["Evidence completeness above average", "Evidence completeness below average"],
  required_met: ["All required evidence present", "Required evidence missing"],
  delivery_proof: ["Delivered to the shipping address on file", "Delivery proof"],
  signature: ["Signature confirmation", "Signature confirmation"],
  shipment_problem: ["Shipment problem", "Parcel not delivered or returned"],
  no_tracking: ["Tracking", "No delivery confirmation"],
  digital_access: ["Download/access logged after purchase", "Download/access log"],
  listing_snapshot: ["Listing snapshot from order time", "Listing snapshot"],
  item_photos: ["Photos of the item as shipped", "Photos"],
  seller_responsive: ["Seller replied to the buyer", "Seller didn't reply"],
  checkout_verified: ["AVS/CVV check passed", "Checkout check"],
  device_ip_match: ["Known device or IP", "Device/IP"],
  repeat_customer: ["Repeat customer with undisputed orders", "Customer history"],
  fraud_signals: ["Fraud signals", "Fraud signals (AVS mismatch, unknown device, other address)"],
  buyer_dispute_history: ["Buyer dispute history", "Buyer has disputed before"],
  refund_proof: ["Refund already issued", "Refund"],
  late_dispute: ["Dispute opened long after purchase", "Dispute timing"],
  amount_log: ["Small amount", "Larger amounts get more scrutiny"],
};

/** "Delivered to the shipping address on file: +1.10" — the why behind p_win, largest first. */
export function explain(p: WinPrediction): string[] {
  return p.contributions.map((k) => {
    const [up, down] = LABELS[k.feature] ?? [k.feature, k.feature];
    return `${k.contribution >= 0 ? up : down}: ${k.contribution >= 0 ? "+" : "−"}${Math.abs(k.contribution).toFixed(2)}`;
  });
}
