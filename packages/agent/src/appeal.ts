import { NarrativeClaim, type AgentUsage, type AppealDraft, type CompletenessReport } from "@rebuttal/core";
import { z } from "zod";
import { caseBrief, exhibitDetail, exhibitIndex, type AgentCase, type AgentEvidence } from "./context.js";
import { AgentError, runStructured, type LlmClient } from "./llm.js";
import { checkClaims } from "./narrative.js";
import { UNTRUSTED_RULES } from "./untrusted.js";

const SYSTEM = `A small online seller lost a PayPal dispute. Explain, for the seller, the most likely reasons it was lost given the evidence that was filed, and what new evidence an appeal would need. PayPal only reconsiders an appeal with new information, so recommend appealing only if the missing evidence is something the seller could realistically obtain and the amount justifies the effort.

Every claim in the appeal statement must cite exhibit ids (EX-n) and use only facts in them. Keep the loss analysis under 150 words.

${UNTRUSTED_RULES}`;

const Output = z.object({
  lossAnalysis: z.string().min(1).max(1500),
  newEvidenceNeeded: z.array(z.string().max(300)).max(8),
  recommendAppeal: z.boolean(),
  claims: z.array(NarrativeClaim).max(10),
});

export interface AppealInput {
  c: AgentCase;
  evidence: AgentEvidence;
  completeness: CompletenessReport;
  /** What was filed: FIGHT, OFFER or ACCEPT, and the note sent. */
  filed: { option: string; note: string } | null;
}

export function templateAppeal(input: AppealInput): AppealDraft {
  const missing = input.completeness.requirements.filter((r) => !r.met);
  const required = missing.filter((r) => r.level === "required");
  return {
    lossAnalysis: required.length
      ? `The filing lacked required evidence for ${input.c.reason}: ${required.map((r) => r.label.toLowerCase()).join("; ")}. PayPal usually rules for the buyer when that evidence is missing.`
      : "All required evidence was filed, so the decision likely turned on the buyer's account of events or on details PayPal weighed differently. An appeal needs new information, not a restatement.",
    newEvidenceNeeded: missing.map((r) => r.hint),
    recommendAppeal: false,
    claims: [],
    source: "template",
  };
}

export async function draftAppeal(
  llm: LlmClient | null,
  input: AppealInput,
): Promise<{ draft: AppealDraft; usage: AgentUsage[]; error: string | null }> {
  const fallback = templateAppeal(input);
  if (!llm) return { draft: fallback, usage: [], error: null };
  const facts = caseBrief(input.c);
  try {
    const { output, usage } = await runStructured(llm, {
      agent: "appeal",
      role: "reasoning",
      system: SYSTEM,
      prompt: `Case:\n${facts}\n\nWhat was filed: ${input.filed ? `${input.filed.option} — ${input.filed.note}` : "nothing"}.\n\nEvidence requirements:\n${JSON.stringify(input.completeness.requirements.map((r) => ({ id: r.id, level: r.level, met: r.met, hint: r.hint })))}\n\nExhibits:\n${exhibitIndex(input.evidence)}\n\n${input.evidence.exhibits.map((e) => exhibitDetail(input.evidence, e.exhibitId)).join("\n\n")}\n\nReturn the appeal JSON.`,
      schema: Output,
      effort: "medium",
    });
    const claims = checkClaims(output.claims, input.evidence, facts)
      .filter((k) => k.ok)
      .map((k) => k.claim);
    return { draft: { ...output, claims, source: "claude" }, usage, error: null };
  } catch (err) {
    return {
      draft: fallback,
      usage: err instanceof AgentError ? err.usage : [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
