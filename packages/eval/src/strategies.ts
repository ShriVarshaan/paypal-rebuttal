import { runTriage, type Budget, type LlmClient } from "@rebuttal/agent";
import {
  assignExhibits,
  DEFAULT_POLICY,
  type AgentUsage,
  type DecisionOption,
  type OfferType,
  type Policy,
  type TriageResult,
} from "@rebuttal/core";
import { analyzeCase, decideCase, HAND_WEIGHTS, type WinWeights } from "@rebuttal/decision";
import type { EvalCase } from "./schema.js";
import { decisionTime, toDecisionCase } from "./world.js";

export interface StrategyOutput {
  option: DecisionOption;
  /** Probability of winning a fight, for strategies that estimate one (Brier score). */
  pWin: number | null;
  offerType?: OfferType | null;
  offerAmountCents?: number | null;
}

export interface Strategy {
  id: string;
  label: string;
  needsLlm: boolean;
  run(c: EvalCase): Promise<StrategyOutput> | StrategyOutput;
}

export const alwaysFight: Strategy = {
  id: "always-fight",
  label: "Always fight",
  needsLlm: false,
  run: () => ({ option: "FIGHT", pWin: null }),
};
export const alwaysRefund: Strategy = {
  id: "always-refund",
  label: "Always refund (accept)",
  needsLlm: false,
  run: () => ({ option: "ACCEPT", pWin: null }),
};

/** Rules only: fight exactly when the matrix's required evidence is all there. No model, no EV. */
export const rulesOnly: Strategy = {
  id: "rules-only",
  label: "Rules only (matrix)",
  needsLlm: false,
  run: (c) => {
    const a = analyzeCase(toDecisionCase(c), c.evidence, DEFAULT_POLICY);
    return { option: a.signals.completeness.requiredMet ? "FIGHT" : "ACCEPT", pWin: null };
  },
};

export function engine(
  id: string,
  label: string,
  weights: WinWeights = HAND_WEIGHTS,
  policy: Policy = DEFAULT_POLICY,
): Strategy {
  return {
    id,
    label,
    needsLlm: false,
    run: (c) => {
      const d = decideCase({
        c: toDecisionCase(c),
        evidence: c.evidence,
        policy,
        now: decisionTime(c),
        weights,
      });
      return {
        option: d.option,
        pWin: d.decision.pWin,
        offerType: d.offerType,
        offerAmountCents: d.offerAmountCents,
      };
    },
  };
}

export interface TriageCache {
  get(id: string): { triage: TriageResult; usage: AgentUsage[] } | undefined;
  set(id: string, v: { triage: TriageResult; usage: AgentUsage[] }): void;
}

/**
 * One Claude triage per case, cached, shared by the LLM-only and hybrid strategies. Every
 * call is charged to `budget`; once it's spent, uncached cases fail and the run reports it.
 */
export function triageRunner(
  llm: LlmClient | null,
  cache: TriageCache,
  policy: Policy = DEFAULT_POLICY,
  budget?: Budget,
) {
  return async (c: EvalCase) => {
    const hit = cache.get(c.id);
    if (hit) return hit;
    if (!llm) throw new Error("no Claude client and no cached triage");
    const dc = toDecisionCase(c);
    const exhibits = assignExhibits(c.evidence);
    const out = await runTriage(llm, {
      c: { ...dc, messages: c.dispute.messages, items: c.dispute.items },
      evidence: { exhibits, items: c.evidence },
      analysis: analyzeCase(dc, c.evidence, policy),
      policy,
      ...(budget ? { budget } : {}),
    });
    const v = { triage: out.result, usage: out.usage };
    cache.set(c.id, v);
    return v;
  };
}

/** LLM only: Claude's advisory suggestedOption, taken at face value (the ablation's straw man). */
export function llmOnly(triage: ReturnType<typeof triageRunner>): Strategy {
  return {
    id: "llm-only",
    label: "Claude only",
    needsLlm: true,
    run: async (c) => {
      const { triage: t } = await triage(c);
      const d = decideCase({
        c: toDecisionCase(c),
        evidence: c.evidence,
        policy: DEFAULT_POLICY,
        now: decisionTime(c),
      });
      // An LLM-only offer still needs an amount; borrow the optimizer's so the comparison is about the choice.
      return {
        option: t.suggestedOption,
        pWin: null,
        offerType: d.decision.offer?.type ?? "REFUND",
        offerAmountCents: d.decision.offer?.amountCents ?? Math.round(c.dispute.amountCents / 2),
      };
    },
  };
}

/** Hybrid (production): the engine, with Claude's cited, clamped p_win nudge. */
export function hybrid(
  triage: ReturnType<typeof triageRunner>,
  weights: WinWeights = HAND_WEIGHTS,
): Strategy {
  return {
    id: "hybrid",
    label: "Hybrid (engine + Claude nudge)",
    needsLlm: true,
    run: async (c) => {
      const { triage: t } = await triage(c);
      const d = decideCase({
        c: toDecisionCase(c),
        evidence: c.evidence,
        policy: DEFAULT_POLICY,
        now: decisionTime(c),
        weights,
        exhibits: assignExhibits(c.evidence),
        triage: t,
      });
      return {
        option: d.option,
        pWin: d.decision.pWin,
        offerType: d.offerType,
        offerAmountCents: d.offerAmountCents,
      };
    },
  };
}
