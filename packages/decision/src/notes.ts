import { toPayPalMoney, type Money, type OfferType } from "@rebuttal/core";

/** PayPal notes are capped at 2000 characters. */
export const NOTE_MAX = 2000;

export function money(m: Money): string {
  const p = toPayPalMoney(m);
  return p.currency_code === "USD" ? `$${p.value}` : `${p.value} ${p.currency_code}`;
}

export function clampNote(note: string): string {
  const t = note.trim();
  return t.length <= NOTE_MAX ? t : `${t.slice(0, NOTE_MAX - 1).trimEnd()}…`;
}

/** Shown to the buyer with a make-offer. Amounts come from the optimizer, never from an LLM. */
export function offerNote(type: OfferType, offer: Money): string {
  switch (type) {
    case "REFUND":
      return `We're sorry this order didn't meet your expectations. We'd like to offer a partial refund of ${money(offer)}, and you're welcome to keep the item.`;
    case "REFUND_WITH_RETURN":
      return `We're sorry this order didn't work out. Please return the item and we'll refund ${money(offer)} in full as soon as it arrives.`;
    default:
      return "We're sorry about the trouble with this order. We'd like to send you a replacement at no cost.";
  }
}

export const ACCEPT_NOTE =
  "We have accepted this claim and refunded the payment in full. We're sorry for the inconvenience.";

/** A factual seller statement from exhibit summaries; the fallback when no narrative exists. */
export function fightNote(exhibits: readonly { exhibitId: string; summary: string }[]): string {
  if (!exhibits.length) return "We dispute this claim. Our records for this order are attached.";
  const lines = exhibits.slice(0, 8).map((e) => `- ${e.summary} (${e.exhibitId})`);
  return clampNote(`We dispute this claim. Our records show:\n${lines.join("\n")}`);
}
