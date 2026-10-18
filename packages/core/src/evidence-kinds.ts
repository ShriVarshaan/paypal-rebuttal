import { z } from "zod";

/**
 * What an EvidenceItem *is*, independent of the PayPal `evidence_type` it gets filed as.
 * Connectors set `data.kind`; the matrix, the win model and the PDF pack all key off it.
 *
 * `data` conventions per kind (all fields optional unless noted; unknown fields are kept):
 * - carrier_tracking: status (required), trackingCode, carrier, deliveredAt, deliveredTo{zip},
 *   signedBy, shippingPostalCode. EasyPost items predate `kind` and are inferred from `source`.
 * - listing_snapshot: capturedAt, orderedAt, title, description, photos[], price
 * - order: orderId, placedAt, items[{name, sku, digital}], totalCents, agreedAmountCents,
 *   distinctFromOtherCharge (DUPLICATE_TRANSACTION), singlePaymentMethod (PAYMENT_BY_OTHER_MEANS)
 * - return_policy: text, url, returnWindowDays
 * - item_photos: photos[]
 * - message_thread: messages[{from, at, text, channel}], sellerReplied, firstSellerReplyHours
 * - access_log: events[{at, ip, action}], firstAccessAt, accessCount, accessedAfterPurchase,
 *   ipMatchesCheckout
 * - buyer_history: priorOrders, priorDisputes, accountAgeDays
 * - checkout_risk: avsMatch, cvvMatch, ipMatch, deviceMatch
 * - refund: refundId, amountCents, refundedAt
 * - subscription: status, chargedAt, cancelledAt, termsUrl
 */
export const EvidenceKind = z.enum([
  "carrier_tracking",
  "listing_snapshot",
  "order",
  "return_policy",
  "item_photos",
  "message_thread",
  "access_log",
  "buyer_history",
  "checkout_risk",
  "refund",
  "subscription",
]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

/** The fields of an EvidenceItem that matching and modelling need. Works for DB rows too. */
export interface EvidenceLike {
  id?: string;
  source: string;
  type: string;
  title?: string;
  data: Record<string, unknown>;
  capturedAt?: string | Date;
}

export function evidenceKind(e: EvidenceLike): EvidenceKind | null {
  const parsed = EvidenceKind.safeParse(e.data["kind"]);
  if (parsed.success) return parsed.data;
  if (e.source === "easypost" || (e.type === "PROOF_OF_FULFILLMENT" && "trackingCode" in e.data))
    return "carrier_tracking";
  return null;
}

export function dataString(e: EvidenceLike, key: string): string | null {
  const v = e.data[key];
  return typeof v === "string" && v ? v : null;
}

export function dataNumber(e: EvidenceLike, key: string): number | null {
  const v = e.data[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function dataBool(e: EvidenceLike, key: string): boolean | null {
  const v = e.data[key];
  return typeof v === "boolean" ? v : null;
}

export function ofKind(items: readonly EvidenceLike[], kind: EvidenceKind): EvidenceLike[] {
  return items.filter((e) => evidenceKind(e) === kind);
}
