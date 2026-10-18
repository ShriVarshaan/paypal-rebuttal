import type { Economics, OfferPolicy, OfferType } from "@rebuttal/core";
import { evOffer } from "./ev.js";

export interface OfferChoice {
  type: OfferType;
  amountCents: number;
  pAccept: number;
  evCents: number;
}

/** Offer types that only make sense for physical goods. */
const PHYSICAL_ONLY = new Set<OfferType>([
  "REFUND_WITH_RETURN",
  "REFUND_WITH_REPLACEMENT",
  "REPLACEMENT_WITHOUT_REFUND",
]);

/** Round a refund to whole currency units ($38.00, not $38.37): it reads as a deliberate offer. */
function roundUnits(cents: number, currency: string): number {
  const unit = ["JPY", "HUF", "TWD"].includes(currency) ? 1 : 100;
  return Math.round(cents / unit) * unit;
}

/**
 * Grid search over the partial-refund ratio (and the fixed-amount offer types) for the
 * offer with the highest EV. Returns null when no offer type is allowed.
 */
export function optimizeOffer(input: {
  amountCents: number;
  currency: string;
  pWin: number;
  allowedTypes: readonly OfferType[];
  digital: boolean;
  economics: Economics;
  offer: OfferPolicy;
  /** Dispute reason, for the acceptance curve's per-reason shift. */
  reason?: string;
}): OfferChoice | null {
  const { amountCents, pWin, economics: e, offer: o } = input;
  const types = input.allowedTypes.filter((t) => !(input.digital && PHYSICAL_ONLY.has(t)));
  if (!types.length || amountCents <= 0) return null;

  let best: OfferChoice | null = null;
  const consider = (type: OfferType, refundCents: number) => {
    const { ev, pAccept } = evOffer(amountCents, refundCents, type, pWin, e, o, input.reason);
    // Ties go to the cheaper offer.
    if (
      !best ||
      ev > best.evCents + 1e-9 ||
      (Math.abs(ev - best.evCents) <= 1e-9 && refundCents < best.amountCents)
    ) {
      best = { type, amountCents: refundCents, pAccept, evCents: ev };
    }
  };

  for (const type of types) {
    if (type === "REFUND") {
      const steps = Math.floor((o.maxRatio - o.minRatio) / o.step + 1e-9);
      const seen = new Set<number>();
      for (let i = 0; i <= steps; i++) {
        const cents = roundUnits((o.minRatio + i * o.step) * amountCents, input.currency);
        if (cents <= 0 || cents >= amountCents || seen.has(cents)) continue;
        seen.add(cents);
        consider(type, cents);
      }
    } else if (type === "REFUND_WITH_RETURN") {
      consider(type, amountCents);
    } else if (type === "REPLACEMENT_WITHOUT_REFUND") {
      consider(type, 0);
    }
    // REFUND_WITH_REPLACEMENT (a partial refund *and* a replacement) isn't modelled; never proposed.
  }
  return best;
}
