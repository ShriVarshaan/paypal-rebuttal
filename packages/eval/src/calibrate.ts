import {
  extractSignals,
  features,
  FEATURES,
  HAND_WEIGHTS,
  intercept,
  sigmoid,
  type WinWeights,
} from "@rebuttal/decision";
import type { EvalCase } from "./schema.js";
import { toDecisionCase } from "./world.js";

/**
 * Deterministic 50/50 split, stratified by reason: within each reason, cases sorted by id
 * alternate train/test (plan Day 13: 30/30).
 */
export function split(cases: EvalCase[]): { train: EvalCase[]; test: EvalCase[] } {
  const byReason = new Map<string, EvalCase[]>();
  for (const c of [...cases].sort((a, b) => a.id.localeCompare(b.id)))
    byReason.set(c.dispute.reason, [...(byReason.get(c.dispute.reason) ?? []), c]);
  const train: EvalCase[] = [];
  const test: EvalCase[] = [];
  let flip = 0;
  for (const group of byReason.values()) for (const c of group) (flip++ % 2 === 0 ? train : test).push(c);
  return { train, test };
}

export interface CalibrationResult {
  weights: WinWeights;
  trainLoss: { before: number; after: number };
  iterations: number;
  lambda: number;
  /** Mean held-out log-loss per λ from k-fold CV on the train split. */
  cv?: { lambda: number; loss: number }[];
}

const LAMBDAS = [0.3, 1, 3, 10, 30, 100];

function logLoss(cases: EvalCase[], w: WinWeights): number {
  let l = 0;
  for (const c of cases) {
    const dc = toDecisionCase(c);
    const x = features(dc, extractSignals(dc, c.evidence));
    const p = sigmoid(
      intercept(w, dc.reason, dc.stage) + FEATURES.reduce((s, f) => s + w.features[f] * x[f], 0),
    );
    l -= c.truth.wins ? Math.log(Math.max(p, 1e-9)) : Math.log(Math.max(1 - p, 1e-9));
  }
  return l / cases.length;
}

/**
 * Picks the L2 strength by k-fold cross-validation inside the train split (the test split
 * is never touched), then refits on all of train.
 */
export function calibrateCv(train: EvalCase[], k = 5): CalibrationResult {
  const sorted = [...train].sort((a, b) => a.id.localeCompare(b.id));
  const folds = Array.from({ length: k }, (_, i) => sorted.filter((_, j) => j % k === i));
  const cv = LAMBDAS.map((lambda) => ({
    lambda,
    loss:
      folds.reduce(
        (s, held) =>
          s +
          logLoss(
            held,
            calibrate(
              sorted.filter((c) => !held.includes(c)),
              { lambda },
            ).weights,
          ),
        0,
      ) / k,
  }));
  const best = cv.reduce((a, b) => (b.loss < a.loss ? b : a));
  return { ...calibrate(train, { lambda: best.lambda }), cv };
}

/**
 * Tunes the hand-set weights on the train split: logistic regression on the realized
 * outcomes, with an L2 penalty pulling every weight back towards its hand-set value (30
 * cases can't support 18 free parameters, so the hand weights act as the prior). Fits the
 * feature weights plus one shared shift of the base rates.
 */
export function calibrate(
  train: EvalCase[],
  opts: { lambda?: number; lr?: number; iterations?: number; prior?: WinWeights } = {},
): CalibrationResult {
  const prior = opts.prior ?? HAND_WEIGHTS;
  const lambda = opts.lambda ?? 0.5;
  const lr = opts.lr ?? 0.05;
  const iterations = opts.iterations ?? 4000;
  const rows = train.map((c) => {
    const dc = toDecisionCase(c);
    const x = features(dc, extractSignals(dc, c.evidence));
    return {
      x: FEATURES.map((f) => x[f]),
      base: intercept(prior, dc.reason, dc.stage),
      y: c.truth.wins ? 1 : 0,
    };
  });
  const w0 = FEATURES.map((f) => prior.features[f]);
  const w = [...w0];
  let shift = 0;

  const loss = () => {
    let l = 0;
    for (const r of rows) {
      const p = sigmoid(r.base + shift + r.x.reduce((s, xi, i) => s + xi * w[i]!, 0));
      l -= r.y * Math.log(Math.max(p, 1e-9)) + (1 - r.y) * Math.log(Math.max(1 - p, 1e-9));
    }
    return l / rows.length;
  };
  const before = loss();
  for (let it = 0; it < iterations; it++) {
    const g = new Array<number>(w.length).fill(0);
    let gs = 0;
    for (const r of rows) {
      const err = sigmoid(r.base + shift + r.x.reduce((s, xi, i) => s + xi * w[i]!, 0)) - r.y;
      r.x.forEach((xi, i) => (g[i]! += err * xi));
      gs += err;
    }
    // Gradient step on the log-loss, then a proximal step for the L2 pull towards the prior
    // (stable for any λ, unlike folding the penalty into the gradient).
    const pull = (lr * lambda) / rows.length;
    for (let i = 0; i < w.length; i++)
      w[i] = (w[i]! - (lr * g[i]!) / rows.length + pull * w0[i]!) / (1 + pull);
    shift = (shift - (lr * gs) / rows.length) / (1 + pull);
  }
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return {
    weights: {
      version: "calibrated-v1",
      base: Object.fromEntries(Object.entries(prior.base).map(([k, v]) => [k, round(v + shift)])),
      stage: prior.stage,
      features: Object.fromEntries(FEATURES.map((f, i) => [f, round(w[i]!)])) as WinWeights["features"],
    },
    trainLoss: { before, after: loss() },
    iterations,
    lambda,
  };
}
