// Decision engine (plan §3). Math chooses the action; the LLM may only nudge p_win.
import {
  assignExhibits,
  DEFAULT_POLICY,
  type Case,
  type DecisionInput,
  type EvidenceItem,
  type Policy,
} from "@rebuttal/core";
import { decideCase } from "./engine.js";
import { ACCEPT_NOTE, fightNote, offerNote } from "./notes.js";
import type { DecisionCase } from "./types.js";

export * from "./types.js";
export * from "./signals.js";
export * from "./win-model.js";
export * from "./ev.js";
export * from "./offer.js";
export * from "./engine.js";
export * from "./notes.js";

export interface SafeDefaultInput {
  case: Pick<Case, "paypalDisputeId" | "reason" | "stage" | "amount"> & Partial<DecisionCase>;
  evidence: (Pick<EvidenceItem, "type" | "data"> & { source?: string; id?: string; title?: string })[];
  policy?: Policy;
  now?: Date;
}

/**
 * The SLA scheduler's forced decision at T-2h: the engine without the LLM, restricted to
 * the deadline-safe option (a FIGHT missing required evidence becomes an offer or accept).
 */
export function safeDefault(input: SafeDefaultInput): DecisionInput {
  const evidence = input.evidence.map((e) => ({ source: e.source ?? "unknown", ...e }));
  const policy = input.policy ?? DEFAULT_POLICY;
  const d = decideCase({
    c: input.case,
    evidence,
    // Force the deadline branch: this only runs when the deadline is upon us.
    policy: { ...policy, deadlineAutoApproveHours: Number.POSITIVE_INFINITY },
    now: input.now ?? new Date(),
  });
  const base = { reason: "DEADLINE" } as const;
  switch (d.option) {
    case "FIGHT":
      return { ...base, option: "FIGHT", note: fightNote(assignExhibits(evidence)) };
    case "OFFER":
      return {
        ...base,
        option: "OFFER",
        offerType: d.offerType ?? "REFUND",
        ...(d.offerAmountCents != null
          ? { offerAmount: { cents: d.offerAmountCents, currency: input.case.amount.currency } }
          : {}),
        note: offerNote(d.offerType ?? "REFUND", {
          cents: d.offerAmountCents ?? 0,
          currency: input.case.amount.currency,
        }),
      };
    default:
      return { ...base, option: "ACCEPT", note: ACCEPT_NOTE };
  }
}
