import {
  fromPayPalMoney,
  type CaseSnapshot,
  type CaseState,
  type CaseEventType,
  type DisputeMessage,
  type TransactionContext,
} from "@rebuttal/core";
import type { Capture, Dispute, Order } from "@rebuttal/paypal";

/** PayPal dispute → the PayPal-derived half of a Case. Pure; tested against fixtures. */
export function snapshotFromDispute(d: Dispute): CaseSnapshot {
  return {
    paypalDisputeId: d.dispute_id,
    reason: d.reason,
    status: d.status,
    disputeState: d.dispute_state ?? null,
    stage: d.dispute_life_cycle_stage,
    channel: d.dispute_channel ?? null,
    amount: fromPayPalMoney(d.dispute_amount),
    sellerResponseDueAt: iso(d.seller_response_due_date),
    buyerResponseDueAt: iso(d.buyer_response_due_date),
    outcomeCode: d.dispute_outcome?.outcome_code ?? null,
    disputedTransactions: (d.disputed_transactions ?? []).map((t) => ({
      sellerTransactionId: t.seller_transaction_id ?? null,
      buyerTransactionId: t.buyer_transaction_id ?? null,
      grossAmount: t.gross_amount ? fromPayPalMoney(t.gross_amount) : null,
      createdAt: iso(t.create_time),
      invoiceNumber: t.invoice_number ?? null,
      buyerName: t.buyer?.name ?? null,
      items: (t.items ?? []).map((i) => ({
        name: i.item_description ?? i.item_id ?? null,
        quantity: i.item_quantity ?? null,
      })),
    })),
    messages: (d.messages ?? []).map((m) => ({
      postedBy: m.posted_by ?? "UNKNOWN",
      postedAt: iso(m.time_posted),
      content: m.content ?? "",
    })),
    paypalCreatedAt: iso(d.create_time)!,
    paypalUpdatedAt: iso(d.update_time)!,
  };
}

