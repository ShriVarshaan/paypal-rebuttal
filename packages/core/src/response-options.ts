import { OfferType } from "./paypal-enums.js";

/** What PayPal lets the seller do on this dispute right now (`allowed_response_options`). */
export interface AllowedResponses {
  fight: boolean;
  offerTypes: OfferType[];
  accept: boolean;
  /** `accept_claim_types`, e.g. REFUND, REFUND_WITH_RETURN. Empty = PayPal didn't say. */
  acceptTypes: string[];
  /** False when PayPal sent no `allowed_response_options`, so the lists are inferred. */
  fromPayPal: boolean;
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s) => typeof s === "string") : []);

/**
 * Parses the raw `allowed_response_options` JSON. Without it, offers are assumed possible
 * only at the INQUIRY stage (PayPal doesn't take offers once a claim/chargeback is open).
 */
export function allowedResponses(raw: unknown, stage: string): AllowedResponses {
  const opts = asRecord(raw);
  if (!opts || Object.keys(opts).length === 0) {
    return {
      fight: true,
      offerTypes: stage === "INQUIRY" ? ["REFUND", "REFUND_WITH_RETURN"] : [],
      accept: true,
      acceptTypes: [],
      fromPayPal: false,
    };
  }
  const offer = asRecord(opts["make_offer"]);
  const accept = asRecord(opts["accept_claim"]);
  return {
    // provide-evidence isn't listed in allowed_response_options; it's always our default response.
    fight: true,
    offerTypes: offer ? strings(offer["offer_types"]).flatMap((t) => OfferType.safeParse(t).data ?? []) : [],
    accept: !!accept,
    acceptTypes: accept ? strings(accept["accept_claim_types"]) : [],
    fromPayPal: true,
  };
}
