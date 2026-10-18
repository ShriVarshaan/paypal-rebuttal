import {
  dataBool,
  dataNumber,
  dataString,
  evidenceKind,
  type EvidenceKind,
  type EvidenceLike,
} from "./evidence-kinds.js";

/**
 * Exhibit ids ("EX-1", "EX-2", …) are how narratives cite evidence and how the PDF pack
 * labels its pages. The numbering is deterministic for a given set of items, so the agent,
 * the cover letter and the UI all agree on what "EX-2" is.
 */
export interface Exhibit {
  exhibitId: string;
  /** EvidenceItem.id when the item has one. */
  evidenceId: string | null;
  kind: EvidenceKind | null;
  type: string;
  source: string;
  title: string;
  /** One factual line, safe to show the model and the seller. */
  summary: string;
}

const KIND_ORDER: (EvidenceKind | null)[] = [
  "carrier_tracking",
  "access_log",
  "listing_snapshot",
  "order",
  "checkout_risk",
  "buyer_history",
  "refund",
  "subscription",
  "return_policy",
  "item_photos",
  "message_thread",
  null,
];

const EXHIBIT_ID = /^EX-\d+$/;
export const isExhibitId = (s: string): boolean => EXHIBIT_ID.test(s);

function capturedMs(e: EvidenceLike): number {
  const c = e.capturedAt instanceof Date ? e.capturedAt.getTime() : Date.parse(e.capturedAt ?? "");
  return Number.isNaN(c) ? 0 : c;
}

export function assignExhibits(items: readonly EvidenceLike[]): Exhibit[] {
  const sorted = [...items].sort((a, b) => {
    const ka = KIND_ORDER.indexOf(evidenceKind(a));
    const kb = KIND_ORDER.indexOf(evidenceKind(b));
    if (ka !== kb) return ka - kb;
    const ca = capturedMs(a);
    const cb = capturedMs(b);
    if (ca !== cb) return ca - cb;
    return (a.id ?? a.title ?? "").localeCompare(b.id ?? b.title ?? "");
  });
  return sorted.map((e, i) => ({
    exhibitId: `EX-${i + 1}`,
    evidenceId: e.id ?? null,
    kind: evidenceKind(e),
    type: e.type,
    source: e.source,
    title: e.title ?? e.type,
    summary: summarizeEvidence(e),
  }));
}

const date = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v.slice(0, 10) : null);
const yesNo = (v: boolean | null) => (v === null ? "unknown" : v ? "yes" : "no");

/** A short, factual description of an item built only from its structured fields. */
export function summarizeEvidence(e: EvidenceLike): string {
  switch (evidenceKind(e)) {
    case "carrier_tracking": {
      const to = e.data["deliveredTo"] as Record<string, unknown> | null | undefined;
      const parts = [
        `Tracking ${dataString(e, "trackingCode") ?? "?"}${dataString(e, "carrier") ? ` (${dataString(e, "carrier")})` : ""}: ${dataString(e, "status") ?? "unknown"}`,
      ];
      if (date(e.data["deliveredAt"])) parts.push(`delivered ${date(e.data["deliveredAt"])}`);
      if (typeof to?.["zip"] === "string") parts.push(`to postal code ${to["zip"]}`);
      if (dataString(e, "shippingPostalCode"))
        parts.push(`order ships to ${dataString(e, "shippingPostalCode")}`);
      if (dataString(e, "signedBy")) parts.push("signature on file");
      return parts.join(", ");
    }
    case "access_log":
      return `Access log: ${dataNumber(e, "accessCount") ?? 0} access(es), first ${date(e.data["firstAccessAt"]) ?? "never"}, after purchase: ${yesNo(dataBool(e, "accessedAfterPurchase"))}, IP matches checkout: ${yesNo(dataBool(e, "ipMatchesCheckout"))}`;
    case "listing_snapshot":
      return `Listing snapshot "${dataString(e, "title") ?? "untitled"}" captured ${date(e.data["capturedAt"]) ?? "?"} (order placed ${date(e.data["orderedAt"]) ?? "?"})`;
    case "order":
      return `Order ${dataString(e, "orderId") ?? "?"} placed ${date(e.data["placedAt"]) ?? "?"}`;
    case "checkout_risk":
      return `Checkout checks: AVS ${yesNo(dataBool(e, "avsMatch"))}, CVV ${yesNo(dataBool(e, "cvvMatch"))}, IP match ${yesNo(dataBool(e, "ipMatch"))}, device match ${yesNo(dataBool(e, "deviceMatch"))}`;
    case "buyer_history":
      return `Buyer history: ${dataNumber(e, "priorOrders") ?? 0} earlier order(s), ${dataNumber(e, "priorDisputes") ?? 0} earlier dispute(s)`;
    case "refund":
      return `Refund ${dataString(e, "refundId") ?? "?"} issued ${date(e.data["refundedAt"]) ?? "?"}`;
    case "subscription":
      return `Subscription ${dataString(e, "status") ?? "?"}, charged ${date(e.data["chargedAt"]) ?? "?"}, cancelled ${date(e.data["cancelledAt"]) ?? "never"}`;
    case "return_policy":
      return `Return policy${dataNumber(e, "returnWindowDays") !== null ? `: ${dataNumber(e, "returnWindowDays")}-day returns` : ""}`;
    case "item_photos":
      return `Photos of the item as shipped (${Array.isArray(e.data["photos"]) ? e.data["photos"].length : 0})`;
    case "message_thread": {
      const msgs = Array.isArray(e.data["messages"]) ? e.data["messages"].length : 0;
      return `Message thread: ${msgs} message(s), seller replied: ${yesNo(dataBool(e, "sellerReplied"))}`;
    }
    default:
      return e.title ?? e.type;
  }
}
