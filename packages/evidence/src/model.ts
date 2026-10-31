import { assignExhibits, evidenceKind, isDiagnostic, summarizeEvidence } from "@rebuttal/core";
import type { PackEvidence, PackExhibit, PackInput, TimelineRow } from "./types.js";

const REASONS: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Item not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Item not as described",
  UNAUTHORISED: "Unauthorised transaction",
  DUPLICATE_TRANSACTION: "Duplicate transaction",
  CREDIT_NOT_PROCESSED: "Credit not processed",
  CANCELED_RECURRING_BILLING: "Cancelled recurring billing",
  INCORRECT_AMOUNT: "Incorrect amount",
  PAYMENT_BY_OTHER_MEANS: "Paid by other means",
  PROBLEM_WITH_REMITTANCE: "Problem with remittance",
  OTHER: "Other",
};

export const reasonLabel = (reason: string): string =>
  REASONS[reason] ?? reason.replaceAll("_", " ").toLowerCase();

const HEADINGS: Record<string, string> = {
  carrier_tracking: "Carrier tracking",
  access_log: "Download and access log",
  listing_snapshot: "Listing as shown at purchase",
  listing_diff: "Listing revision history",
  order: "Order record",
  checkout_risk: "Checkout verification",
  buyer_history: "Buyer account history",
  refund: "Refund record",
  subscription: "Subscription record",
  return_policy: "Return policy",
  item_photos: "Photos of the item as shipped",
  message_thread: "Buyer and seller messages",
};

/** The exhibit kind used to pick a template; `listing_diff` is not a core evidence kind. */
export function templateKind(e: PackEvidence): string {
  if (e.data["kind"] === "listing_diff") return "listing_diff";
  return evidenceKind(e) ?? "other";
}

export const exhibitHeading = (e: PackEvidence): string => HEADINGS[templateKind(e)] ?? e.title;

/**
 * Pack order. A decision stores the numbering its narrative cites; reuse it whenever every
 * numbered item still exists, so "EX-2" in the statement is EX-2 in the PDF. Otherwise
 * number afresh with the same deterministic rule. Items added after the decision are
 * appended in that rule's order.
 */
export function orderExhibits(input: PackInput): PackExhibit[] {
  const usable = input.evidence.filter((e) => !isDiagnostic(e));
  const byId = new Map(usable.map((e) => [e.id, e]));
  const stored = input.exhibitMap?.filter((x) => x.evidenceId) ?? [];
  const storedValid = stored.length > 0 && stored.every((x) => byId.has(x.evidenceId!));

  const ordered: { exhibitId: string; evidence: PackEvidence }[] = [];
  if (storedValid) {
    const sorted = [...stored].sort((a, b) => exhibitNumber(a.exhibitId) - exhibitNumber(b.exhibitId));
    for (const x of sorted) ordered.push({ exhibitId: x.exhibitId, evidence: byId.get(x.evidenceId!)! });
    const used = new Set(sorted.map((x) => x.evidenceId));
    let next = Math.max(0, ...sorted.map((x) => exhibitNumber(x.exhibitId)));
    for (const x of assignExhibits(usable.filter((e) => !used.has(e.id))))
      ordered.push({ exhibitId: `EX-${++next}`, evidence: byId.get(x.evidenceId!)! });
  } else {
    for (const x of assignExhibits(usable))
      ordered.push({ exhibitId: x.exhibitId, evidence: byId.get(x.evidenceId!)! });
  }
  return ordered.map(({ exhibitId, evidence }) => ({
    exhibitId,
    evidence,
    heading: exhibitHeading(evidence),
    summary: summaryFor(evidence),
  }));
}

function exhibitNumber(id: string): number {
  return Number(id.replace(/^EX-/, "")) || 0;
}

function summaryFor(e: PackEvidence): string {
  if (templateKind(e) === "listing_diff") {
    const fields = Array.isArray(e.data["changedFields"]) ? (e.data["changedFields"] as string[]) : [];
    return `Listing edited after the order (${fields.join(" and ") || "content"} changed); the purchase-time version is the one shown to the buyer.`;
  }
  return summarizeEvidence(e);
}

const iso = (v: unknown): string | null =>
  typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null;

