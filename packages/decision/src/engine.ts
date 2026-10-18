import {
  allowedResponses,
  type AllowedResponses,
  type DecisionAnalysis,
  type DecisionOption,
  type EvidenceLike,
  type Exhibit,
  type OfferType,
  type Policy,
  type TriageResult,
} from "@rebuttal/core";
import { evAccept, evFight } from "./ev.js";
import { optimizeOffer, type OfferChoice } from "./offer.js";
import { extractSignals, type Signals } from "./signals.js";
import type { DecisionCase } from "./types.js";
import {
  CALIBRATED_WEIGHTS,
  HAND_WEIGHTS,
  predictWin,
  type WinPrediction,
  type WinWeights,
} from "./win-model.js";

export const ENGINE_VERSION = "engine-v1";

export interface CaseAnalysis {
  signals: Signals;
  prediction: WinPrediction;
  allowed: AllowedResponses;
  weights: WinWeights;
}

export function weightsFor(policy: Policy): WinWeights {
  return policy.winModel === "calibrated" ? CALIBRATED_WEIGHTS : HAND_WEIGHTS;
}

/** Signals, p_win from the model, and what PayPal allows. No LLM, no side effects. */
export function analyzeCase(
  c: DecisionCase,
  evidence: readonly EvidenceLike[],
  policy: Policy,
  weights?: WinWeights,
): CaseAnalysis {
  const w = weights ?? weightsFor(policy);
  const signals = extractSignals(c, evidence);
  return {
    signals,
    prediction: predictWin(c, signals, w),
    allowed: allowedResponses(c.allowedResponseOptions, c.stage),
    weights: w,
  };
}

export interface LlmAdjustment {
  delta: number;
  reason: string;
  exhibits: string[];
  applied: boolean;
  ignoredBecause: string | null;
}

/**
 * The only way LLM output reaches the math (CLAUDE.md): a p_win nudge clamped to the
 * policy bound, applied only with a reason that cites exhibits that exist, and ignored
 * entirely when the agent saw an injection attempt in buyer text.
 */
export function llmAdjustment(
  triage: TriageResult | null,
  exhibits: readonly Exhibit[],
  policy: Policy,
): LlmAdjustment | null {
  if (!triage) return null;
  const bound = Math.min(policy.llm.maxAdjustment, 0.1);
  const known = new Set(exhibits.map((e) => e.exhibitId));
  const cited = triage.citedExhibits.filter((id) => known.has(id));
  const delta = Math.max(-bound, Math.min(bound, triage.pWinAdjustment));
  const ignore = (why: string): LlmAdjustment => ({
    delta: 0,
    reason: triage.adjustmentReason,
    exhibits: cited,
    applied: false,
    ignoredBecause: why,
  });
  if (!policy.llm.enabled) return ignore("LLM adjustments are disabled in policy");
  if (triage.injectionSuspected) return ignore("possible prompt injection in buyer or dispute text");
  if (delta === 0) return ignore("no adjustment proposed");
  if (!triage.adjustmentReason.trim()) return ignore("no reason given");
  if (!cited.length) return ignore("reason cites no known exhibit");
  return { delta, reason: triage.adjustmentReason, exhibits: cited, applied: true, ignoredBecause: null };
}

export interface EngineDecision {
  option: DecisionOption;
  pWin: number;
  evFight: number;
  evAccept: number;
  offer: OfferChoice | null;
  allowed: DecisionOption[];
  ranked: { option: DecisionOption; ev: number }[];
}

/** Pick the highest-EV option PayPal allows. Ties prefer ACCEPT, then OFFER (less work, less risk). */
export function chooseOption(
  c: DecisionCase,
  analysis: CaseAnalysis,
  policy: Policy,
  pWin: number,
): EngineDecision {
  const e = policy.economics;
  const amount = c.amount.cents;
  const fight = evFight(amount, pWin, e);
  const accept = evAccept(e);
  const offer = optimizeOffer({
    amountCents: amount,
    currency: c.amount.currency,
    pWin,
    allowedTypes: analysis.allowed.offerTypes,
    digital: analysis.signals.digital,
    economics: e,
    offer: policy.offer,
  });

  const candidates: { option: DecisionOption; ev: number }[] = [];
  if (analysis.allowed.accept) candidates.push({ option: "ACCEPT", ev: accept });
  if (offer) candidates.push({ option: "OFFER", ev: offer.evCents });
  if (analysis.allowed.fight) candidates.push({ option: "FIGHT", ev: fight });
  // Stable sort keeps the ACCEPT > OFFER > FIGHT tie order.
  const ranked = [...candidates].sort((a, b) => b.ev - a.ev);
  return {
    option: ranked[0]?.option ?? "ACCEPT",
    pWin,
    evFight: fight,
    evAccept: accept,
    offer,
    allowed: candidates.map((k) => k.option),
    ranked,
  };
}

export interface AutonomyResult {
  autoApprove: boolean;
  reasons: string[];
  /** "DEADLINE" when the deadline override fired. */
  reason?: "DEADLINE";
}

const HOUR = 3_600_000;

