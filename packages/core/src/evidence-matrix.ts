import {
  dataBool,
  dataNumber,
  dataString,
  evidenceKind,
  type EvidenceKind,
  type EvidenceLike,
} from "./evidence-kinds.js";
import type { EvidenceType } from "./paypal-enums.js";

/**
 * Reason → evidence matrix (plan §3). For each dispute reason, the evidence that wins it,
 * whether it is required, and how to recognise it among gathered EvidenceItems.
 *
 * The human judgement calls live here: which items are required, the $750 signature
 * threshold (PayPal Seller Protection asks for signature confirmation at that amount), and
 * the weights behind the completeness score. Change them in review, not in passing.
 */

export interface MatrixContext {
  reason: string;
  amountCents: number;
  /** Digital goods: no shipment, so access logs replace carrier tracking. */
  digital: boolean;
}

export type RequirementLevel = "required" | "optional";

export interface EvidenceRequirement {
  id: string;
  label: string;
  /** What to tell the seller to collect when it is missing. */
  hint: string;
  /** How the item is filed with PayPal. */
  paypalEvidenceType: EvidenceType;
  kind: EvidenceKind;
  level: RequirementLevel;
  satisfiedBy(e: EvidenceLike): boolean;
}

/** Above this amount a not-received claim also needs signature confirmation. */
export const SIGNATURE_THRESHOLD_CENTS = 75_000;

const REQUIRED_WEIGHT = 3;
const OPTIONAL_WEIGHT = 1;

const is = (kind: EvidenceKind) => (e: EvidenceLike) => evidenceKind(e) === kind;

function postalMatch(e: EvidenceLike): boolean {
  const to = e.data["deliveredTo"] as Record<string, unknown> | null | undefined;
  const zip = typeof to?.["zip"] === "string" ? to["zip"] : null;
  const onFile = dataString(e, "shippingPostalCode");
  if (!zip || !onFile) return false;
  // US ZIP+4 and spacing differences ("95131-1234" vs "95131", "SW1A 1AA" vs "SW1A1AA").
  const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase().split("-")[0];
  return norm(zip) === norm(onFile);
}

const delivered = (e: EvidenceLike) =>
  evidenceKind(e) === "carrier_tracking" && dataString(e, "status") === "delivered";

