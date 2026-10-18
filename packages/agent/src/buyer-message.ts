import type { AgentUsage, BuyerMessageDraft, DecisionOption, Money, OfferType } from "@rebuttal/core";
import { money } from "@rebuttal/decision";
import { z } from "zod";
import { caseBrief, type AgentCase } from "./context.js";
import { runStructured, type LlmClient } from "./llm.js";
import { UNTRUSTED_RULES } from "./untrusted.js";

const SYSTEM = `You draft a short message from a small online seller to a buyer who opened a PayPal dispute. The seller reviews it before it is sent through PayPal.

Goals: de-escalate, be warm and specific, and explain the seller's next step. Rules:
- Mention money only as the exact amount given to you as the offer, if there is one. Never promise anything else (no extra refunds, discounts, deadlines or shipping) that isn't in the brief.
- No links, email addresses or phone numbers.
- Under 120 words, plain text, no subject line, signed "— The team".

${UNTRUSTED_RULES}`;

const Output = z.object({ message: z.string().min(1).max(1500) });

export interface BuyerMessageInput {
  c: AgentCase;
  option: DecisionOption;
  offer?: { type: OfferType; amount: Money } | null;
}

/** Template drafts, also the fallback when the model's draft fails the checks. */
export function templateBuyerMessage(input: BuyerMessageInput): string {
  const item = input.c.items?.[0] ?? "your order";
  switch (input.option) {
    case "OFFER":
      return input.offer?.type === "REFUND"
        ? `Hi, thanks for letting us know about ${item}, and sorry it wasn't what you expected. We'd like to make it right with a partial refund of ${money(input.offer.amount)} — you can keep the item. You'll see the offer in PayPal; just accept it there.\n— The team`
        : `Hi, sorry ${item} didn't work out. We've sent an offer through PayPal so we can put this right — you'll find the details there.\n— The team`;
    case "ACCEPT":
      return `Hi, we're sorry about the trouble with ${item}. We've accepted the claim and refunded you in full through PayPal.\n— The team`;
    default:
      return `Hi, thanks for reaching out about ${item}. Our records show it was fulfilled, and we've shared the details with PayPal. If something's still wrong, reply here and we'll take a look.\n— The team`;
  }
}

const CONTACT = /(https?:\/\/|www\.|[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s().-]{8,}\d)/i;
const MONEY = /(?:\$|USD\s?|€|£)\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{2})?\s?(?:USD|EUR|GBP|dollars)/gi;

/** The draft may only mention the offer amount, and never contact details. */
export function checkBuyerMessage(text: string, input: BuyerMessageInput): string | null {
  if (CONTACT.test(text)) return "contains a link or contact detail";
  const allowed =
    input.offer && input.offer.type !== "REPLACEMENT_WITHOUT_REFUND" ? input.offer.amount.cents : null;
  for (const m of text.match(MONEY) ?? []) {
    const cents = Math.round(Number(m.replace(/[^\d.]/g, "")) * 100);
    if (cents !== allowed) return `mentions an amount (${m.trim()}) other than the offer`;
  }
  return null;
}

export async function draftBuyerMessage(
  llm: LlmClient | null,
  input: BuyerMessageInput,
): Promise<{ draft: BuyerMessageDraft; usage: AgentUsage[]; error: string | null }> {
  const fallback = { message: templateBuyerMessage(input), source: "template" as const };
  if (!llm) return { draft: fallback, usage: [], error: null };
  const offer = input.offer
    ? input.offer.type === "REFUND"
      ? `a partial refund of ${money(input.offer.amount)}; the buyer keeps the item`
      : input.offer.type === "REFUND_WITH_RETURN"
        ? `a full refund of ${money(input.offer.amount)} once the item is returned`
        : "a free replacement"
    : "none";
  try {
    const { output, usage } = await runStructured(llm, {
      agent: "buyer-message",
      role: "reasoning",
      system: SYSTEM,
      prompt: `Case:\n${caseBrief(input.c)}\n\nSeller's decision: ${input.option}. Offer: ${offer}.\n\nDraft the message JSON.`,
      schema: Output,
      effort: "low",
    });
    const problem = checkBuyerMessage(output.message, input);
    return problem
      ? { draft: fallback, usage, error: `draft rejected: ${problem}` }
      : { draft: { message: output.message, source: "claude" }, usage, error: null };
  } catch (err) {
    return { draft: fallback, usage: [], error: err instanceof Error ? err.message : String(err) };
  }
}
