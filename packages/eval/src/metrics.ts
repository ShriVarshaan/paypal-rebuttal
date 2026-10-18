import { DecisionOption, DEFAULT_POLICY } from "@rebuttal/core";
import { evOffer } from "@rebuttal/decision";
import type { EvalCase } from "./schema.js";
import type { StrategyOutput } from "./strategies.js";
import { realizedValue, trueEvOf, trueValues } from "./world.js";

export interface CaseResult {
  caseId: string;
  reason: string;
  label: DecisionOption;
  output: StrategyOutput;
  realizedCents: number;
  /** Expected value of the chosen action under the world's true p_win. */
  trueEvCents: number;
}

export interface Metrics {
  n: number;
  accuracy: number;
  confusion: Record<DecisionOption, Record<DecisionOption, number>>;
  /** Mean (p_win − outcome)²; null when the strategy gives no probability. */
  brier: number | null;
  /** Mean (p_win − true p_win)²: calibration against the world, less noisy than outcomes. */
  brierVsTruth: number | null;
  realizedCents: number;
  expectedCents: number;
  /** Expected value lost against the ex-ante best action, summed. */
  regretCents: number;
  byReason: Record<string, { n: number; correct: number }>;
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
      c.truth.pWin,
      policy.economics,
      policy.offer,
      c.dispute.reason,
    ).ev;
  }
  if (!Number.isFinite(trueEv)) trueEv = realizedValue(c, output);
  return {
    caseId: c.id,
    reason: c.dispute.reason,
    label: c.label.option,
    output,
    realizedCents: realizedValue(c, output),
    trueEvCents: trueEv,
  };
}

const emptyConfusion = () =>
  Object.fromEntries(
    DecisionOption.options.map((a) => [a, Object.fromEntries(DecisionOption.options.map((b) => [b, 0]))]),
  ) as Metrics["confusion"];

export function summarize(cases: EvalCase[], results: CaseResult[]): Metrics {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const confusion = emptyConfusion();
  const byReason: Metrics["byReason"] = {};
  let correct = 0;
  let brier = 0;
  let brierTruth = 0;
  let withP = 0;
  let regret = 0;
  for (const r of results) {
    const c = byId.get(r.caseId)!;
    confusion[r.label][r.output.option]++;
    const ok = r.label === r.output.option;
    if (ok) correct++;
    (byReason[r.reason] ??= { n: 0, correct: 0 }).n++;
    if (ok) byReason[r.reason]!.correct++;
    if (r.output.pWin !== null) {
      withP++;
      brier += (r.output.pWin - (c.truth.wins ? 1 : 0)) ** 2;
      brierTruth += (r.output.pWin - c.truth.pWin) ** 2;
    }
    regret += trueValues(c).best.ev - r.trueEvCents;
  }
  const n = results.length;
  return {
    n,
    accuracy: n ? correct / n : 0,
    confusion,
    brier: withP ? brier / withP : null,
    brierVsTruth: withP ? brierTruth / withP : null,
    realizedCents: results.reduce((s, r) => s + r.realizedCents, 0),
    expectedCents: results.reduce((s, r) => s + r.trueEvCents, 0),
    regretCents: regret,
    byReason,
  };
}
