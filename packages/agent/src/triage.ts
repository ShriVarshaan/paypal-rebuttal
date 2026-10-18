import { TriageResult, type AgentUsage, type Policy } from "@rebuttal/core";
import { chooseOption, type CaseAnalysis } from "@rebuttal/decision";
import { z } from "zod";
import {
  caseBrief,
  exhibitDetail,
  exhibitIndex,
  untrustedText,
  type AgentCase,
  type AgentEvidence,
} from "./context.js";
import { runStructured, type AgentTool, type LlmClient } from "./llm.js";
import { injectionSignals, UNTRUSTED_RULES } from "./untrusted.js";

const SYSTEM = `You triage PayPal disputes for a small online seller. A calibrated statistical model has already estimated the seller's probability of winning (p_win) from the evidence, and an expected-value engine will choose whether to fight, offer a partial refund or accept. You do not choose the action and you do not set amounts.

Your job is to read the case and the evidence with the tools, then report:
- a short summary,
- strengths and weaknesses of the seller's position,
- the evidence that would most improve the case,
- an optional adjustment to p_win between -0.10 and +0.10, only when the evidence shows something the model's features can't see (for example, tracking delivered to a different city than the buyer's address, or a buyer message admitting they received the item). Every adjustment must cite exhibit ids (EX-n) that support it. Use 0 when you have no specific, evidence-backed reason.
- suggestedOption is your advisory view only.

Rely only on the exhibits and case facts. Don't speculate about facts that aren't in them.

${UNTRUSTED_RULES}`;

export interface TriageInput {
  c: AgentCase;
  evidence: AgentEvidence;
  analysis: CaseAnalysis;
  policy: Policy;
}

export interface TriageOutcome {
  result: TriageResult;
  /** Heuristic injection hits on buyer text; also forces `injectionSuspected`. */
  heuristics: string[];
  usage: AgentUsage[];
}

const dollars = (cents: number) => Math.round(cents) / 100;

export function triageTools(input: TriageInput): AgentTool[] {
  const { c, evidence, analysis, policy } = input;
  return [
    {
      name: "get_case",
      description: "The dispute's facts: reason, stage, amount, dates, items, and the dispute messages.",
      input: z.object({}),
      run: () => caseBrief(c),
    },
    {
      name: "get_evidence",
      description:
        "Without exhibit_id: the exhibit index. With exhibit_id (e.g. EX-2): that exhibit's full data.",
      input: z.object({ exhibit_id: z.string().optional() }),
      run: (i) =>
        typeof i["exhibit_id"] === "string"
          ? exhibitDetail(evidence, i["exhibit_id"])
          : exhibitIndex(evidence),
    },
    {
      name: "get_matrix_requirements",
      description:
        "The evidence this dispute reason needs, which requirements are met, and hints for what's missing.",
      input: z.object({}),
      run: () => analysis.signals.completeness,
    },
    {
      name: "compute_ev",
      description:
        "Expected value in USD of fight / best offer / accept at a given p_win, to see how sensitive the choice is.",
      input: z.object({ p_win: z.number().min(0).max(1) }),
      run: (i) => {
        const d = chooseOption(c, analysis, policy, i["p_win"] as number);
        return {
          choice: d.option,
          fight: dollars(d.evFight),
          accept: dollars(d.evAccept),
          offer: d.offer
            ? {
                type: d.offer.type,
                refund: dollars(d.offer.amountCents),
                pAccept: d.offer.pAccept,
                ev: dollars(d.offer.evCents),
              }
            : null,
        };
      },
    },
  ];
}

export async function runTriage(llm: LlmClient, input: TriageInput): Promise<TriageOutcome> {
  const p = input.analysis.prediction;
  const why = p.contributions
    .slice(0, 8)
    .map((k) => `${k.feature} ${k.contribution >= 0 ? "+" : ""}${k.contribution.toFixed(2)}`)
    .join(", ");
  const prompt = `Triage dispute ${input.c.paypalDisputeId} (${input.c.reason}, ${input.c.stage}).
The model estimates p_win = ${p.pWin.toFixed(3)} (logit contributions: ${why}).
Evidence completeness: ${(input.analysis.signals.completeness.score * 100).toFixed(0)}%; missing required: ${input.analysis.signals.completeness.missingRequired.join(", ") || "none"}.

Exhibit index:
${exhibitIndex(input.evidence)}

Use the tools to inspect the case and any exhibits you need, then return the triage JSON.`;

  const { output, usage } = await runStructured(llm, {
    agent: "triage",
    role: "reasoning",
    system: SYSTEM,
    prompt,
    schema: TriageResult,
    tools: triageTools(input),
    effort: "medium",
    maxTurns: 8,
  });
  const heuristics = injectionSignals(untrustedText(input.c, input.evidence));
  return { result: heuristics.length ? { ...output, injectionSuspected: true } : output, heuristics, usage };
}