/** Order → payment → shipment → delivery/access → dispute, each row tied to its exhibit. */
export function buildTimeline(input: PackInput, exhibits: PackExhibit[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const exhibitFor = (e: PackEvidence) => exhibits.find((x) => x.evidence.id === e.id)?.exhibitId ?? null;

  for (const x of exhibits) {
    const e = x.evidence;
    switch (templateKind(e)) {
      case "order": {
        const placed = iso(e.data["placedAt"]);
        if (placed)
          rows.push({
            at: placed,
            label: "Order placed",
            detail: `Order ${String(e.data["orderId"] ?? "")}`.trim(),
            exhibitId: x.exhibitId,
          });
        const shipments = Array.isArray(e.data["shipments"]) ? e.data["shipments"] : [];
        for (const s of shipments as Record<string, unknown>[]) {
          const shipped = iso(s["shippedAt"]);
          if (shipped)
            rows.push({
              at: shipped,
              label: "Shipped",
              detail: [s["carrier"], s["trackingNumber"] ?? s["trackingCode"]].filter(Boolean).join(" "),
              exhibitId: x.exhibitId,
            });
        }
        break;
      }
      case "carrier_tracking": {
        const events = Array.isArray(e.data["events"]) ? (e.data["events"] as Record<string, unknown>[]) : [];
        const first = events.map((v) => iso(v["at"])).find(Boolean);
        if (first && !rows.some((r) => r.label === "Shipped"))
          rows.push({
            at: first,
            label: "In carrier network",
            detail:
              `${String(e.data["carrier"] ?? "Carrier")} ${String(e.data["trackingCode"] ?? "")}`.trim(),
            exhibitId: x.exhibitId,
          });
        const delivered = iso(e.data["deliveredAt"]);
        if (delivered)
          rows.push({
            at: delivered,
            label: "Delivered",
            detail: e.data["signedBy"]
              ? `Signed for by ${String(e.data["signedBy"])}`
              : "Carrier confirmed delivery",
            exhibitId: exhibitFor(e),
          });
        break;
      }
      case "access_log": {
        const first = iso(e.data["firstAccessAt"]);
        if (first)
          rows.push({
            at: first,
            label: "First download / access",
            detail: `${String(e.data["accessCount"] ?? 0)} access(es) after purchase`,
            exhibitId: x.exhibitId,
          });
        break;
      }
      case "refund": {
        const at = iso(e.data["refundedAt"]);
        if (at)
          rows.push({
            at,
            label: "Refund issued",
            detail: String(e.data["refundId"] ?? ""),
            exhibitId: x.exhibitId,
          });
        break;
      }
    }
  }
  const paid = iso(input.transactionCreatedAt);
  if (paid)
    rows.push({
      at: paid,
      label: "Payment captured",
      detail: input.sellerTransactionId ?? "",
      exhibitId: null,
    });
  const opened = iso(input.paypalCreatedAt);
  if (opened)
    rows.push({ at: opened, label: "Dispute opened", detail: reasonLabel(input.reason), exhibitId: null });
  return rows.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Submission files, one per PayPal evidence_type, in first-exhibit order. The cover letter
 * travels at the front of the first file so the reviewer reads it first.
 */
export function groupByEvidenceType(
  exhibits: PackExhibit[],
): { evidenceType: string; exhibits: PackExhibit[] }[] {
  const groups: { evidenceType: string; exhibits: PackExhibit[] }[] = [];
  for (const x of exhibits) {
    const type = x.evidence.type || "OTHER";
    const group = groups.find((g) => g.evidenceType === type);
    if (group) group.exhibits.push(x);
    else groups.push({ evidenceType: type, exhibits: [x] });
  }
  return groups;
}

/** 203.0.113.42 → 203.0.113.•••; IPv6 keeps its first three groups. */
export function maskIp(ip: unknown): string {
  if (typeof ip !== "string" || !ip) return "—";
  if (ip.includes(".")) return ip.split(".").slice(0, 3).join(".") + ".•••";
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":") + ":••••";
  return "•••";
}

export function formatMoney(cents: number, currency: string): string {
  const digits =
    new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ??
    2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 10 ** digits);
}

export function formatDate(value: unknown, withTime = true): string {
  const at = iso(value);
  if (!at) return "—";
  return (
    new Date(at).toLocaleString("en-US", {
      timeZone: "UTC",
      dateStyle: "medium",
      ...(withTime ? { timeStyle: "short" } : {}),
    }) + (withTime ? " UTC" : "")
  );
}

export const evidenceTypeLabel = (type: string): string =>
  type
    .toLowerCase()
    .split("_")
    .map((w, i) => (i === 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");

export function fileSlug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "evidence"
  );
}
