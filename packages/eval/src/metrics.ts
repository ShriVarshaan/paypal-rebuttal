import { DecisionOption, DEFAULT_POLICY } from "@rebuttal/core";
import { evOffer } from "@rebuttal/decision";
import { wins, type EvalCase } from "./schema.js";
import type { StrategyOutput } from "./strategies.js";
import { realizedValue, trueEvOf, trueValues } from "./world.js";

export interface CaseResult {
  caseId: string;
  reason: string;
  label: DecisionOption;
  acceptable: DecisionOption[];
  output: StrategyOutput;
  realizedCents: number;
  /** Expected value of the chosen action under the world's p_win. */
  trueEvCents: number;
}

export interface ReliabilityBucket {
  from: number;
  to: number;
  n: number;
  meanPredicted: number | null;
  winRate: number | null;
}

export interface Metrics {
  n: number;
  /** Chosen option is one of the label's acceptable options. */
  accuracy: number;
  /** Chosen option equals the label's best option. */
  strictAccuracy: number;
  confusion: Record<DecisionOption, Record<DecisionOption, number>>;
  /** Mean (p_win − 1[expected outcome is WIN])²; null when the strategy gives no probability. */
  brier: number | null;
  /** Mean (p_win − world p_win)²: calibration against the simulated world, less noisy. */
  brierVsWorld: number | null;
  /** Dollars the seller ends up with vs refunding everything, using the labeled outcomes. */
  realizedCents: number;
  /** The same under the world's p_win instead of the one labeled outcome. */
  expectedCents: number;
  /** Expected value given up against the ex-ante best action, summed. */
  regretCents: number;
  byReason: Record<string, { n: number; correct: number }>;
  /** Predicted p_win buckets vs actual win rate, for the reliability plot. */
  reliability: ReliabilityBucket[];
}

export function scoreCase(c: EvalCase, output: StrategyOutput): CaseResult {
  const policy = DEFAULT_POLICY;
  let trueEv = trueEvOf(c, output.option);
  if (output.option === "OFFER" && output.offerType) {
    // Score the offer actually made, not the best possible one.
    trueEv = evOffer(
      c.dispute.amountCents,
      output.offerAmountCents ?? 0,
      output.offerType,
      c.world.pWin,
      policy.economics,
      policy.offer,
      c.dispute.reason,
    ).ev;
  }
  if (!Number.isFinite(trueEv)) trueEv = realizedValue(c, output);
  return {
    caseId: c.id,
    reason: c.dispute.reason,
    label: c.label.bestOption,
    acceptable: c.label.acceptableOptions,
    output,
    realizedCents: realizedValue(c, output),
    trueEvCents: trueEv,
  };
}

const emptyConfusion = () =>
  Object.fromEntries(
    DecisionOption.options.map((a) => [a, Object.fromEntries(DecisionOption.options.map((b) => [b, 0]))]),
  ) as Metrics["confusion"];

const BUCKETS = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];

export function summarize(cases: EvalCase[], results: CaseResult[]): Metrics {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const confusion = emptyConfusion();
  const byReason: Metrics["byReason"] = {};
  let ok = 0;
  let strict = 0;
  let brier = 0;
  let brierWorld = 0;
  let withP = 0;
  let regret = 0;
  const probs: { p: number; win: boolean }[] = [];
  for (const r of results) {
    const c = byId.get(r.caseId)!;
    confusion[r.label][r.output.option]++;
    const good = r.acceptable.includes(r.output.option);
    if (good) ok++;
    if (r.output.option === r.label) strict++;
    (byReason[r.reason] ??= { n: 0, correct: 0 }).n++;
    if (good) byReason[r.reason]!.correct++;
    if (r.output.pWin !== null) {
      withP++;
      brier += (r.output.pWin - (wins(c) ? 1 : 0)) ** 2;
      brierWorld += (r.output.pWin - c.world.pWin) ** 2;
      probs.push({ p: r.output.pWin, win: wins(c) });
    }
    regret += trueValues(c).best.ev - r.trueEvCents;
  }
  const n = results.length;
  const reliability = BUCKETS.slice(0, -1).map((from, i) => {
    const to = BUCKETS[i + 1]!;
    const inB = probs.filter((x) => x.p >= from && x.p < to);
    return {
      from,
      to: Math.min(1, to),
      n: inB.length,
      meanPredicted: inB.length ? inB.reduce((s, x) => s + x.p, 0) / inB.length : null,
      winRate: inB.length ? inB.filter((x) => x.win).length / inB.length : null,
    };
  });
  return {
    n,
    accuracy: n ? ok / n : 0,
    strictAccuracy: n ? strict / n : 0,
    confusion,
    brier: withP ? brier / withP : null,
    brierVsWorld: withP ? brierWorld / withP : null,
    realizedCents: results.reduce((s, r) => s + r.realizedCents, 0),
    expectedCents: results.reduce((s, r) => s + r.trueEvCents, 0),
    regretCents: regret,
    byReason,
    reliability: withP ? reliability : [],
  };
}