function iso(value: string | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export interface CaseChange {
  type: CaseEventType;
  payload: Record<string, unknown>;
}

/** The fields of an existing Case row that sync compares. */
export interface ComparableCase {
  status: string;
  stage: string;
  disputeState: string | null;
  sellerResponseDueAt: Date | null;
  outcomeCode: string | null;
  messages: DisputeMessage[];
}

const messageKey = (m: DisputeMessage) => `${m.postedBy}|${m.postedAt}|${m.content}`;

/** What changed between the stored Case and PayPal's view. Empty means "emit nothing". */
export function diffCase(prev: ComparableCase, next: CaseSnapshot): CaseChange[] {
  const changes: CaseChange[] = [];
  if (prev.status !== next.status) {
    changes.push({ type: "STATUS_CHANGED", payload: { from: prev.status, to: next.status } });
  }
  if (prev.stage !== next.stage) {
    changes.push({ type: "STAGE_CHANGED", payload: { from: prev.stage, to: next.stage } });
  }
  const prevDue = prev.sellerResponseDueAt?.toISOString() ?? null;
  if (prevDue !== next.sellerResponseDueAt) {
    changes.push({ type: "DUE_DATE_CHANGED", payload: { from: prevDue, to: next.sellerResponseDueAt } });
  }
  const known = new Set(prev.messages.map(messageKey));
  for (const m of next.messages) {
    if (!known.has(messageKey(m)) && m.postedBy !== "SELLER") {
      changes.push({ type: "BUYER_MESSAGE", payload: { postedBy: m.postedBy, postedAt: m.postedAt } });
    }
  }
  if (next.outcomeCode && next.outcomeCode !== prev.outcomeCode && next.outcomeCode !== "NONE") {
    changes.push({ type: "OUTCOME", payload: { outcomeCode: next.outcomeCode } });
  }
  return changes;
}

/** True when the update carries data worth storing even though no event fires. */
export function hasSilentChange(
  prev: ComparableCase & { paypalUpdatedAt: Date },
  next: CaseSnapshot,
): boolean {
  return (
    prev.paypalUpdatedAt.toISOString() !== next.paypalUpdatedAt || prev.disputeState !== next.disputeState
  );
}

/**
 * Plan Day 12: seller favour → WON, buyer favour → LOST, accepted/refunded → REFUNDED,
 * cancelled by buyer → WON (withdrawn). The raw code is always stored as well.
 */
export function stateForOutcome(
  outcomeCode: string | null,
  opts: { resolvedByUs: boolean },
): { state: CaseState; withdrawn: boolean } | null {
  switch (outcomeCode) {
    case "RESOLVED_SELLER_FAVOUR":
    case "DENIED": // the buyer's claim was denied
    case "RESOLVED_WITH_PAYOUT": // PayPal paid the buyer itself; the seller keeps the funds
      return { state: "WON", withdrawn: false };
    case "CANCELED_BY_BUYER":
      return { state: "WON", withdrawn: true };
    case "ACCEPTED":
      return { state: "REFUNDED", withdrawn: false };
    case "RESOLVED_BUYER_FAVOUR":
      // We accepted the claim or the buyer took our offer: a refund we chose, not a loss.
      return { state: opts.resolvedByUs ? "REFUNDED" : "LOST", withdrawn: false };
    default:
      return null;
  }
}

/** Case state after a sync, given the current state and PayPal's status. */
export function nextState(
  current: CaseState,
  next: CaseSnapshot,
  resolvedByUs: boolean,
): { state: CaseState; withdrawn?: boolean } {
  const outcome = stateForOutcome(next.outcomeCode, { resolvedByUs });
  if (outcome && next.status === "RESOLVED") return outcome;
  // An appeal reopens a lost case: PayPal clears the outcome and reviews again.
  if (
    (current === "LOST" || current === "APPEAL_DRAFTED") &&
    next.status !== "RESOLVED" &&
    !next.outcomeCode
  ) {
    return { state: "WAITING_PAYPAL" };
  }
  if (current === "FILED" && next.status === "UNDER_REVIEW") return { state: "WAITING_PAYPAL" };
  return { state: current };
}

/** Capture + order → the TransactionContext stored on the Case. Drops payer email on purpose. */
export function buildTransactionContext(
  capture: Capture | null,
  order: Order | null,
  errors: string[],
  now: Date,
): TransactionContext {
  const unit = order?.purchase_units[0];
  const shipping = unit?.shipping;
  const captureId = capture?.id;
  return {
    fetchedAt: now.toISOString(),
    errors,
    capture: capture
      ? {
          id: capture.id,
          status: capture.status,
          amount: capture.amount ? fromPayPalMoney(capture.amount) : null,
          createdAt: capture.create_time ?? null,
        }
      : null,
    order: order
      ? {
          id: order.id,
          status: order.status,
          createdAt: order.create_time ?? null,
          items: (order.purchase_units ?? []).flatMap((u) =>
            (u.items ?? []).map((i) => ({
              name: i.name,
              sku: i.sku ?? null,
              quantity: i.quantity,
              unitAmount: i.unit_amount ? fromPayPalMoney(i.unit_amount) : null,
            })),
          ),
          shipping: shipping
            ? {
                fullName: shipping.name?.full_name ?? null,
                address: shipping.address
                  ? (Object.fromEntries(
                      Object.entries(shipping.address).filter(([, v]) => typeof v === "string"),
                    ) as Record<string, string>)
                  : null,
              }
            : null,
          trackingNumbers: (shipping?.trackers ?? []).map((t) => ({
            // Tracker ids are "{capture_id}-{tracking_number}".
            trackingNumber:
              captureId && t.id.startsWith(`${captureId}-`)
                ? t.id.slice(captureId.length + 1)
                : t.id.split("-").slice(1).join("-") || t.id,
            status: t.status ?? null,
          })),
        }
      : null,
  };
}
