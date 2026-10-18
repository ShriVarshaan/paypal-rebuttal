import {
  evidenceKind,
  toPayPalMoney,
  type DisputeMessage,
  type EvidenceLike,
  type Exhibit,
} from "@rebuttal/core";
import type { DecisionCase } from "@rebuttal/decision";
import { fence } from "./untrusted.js";

/** What the agents get to know about a case. */
export interface AgentCase extends DecisionCase {
  messages?: DisputeMessage[];
  items?: string[];
}

export interface AgentEvidence {
  exhibits: readonly Exhibit[];
  /** Same items the exhibits were assigned from; matched by EvidenceItem.id. */
  items: readonly EvidenceLike[];
}

const amount = (c: DecisionCase) => {
  const m = toPayPalMoney(c.amount);
  return `${m.value} ${m.currency_code}`;
};

/** Case facts as JSON-ish text; dispute messages are fenced as untrusted. */
export function caseBrief(c: AgentCase): string {
  const facts = {
    disputeId: c.paypalDisputeId,
    reason: c.reason,
    stage: c.stage,
    amount: amount(c),
    openedAt: c.paypalCreatedAt ?? null,
    paidAt: c.disputedTransactions?.[0]?.createdAt ?? null,
    responseDueAt: c.sellerResponseDueAt ?? null,
    items: c.items ?? c.transactionContext?.order?.items.map((i) => i.name) ?? [],
  };
  const msgs = (c.messages ?? []).map((m) => `[${m.postedAt ?? "?"}] ${m.postedBy}: ${m.content}`).join("\n");
  return `${JSON.stringify(facts, null, 2)}\n\nDispute messages:\n${msgs ? fence("paypal_dispute_messages", msgs) : "(none)"}`;
}

export function exhibitIndex(ev: AgentEvidence): string {
  return (
    ev.exhibits.map((e) => `${e.exhibitId} [${e.type}] ${e.title}: ${e.summary}`).join("\n") ||
    "(no evidence)"
  );
}

/** One exhibit's structured data. Message text inside it is fenced. */
export function exhibitDetail(ev: AgentEvidence, exhibitId: string): string {
  const ex = ev.exhibits.find((e) => e.exhibitId === exhibitId);
  if (!ex) return `No exhibit ${exhibitId}. Known: ${ev.exhibits.map((e) => e.exhibitId).join(", ")}`;
  const item = ev.items.find((i) => i.id && i.id === ex.evidenceId);
  if (!item) return `${ex.exhibitId}: ${ex.summary}`;
  if (evidenceKind(item) === "message_thread") {
    const { messages, ...rest } = item.data as {
      messages?: { from: string; at: string | null; text: string }[];
    };
    const transcript = (messages ?? []).map((m) => `[${m.at ?? "?"}] ${m.from}: ${m.text}`).join("\n");
    return `${ex.exhibitId} ${ex.title}\n${JSON.stringify(rest)}\n${fence("message_thread", transcript)}`;
  }
  return `${ex.exhibitId} ${ex.title}\n${JSON.stringify(item.data, null, 2)}`;
}

/** All text the buyer controls, for the injection heuristics. */
export function untrustedText(c: AgentCase, ev: AgentEvidence): string {
  const thread = ev.items
    .filter((i) => evidenceKind(i) === "message_thread")
    .flatMap((i) => (i.data["messages"] as { from?: string; text?: string }[] | undefined) ?? [])
    .filter((m) => m.from !== "SELLER")
    .map((m) => m.text ?? "");
  return [...(c.messages ?? []).filter((m) => m.postedBy !== "SELLER").map((m) => m.content), ...thread].join(
    "\n",
  );
}
