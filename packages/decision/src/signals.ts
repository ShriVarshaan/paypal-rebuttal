import {
  assessCompleteness,
  dataBool,
  dataNumber,
  dataString,
  evidenceKind,
  ofKind,
  type CompletenessReport,
  type EvidenceLike,
  type MatrixContext,
} from "@rebuttal/core";
import type { DecisionCase } from "./types.js";

/** Facts read off the gathered evidence. Pure; everything the win model sees comes from here. */
export interface Signals {
  digital: boolean;
  completeness: CompletenessReport;
  tracking: "none" | "delivered" | "in_transit" | "failed";
  deliveredToAddress: boolean;
  signature: boolean;
  digitalAccess: boolean;
  listingSnapshot: boolean;
  itemPhotos: boolean;
  sellerReplied: boolean;
  checkoutVerified: boolean;
  deviceOrIpMatch: boolean;
  priorOrders: number;
  priorDisputes: number;
  refundIssued: boolean;
  /** Days between the payment and the dispute being opened, when known. */
  daysToDispute: number | null;
}

const FAILED = new Set(["return_to_sender", "failure", "cancelled", "error"]);
const IN_TRANSIT = new Set([
  "pre_transit",
  "in_transit",
  "out_for_delivery",
  "available_for_pickup",
  "unknown",
]);

/**
 * Digital goods have no shipment to prove, so the matrix asks for access logs instead.
 * Inferred from an access log, all-digital order items, or an order with no shipping.
 */
export function isDigital(c: DecisionCase, evidence: readonly EvidenceLike[]): boolean {
  if (ofKind(evidence, "access_log").length) return true;
  const orders = ofKind(evidence, "order");
  const items = orders.flatMap((o) => (Array.isArray(o.data["items"]) ? (o.data["items"] as unknown[]) : []));
  if (items.length && items.every((i) => (i as { digital?: unknown }).digital === true)) return true;
  const order = c.transactionContext?.order;
  return !!order && !order.shipping && order.trackingNumbers.length === 0;
}

export function matrixContext(c: DecisionCase, evidence: readonly EvidenceLike[]): MatrixContext {
  return { reason: c.reason, amountCents: c.amount.cents, digital: isDigital(c, evidence) };
}

function days(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null;
  const d = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  return Number.isFinite(d) ? Math.max(0, d) : null;
}

export function extractSignals(c: DecisionCase, evidence: readonly EvidenceLike[]): Signals {
  const ctx = matrixContext(c, evidence);
  const completeness = assessCompleteness(ctx, evidence);
  const met = (id: string) => completeness.requirements.some((r) => r.id === id && r.met);
  // Evaluate requirement predicates even when they don't apply to this reason.
  const anyMet = (id: string, reason: string) =>
    assessCompleteness({ ...ctx, reason }, evidence).requirements.some((r) => r.id === id && r.met);

  const trackers = ofKind(evidence, "carrier_tracking");
  const statuses = trackers.map((t) => dataString(t, "status") ?? "unknown");
  const tracking: Signals["tracking"] = statuses.includes("delivered")
    ? "delivered"
    : statuses.some((s) => FAILED.has(s))
      ? "failed"
      : statuses.some((s) => IN_TRANSIT.has(s))
        ? "in_transit"
        : "none";

  const risk = ofKind(evidence, "checkout_risk");
  const history = ofKind(evidence, "buyer_history");
  const sumOf = (items: EvidenceLike[], key: string) =>
    items.reduce((s, e) => Math.max(s, dataNumber(e, key) ?? 0), 0);

  return {
    digital: ctx.digital,
    completeness,
    tracking,
    deliveredToAddress: anyMet("delivered_to_address", "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"),
    signature: trackers.some((t) => dataString(t, "status") === "delivered" && !!dataString(t, "signedBy")),
    digitalAccess: anyMet("digital_access", "MERCHANDISE_OR_SERVICE_NOT_RECEIVED") || met("digital_access"),
    listingSnapshot: anyMet("listing_snapshot_at_order", "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED"),
    itemPhotos: ofKind(evidence, "item_photos").length > 0,
    sellerReplied: ofKind(evidence, "message_thread").some((m) => dataBool(m, "sellerReplied") === true),
    checkoutVerified: risk.some((r) => dataBool(r, "avsMatch") === true || dataBool(r, "cvvMatch") === true),
    deviceOrIpMatch: risk.some((r) => dataBool(r, "ipMatch") === true || dataBool(r, "deviceMatch") === true),
    priorOrders: sumOf(history, "priorOrders"),
    priorDisputes: sumOf(history, "priorDisputes"),
    refundIssued: evidence.some((e) => evidenceKind(e) === "refund"),
    daysToDispute: days(c.disputedTransactions?.[0]?.createdAt, c.paypalCreatedAt),
  };
}