function timeOf(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

const REQ = {
  carrierDelivered: (level: RequirementLevel): EvidenceRequirement => ({
    id: "carrier_delivered",
    label: "Carrier tracking shows delivered",
    hint: "Add the carrier tracking number to the order so the tracker can confirm delivery.",
    paypalEvidenceType: "PROOF_OF_FULFILLMENT",
    kind: "carrier_tracking",
    level,
    satisfiedBy: delivered,
  }),
  deliveredToAddress: (level: RequirementLevel): EvidenceRequirement => ({
    id: "delivered_to_address",
    label: "Delivered to the shipping address on file",
    hint: "Tracking must show delivery to the postal code of the PayPal shipping address.",
    paypalEvidenceType: "PROOF_OF_FULFILLMENT",
    kind: "carrier_tracking",
    level,
    satisfiedBy: (e) => delivered(e) && postalMatch(e),
  }),
  signature: (level: RequirementLevel): EvidenceRequirement => ({
    id: "signature_confirmation",
    label: "Signature confirmation",
    hint: "Ship orders of $750 or more with signature confirmation.",
    paypalEvidenceType: "PROOF_OF_DELIVERY_SIGNATURE",
    kind: "carrier_tracking",
    level,
    satisfiedBy: (e) => delivered(e) && !!dataString(e, "signedBy"),
  }),
  digitalAccess: (level: RequirementLevel): EvidenceRequirement => ({
    id: "digital_access",
    label: "Download or access logged after purchase",
    hint: "Export the download/access log for this order from the store.",
    paypalEvidenceType: "PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED",
    kind: "access_log",
    level,
    satisfiedBy: (e) =>
      is("access_log")(e) &&
      dataBool(e, "accessedAfterPurchase") === true &&
      (dataNumber(e, "accessCount") ?? 0) > 0,
  }),
  listingAtOrder: (level: RequirementLevel): EvidenceRequirement => ({
    id: "listing_snapshot_at_order",
    label: "Listing as the buyer saw it at order time",
    hint: "Attach the listing snapshot captured on or before the order date.",
    paypalEvidenceType: "ITEM_DESCRIPTION",
    kind: "listing_snapshot",
    level,
    satisfiedBy: (e) => {
      if (!is("listing_snapshot")(e)) return false;
      const captured = timeOf(e.data["capturedAt"]);
      const ordered = timeOf(e.data["orderedAt"]);
      return captured === null || ordered === null || captured <= ordered;
    },
  }),
  returnPolicy: (level: RequirementLevel): EvidenceRequirement => ({
    id: "return_policy",
    label: "Return policy shown at checkout",
    hint: "Attach the store's return policy as published when the order was placed.",
    paypalEvidenceType: "RETURN_POLICY",
    kind: "return_policy",
    level,
    satisfiedBy: is("return_policy"),
  }),
  photos: (level: RequirementLevel): EvidenceRequirement => ({
    id: "item_photos",
    label: "Photos of the item as shipped",
    hint: "Add packing photos of the item.",
    paypalEvidenceType: "PHOTOS_OF_SHIPPED_ITEM",
    kind: "item_photos",
    level,
    satisfiedBy: is("item_photos"),
  }),
  messages: (level: RequirementLevel): EvidenceRequirement => ({
    id: "message_thread",
    label: "Buyer–seller message thread",
    hint: "Include the conversation with the buyer, showing the seller responded.",
    paypalEvidenceType: "OTHER",
    kind: "message_thread",
    level,
    satisfiedBy: is("message_thread"),
  }),
  orderDetails: (level: RequirementLevel): EvidenceRequirement => ({
    id: "order_details",
    label: "Order record",
    hint: "Attach the order record from the store.",
    paypalEvidenceType: "ORDER_DETAILS",
    kind: "order",
    level,
    satisfiedBy: is("order"),
  }),
  checkoutVerification: (level: RequirementLevel): EvidenceRequirement => ({
    id: "checkout_verification",
    label: "Address (AVS) or CVV check passed at checkout",
    hint: "Export the checkout risk record (AVS/CVV result) for this order.",
    paypalEvidenceType: "ORDER_DETAILS",
    kind: "checkout_risk",
    level,
    satisfiedBy: (e) =>
      is("checkout_risk")(e) && (dataBool(e, "avsMatch") === true || dataBool(e, "cvvMatch") === true),
  }),
  deviceOrIp: (level: RequirementLevel): EvidenceRequirement => ({
    id: "device_ip_match",
    label: "Checkout device or IP matches the buyer's history",
    hint: "Include the checkout IP/device fingerprint compared with earlier orders.",
    paypalEvidenceType: "ORDER_DETAILS",
    kind: "checkout_risk",
    level,
    satisfiedBy: (e) =>
      is("checkout_risk")(e) && (dataBool(e, "ipMatch") === true || dataBool(e, "deviceMatch") === true),
  }),
  repeatCustomer: (level: RequirementLevel): EvidenceRequirement => ({
    id: "repeat_customer",
    label: "Earlier undisputed orders from the same buyer",
    hint: "Show the buyer's earlier orders that were not disputed.",
    paypalEvidenceType: "OTHER",
    kind: "buyer_history",
    level,
    satisfiedBy: (e) => is("buyer_history")(e) && (dataNumber(e, "priorOrders") ?? 0) > 0,
  }),
  refundIssued: (level: RequirementLevel): EvidenceRequirement => ({
    id: "refund_issued",
    label: "Refund already issued",
    hint: "If you already refunded the buyer, attach the refund record; otherwise consider accepting.",
    paypalEvidenceType: "PROOF_OF_REFUND",
    kind: "refund",
    level,
    satisfiedBy: is("refund"),
  }),
  distinctOrders: (level: RequirementLevel): EvidenceRequirement => ({
    id: "distinct_orders",
    label: "Both charges belong to separate orders",
    hint: "Attach both order records showing different items or dates.",
    paypalEvidenceType: "ORDER_DETAILS",
    kind: "order",
    level,
    satisfiedBy: (e) => is("order")(e) && dataBool(e, "distinctFromOtherCharge") === true,
  }),
  agreedAmount: (level: RequirementLevel, amountCents: number): EvidenceRequirement => ({
    id: "agreed_amount",
    label: "Order shows the buyer agreed to the charged amount",
    hint: "Attach the invoice or checkout summary showing the agreed total.",
    paypalEvidenceType: "ORDER_DETAILS",
    kind: "order",
    level,
    satisfiedBy: (e) => is("order")(e) && dataNumber(e, "agreedAmountCents") === amountCents,
  }),
  billingTerms: (level: RequirementLevel): EvidenceRequirement => ({
    id: "billing_terms",
    label: "Subscription terms the buyer agreed to",
    hint: "Attach the billing agreement / subscription record.",
    paypalEvidenceType: "BILLING_AGREEMENT",
    kind: "subscription",
    level,
    satisfiedBy: is("subscription"),
  }),
  notCancelledBeforeCharge: (level: RequirementLevel): EvidenceRequirement => ({
    id: "not_cancelled_before_charge",
    label: "Subscription was still active when charged",
    hint: "Show the cancellation date (if any) was after the disputed charge.",
    paypalEvidenceType: "BILLING_AGREEMENT",
    kind: "subscription",
    level,
    satisfiedBy: (e) => {
      if (!is("subscription")(e)) return false;
      const charged = timeOf(e.data["chargedAt"]);
      const cancelled = timeOf(e.data["cancelledAt"]);
      return cancelled === null || (charged !== null && cancelled > charged);
    },
  }),
  singlePayment: (level: RequirementLevel): EvidenceRequirement => ({
    id: "single_payment",
    label: "Order was paid only once, through PayPal",
    hint: "Show the order's payment record has a single PayPal payment.",
    paypalEvidenceType: "ORDER_DETAILS",
    kind: "order",
    level,
    satisfiedBy: (e) => is("order")(e) && dataBool(e, "singlePaymentMethod") === true,
  }),
};

/** The requirements that apply to one dispute, required first. */
export function requirementsFor(ctx: MatrixContext): EvidenceRequirement[] {
  const R = REQ;
  const out = ((): EvidenceRequirement[] => {
    switch (ctx.reason) {
      case "MERCHANDISE_OR_SERVICE_NOT_RECEIVED":
        return ctx.digital
          ? [R.digitalAccess("required"), R.orderDetails("optional"), R.messages("optional")]
          : [
              R.carrierDelivered("required"),
              R.deliveredToAddress("required"),
              R.signature(ctx.amountCents >= SIGNATURE_THRESHOLD_CENTS ? "required" : "optional"),
              R.orderDetails("optional"),
              R.messages("optional"),
            ];
      case "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED":
        return [
          R.listingAtOrder("required"),
          R.messages("optional"),
          R.returnPolicy("optional"),
          R.photos("optional"),
          ...(ctx.digital ? [R.digitalAccess("optional")] : [R.carrierDelivered("optional")]),
        ];
      case "UNAUTHORISED":
        return [
          R.checkoutVerification("required"),
          ctx.digital ? R.digitalAccess("required") : R.deliveredToAddress("required"),
          R.deviceOrIp("optional"),
          R.repeatCustomer("optional"),
        ];
      case "CREDIT_NOT_PROCESSED":
        return [R.refundIssued("required"), R.returnPolicy("optional"), R.messages("optional")];
      case "DUPLICATE_TRANSACTION":
        return [R.distinctOrders("required"), R.refundIssued("optional")];
      case "INCORRECT_AMOUNT":
        return [R.agreedAmount("required", ctx.amountCents), R.messages("optional")];
      case "CANCELED_RECURRING_BILLING":
        return [R.billingTerms("required"), R.notCancelledBeforeCharge("required"), R.messages("optional")];
      case "PAYMENT_BY_OTHER_MEANS":
        return [R.singlePayment("required"), R.refundIssued("optional")];
      default:
        return [R.orderDetails("optional"), R.messages("optional")];
    }
  })();
  return [...out.filter((r) => r.level === "required"), ...out.filter((r) => r.level === "optional")];
}

export interface RequirementResult {
  id: string;
  label: string;
  hint: string;
  level: RequirementLevel;
  paypalEvidenceType: EvidenceType;
  met: boolean;
  /** Ids (or indexes, when items have no id) of the items that satisfy it. */
  satisfiedBy: string[];
}

export interface CompletenessReport {
  /** Weighted share of applicable requirements met, 0..1. Required items weigh 3, optional 1. */
  score: number;
  requiredMet: boolean;
  requirements: RequirementResult[];
  missingRequired: string[];
  missingOptional: string[];
}

/** Evidence completeness score: what's there and what's missing before anything is filed. */
export function assessCompleteness(ctx: MatrixContext, items: readonly EvidenceLike[]): CompletenessReport {
  const reqs = requirementsFor(ctx);
  const results: RequirementResult[] = reqs.map((r) => {
    const by = items.flatMap((e, i) => (r.satisfiedBy(e) ? [e.id ?? String(i)] : []));
    return {
      id: r.id,
      label: r.label,
      hint: r.hint,
      level: r.level,
      paypalEvidenceType: r.paypalEvidenceType,
      met: by.length > 0,
      satisfiedBy: by,
    };
  });
  const weight = (r: RequirementResult) => (r.level === "required" ? REQUIRED_WEIGHT : OPTIONAL_WEIGHT);
  const total = results.reduce((s, r) => s + weight(r), 0);
  const met = results.reduce((s, r) => s + (r.met ? weight(r) : 0), 0);
  const missing = (level: RequirementLevel) =>
    results.filter((r) => r.level === level && !r.met).map((r) => r.id);
  return {
    score: total ? met / total : 0,
    requiredMet: missing("required").length === 0,
    requirements: results,
    missingRequired: missing("required"),
    missingOptional: missing("optional"),
  };
}
