import { NarrativeClaim, type AgentUsage, type Exhibit, type Narrative } from "@rebuttal/core";
import { clampNote } from "@rebuttal/decision";
import { z } from "zod";
import { caseBrief, exhibitDetail, exhibitIndex, type AgentCase, type AgentEvidence } from "./context.js";
import { AgentError, runStructured, type Budget, type LlmClient } from "./llm.js";
import { UNTRUSTED_RULES } from "./untrusted.js";

const SYSTEM = `You write the seller's statement for a PayPal dispute the seller has decided to contest. The reader is a PayPal dispute specialist.

Write a short, factual, persuasive statement as a list of claims. Rules:
- Every claim must cite at least one exhibit id (EX-n) whose data supports it. A claim without a supporting exhibit will be deleted.
- Only state facts present in the cited exhibits or the case facts. Copy identifiers (tracking numbers, order ids, dates) exactly. Never invent a fact, a number or a quote.
- Neutral, professional tone; no accusations against the buyer.
- 3 to 8 claims, each one or two sentences. The headline is one sentence stating the seller's position.

${UNTRUSTED_RULES}`;

const NarrativeOutput = z.object({
  headline: z.string().min(1).max(200),
  claims: z.array(NarrativeClaim).min(1).max(12),
});

// Tracking numbers, order ids, ISO dates: 10+ letters/digits/hyphens including a digit.
const IDENTIFIER = /\b(?=[A-Z0-9-]*\d)[A-Z0-9-]{10,}\b/g;
const MONEY = /\$\s?(\d+(?:,\d{3})*(?:\.\d{2})?)/g;

export interface ClaimCheck {
  claim: z.infer<typeof NarrativeClaim>;
  ok: boolean;
  why: string | null;
}

/**
 * Keeps a claim only if every exhibit it cites exists, and every identifier and dollar amount
 * it mentions appears in the cited exhibits' data or the case facts (a cheap grounding check
 * against invented tracking numbers and amounts).
 */
export function checkClaims(
  claims: z.infer<typeof NarrativeClaim>[],
  ev: AgentEvidence,
  caseFacts: string,
): ClaimCheck[] {
  const known = new Set(ev.exhibits.map((e) => e.exhibitId));
  return claims.map((claim) => {
    const unknown = claim.exhibits.filter((id) => !known.has(id));
    if (!claim.exhibits.length) return { claim, ok: false, why: "no citation" };
    if (unknown.length) return { claim, ok: false, why: `cites unknown ${unknown.join(", ")}` };
    const source = `${claim.exhibits.map((id) => exhibitDetail(ev, id)).join("\n")}\n${caseFacts}`;
    const sourceUpper = source.toUpperCase();
    const ids = [...claim.text.toUpperCase().matchAll(IDENTIFIER)]
      .map((m) => m[0])
      .filter((id) => !/^EX-\d+$/.test(id));
    const missingId = ids.find((id) => !sourceUpper.includes(id));
    if (missingId) return { claim, ok: false, why: `identifier ${missingId} not in the cited exhibits` };
    const cents = new Set(
      [...source.matchAll(/\d+(?:\.\d+)?/g)].flatMap((m) => {
        const n = Number(m[0]);
        return [Math.round(n), Math.round(n * 100)];
      }),
    );
    const badMoney = [...claim.text.matchAll(MONEY)].find(
      (m) => !cents.has(Math.round(Number(m[1]!.replace(/,/g, "")) * 100)),
    );
    if (badMoney) return { claim, ok: false, why: `amount ${badMoney[0]} not in the cited exhibits` };
    return { claim, ok: true, why: null };
  });
}

const HEADLINES: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "The order was delivered as described in the evidence below.",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "The item matched its listing at the time of purchase.",
  UNAUTHORISED: "This purchase was made by the account holder.",
  CREDIT_NOT_PROCESSED: "The credit owed to the buyer has already been processed.",
  DUPLICATE_TRANSACTION: "The two charges are for separate orders.",
  INCORRECT_AMOUNT: "The buyer was charged the amount agreed at checkout.",
  CANCELED_RECURRING_BILLING: "The subscription was active when this charge was made.",
};