/** Autonomy rules (plan §1.6) and the deadline override (plan §3). */
export function autonomy(input: {
  c: DecisionCase;
  analysis: CaseAnalysis;
  decision: EngineDecision;
  policy: Policy;
  now: Date;
  injectionSuspected: boolean;
}): AutonomyResult {
  const { c, analysis, decision, policy, now } = input;
  const a = policy.autonomy;
  const due = c.sellerResponseDueAt ? Date.parse(c.sellerResponseDueAt) : NaN;
  if (Number.isFinite(due) && due - now.getTime() <= policy.deadlineAutoApproveHours * HOUR) {
    return {
      autoApprove: true,
      reason: "DEADLINE",
      reasons: [
        `response due within ${policy.deadlineAutoApproveHours}h with no approval: taking the safe default`,
      ],
    };
  }
  const blockers: string[] = [];
  if (!a.enabled) blockers.push("autonomy is off");
  if (!a.options.includes(decision.option)) blockers.push(`${decision.option} always needs approval`);
  if (c.amount.cents > a.maxAmountCents)
    blockers.push(`amount above the ${a.maxAmountCents} auto-file limit`);
  if (decision.option === "FIGHT") {
    if (decision.pWin < a.minPWinToFight)
      blockers.push(`p_win ${decision.pWin.toFixed(2)} below ${a.minPWinToFight}`);
    if (a.requireCompleteEvidence && !analysis.signals.completeness.requiredMet)
      blockers.push(`missing required evidence: ${analysis.signals.completeness.missingRequired.join(", ")}`);
  }
  if (input.injectionSuspected) blockers.push("possible prompt injection: a human must review");
  return blockers.length
    ? { autoApprove: false, reasons: blockers }
    : { autoApprove: true, reasons: ["within the merchant's autonomy rules"] };
}

/**
 * The deadline-safe choice: the EV pick, except a FIGHT without its required evidence
 * falls back to the best of OFFER/ACCEPT (an incomplete filing usually loses and adds a fee).
 */
export function safeOption(decision: EngineDecision, analysis: CaseAnalysis): DecisionOption {
  if (decision.option !== "FIGHT" || analysis.signals.completeness.requiredMet) return decision.option;
  return decision.ranked.find((r) => r.option !== "FIGHT")?.option ?? "FIGHT";
}

export interface FullDecision {
  analysis: CaseAnalysis;
  decision: EngineDecision;
  llm: LlmAdjustment | null;
  autonomy: AutonomyResult;
  /** The option to file: the EV pick, or the safe option under the deadline override. */
  option: DecisionOption;
  offerType: OfferType | null;
  offerAmountCents: number | null;
}

export function decideCase(input: {
  c: DecisionCase;
  evidence: readonly EvidenceLike[];
  policy: Policy;
  now: Date;
  exhibits?: readonly Exhibit[];
  triage?: TriageResult | null;
  /** Injection heuristics on buyer text: blocks autonomy even when no LLM ran. */
  injectionSuspected?: boolean;
  weights?: WinWeights;
}): FullDecision {
  const analysis = analyzeCase(input.c, input.evidence, input.policy, input.weights);
  const llm = llmAdjustment(input.triage ?? null, input.exhibits ?? [], input.policy);
  const pWin = Math.min(0.999, Math.max(0.001, analysis.prediction.pWin + (llm?.applied ? llm.delta : 0)));
  const decision = chooseOption(input.c, analysis, input.policy, pWin);
  const auto = autonomy({
    c: input.c,
    analysis,
    decision,
    policy: input.policy,
    now: input.now,
    injectionSuspected: !!input.injectionSuspected || !!input.triage?.injectionSuspected,
  });
  const option = auto.reason === "DEADLINE" ? safeOption(decision, analysis) : decision.option;
  const offer = option === "OFFER" ? decision.offer : null;
  return {
    analysis,
    decision,
    llm,
    autonomy: auto,
    option,
    offerType: offer?.type ?? null,
    offerAmountCents: offer && offer.type !== "REPLACEMENT_WITHOUT_REFUND" ? offer.amountCents : null,
  };
}

/** The Decision.analysis JSON: everything behind the choice, for the UI and the audit log. */
export function toDecisionAnalysis(
  d: FullDecision,
  extras: { exhibits: readonly Exhibit[]; triage: TriageResult | null; usage?: DecisionAnalysis["usage"] },
): DecisionAnalysis {
  const c = d.analysis.signals.completeness;
  return {
    engineVersion: `${ENGINE_VERSION}/${d.analysis.weights.version}`,
    pWinModel: d.analysis.prediction.pWin,
    pWin: d.decision.pWin,
    contributions: d.analysis.prediction.contributions,
    completeness: {
      score: c.score,
      requiredMet: c.requiredMet,
      missingRequired: c.missingRequired,
      missingOptional: c.missingOptional,
    },
    ev: {
      fightCents: d.decision.evFight,
      acceptCents: d.decision.evAccept,
      offer: d.decision.offer
        ? {
            type: d.decision.offer.type,
            amountCents: d.decision.offer.amountCents,
            pAccept: d.decision.offer.pAccept,
            evCents: d.decision.offer.evCents,
          }
        : null,
    },
    allowed: d.decision.allowed,
    chosen: d.option,
    llm: d.llm ? { ...d.llm, triage: extras.triage } : null,
    autonomy: { autoApprove: d.autonomy.autoApprove, reasons: d.autonomy.reasons },
    exhibits: extras.exhibits.map((e) => ({
      exhibitId: e.exhibitId,
      evidenceId: e.evidenceId,
      title: e.title,
      summary: e.summary,
    })),
    usage: extras.usage ?? [],
  };
}
