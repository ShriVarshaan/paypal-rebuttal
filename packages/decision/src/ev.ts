import type { Economics, OfferPolicy, OfferType } from "@rebuttal/core";

/**
 * Expected value of each response, in minor units, measured against "refund the full
 * amount" = 0 (plan §3). Positive means the seller ends up better off than refunding.
 */

export const labor = (e: Economics, minutes: number): number => (e.laborCostPerHourCents * minutes) / 60;

/** Cost of one more lost dispute on the merchant's dispute ratio. */
export function riskPenalty(e: Economics): number {
  if (e.disputeRatioThreshold <= 0) return 0;
  return e.ratioPenaltyCents * Math.min(1, e.disputeRatio / e.disputeRatioThreshold);
}

/** EV(fight) = p·amount − (1−p)·(fee + risk) − labor */
export function evFight(amountCents: number, pWin: number, e: Economics): number {
  return pWin * amountCents - (1 - pWin) * (e.lossFeeCents + riskPenalty(e)) - labor(e, e.fightMinutes);
}

/**
 * EV(accept): a full refund (the baseline) minus the time it takes. The executor files
 * accept-claim as a plain refund, so no return value is credited here.
 */
export function evAccept(e: Economics): number {
  return -labor(e, e.acceptMinutes);
}

/** Assumed buyer acceptance curve for an offer of `ratio` × amount (see OfferPolicy). */
export function pAccept(ratio: number, type: OfferType, o: OfferPolicy): number {
  const r = type === "REFUND" ? ratio : type === "REFUND_WITH_REPLACEMENT" ? 0.5 : 1;
  const base = 1 / (1 + Math.exp(-o.acceptSteepness * (r - o.acceptMidpoint)));
  const penalty = type === "REFUND" ? 0 : o.returnAcceptPenalty;
  return Math.min(1, Math.max(0, base - penalty));
}

/** What the seller keeps if the buyer accepts, before labor. */
export function offerValue(amountCents: number, refundCents: number, type: OfferType, e: Economics): number {
  switch (type) {
    case "REFUND":
      return amountCents - refundCents;
    case "REFUND_WITH_RETURN":
      // Full refund; the item comes back, net of the return label.
      return e.returnRecoveryRatio * amountCents - e.returnShippingCents;
    case "REFUND_WITH_REPLACEMENT":
      // No refund; ship another one.
      return amountCents - e.replacementCostRatio * amountCents;
    case "REPLACEMENT_WITHOUT_REFUND":
      return amountCents - e.replacementCostRatio * amountCents;
  }
}

/** EV(offer x) = P_accept(x)·(kept − labor) + (1 − P_accept(x))·EV(fight) */
export function evOffer(
  amountCents: number,
  refundCents: number,
  type: OfferType,
  pWin: number,
  e: Economics,
  o: OfferPolicy,
): { ev: number; pAccept: number } {
  const p = pAccept(amountCents ? refundCents / amountCents : 0, type, o);
  const accepted = offerValue(amountCents, refundCents, type, e) - labor(e, e.offerMinutes);
  return { ev: p * accepted + (1 - p) * evFight(amountCents, pWin, e), pAccept: p };
}