/**
 * The provide-evidence request has one note per evidence_type: the headline plus the claims
 * that cite exhibits of that type.
 */
export function notesByEvidenceType(
  headline: string,
  claims: Narrative["claims"],
  exhibits: readonly Exhibit[],
): Record<string, string> {
  const typeOf = new Map(exhibits.map((e) => [e.exhibitId, e.type]));
  const byType = new Map<string, string[]>();
  for (const k of claims)
    for (const t of new Set(k.exhibits.map((id) => typeOf.get(id)).filter((t): t is string => !!t)))
      byType.set(t, [...(byType.get(t) ?? []), `- ${k.text} (${k.exhibits.join(", ")})`]);
  return Object.fromEntries([...byType].map(([t, lines]) => [t, clampNote([headline, ...lines].join("\n"))]));
}

/** Deterministic statement from exhibit summaries: offline mode and the fallback. */
export function templateNarrative(
  c: AgentCase,
  exhibits: readonly Exhibit[],
  opts: { needsReview?: boolean } = {},
): Narrative {
  const claims = exhibits.slice(0, 8).map((e) => ({ text: `${e.summary}.`, exhibits: [e.exhibitId] }));
  const headline = HEADLINES[c.reason] ?? "The seller contests this dispute based on the records below.";
  return {
    headline,
    claims,
    source: "template",
    rejectedClaims: 0,
    needsReview: opts.needsReview ?? false,
    notesByType: notesByEvidenceType(headline, claims, exhibits),
  };
}

/** The 2000-char PayPal note: headline plus claims with their exhibit citations. */
export function narrativeToNote(n: Narrative): string {
  return clampNote([n.headline, ...n.claims.map((k) => `- ${k.text} (${k.exhibits.join(", ")})`)].join("\n"));
}

export interface NarrativeOutcome {
  narrative: Narrative;
  usage: AgentUsage[];
  error: string | null;
}

/**
 * Claude drafts; the validator keeps only cited, grounded claims. Two failed drafts fall back
 * to the template with needsReview set, so a human rewrites it before filing.
 */
export async function writeNarrative(
  llm: LlmClient | null,
  c: AgentCase,
  ev: AgentEvidence,
  opts: { budget?: Budget } = {},
): Promise<NarrativeOutcome> {
  if (!llm || !ev.exhibits.length)
    return { narrative: templateNarrative(c, ev.exhibits), usage: [], error: null };
  const facts = caseBrief(c);
  const details = ev.exhibits.map((e) => exhibitDetail(ev, e.exhibitId)).join("\n\n");
  const usage: AgentUsage[] = [];
  let feedback = "";
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await runStructured(llm, {
        agent: "narrative",
        role: "reasoning",
        system: SYSTEM,
        prompt: `Case facts:\n${facts}\n\nExhibits:\n${exhibitIndex(ev)}\n\nExhibit data:\n${details}${feedback}\n\nReturn the statement JSON.`,
        schema: NarrativeOutput,
        effort: "medium",
        ...(opts.budget ? { budget: opts.budget } : {}),
      });
      usage.push(...res.usage);
      const checks = checkClaims(res.output.claims, ev, facts);
      const kept = checks.filter((k) => k.ok).map((k) => k.claim);
      const rejected = checks.filter((k) => !k.ok);
      // Accept when most claims survive; otherwise explain what failed and try once more.
      if (kept.length && rejected.length <= kept.length / 2) {
        return {
          narrative: {
            headline: res.output.headline,
            claims: kept,
            source: "claude",
            rejectedClaims: rejected.length,
            needsReview: false,
            notesByType: notesByEvidenceType(res.output.headline, kept, ev.exhibits),
          },
          usage,
          error: null,
        };
      }
      feedback = `\n\nYour previous draft had claims rejected:\n${rejected.map((r) => `- "${r.claim.text}": ${r.why}`).join("\n")}\nFix them.`;
    }
    throw new AgentError("narrative: too many claims failed validation");
  } catch (err) {
    if (err instanceof AgentError) usage.push(...err.usage);
    return {
      narrative: templateNarrative(c, ev.exhibits, { needsReview: true }),
      usage,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
