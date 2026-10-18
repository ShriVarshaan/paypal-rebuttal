import type { CaseSnapshot, DisputeMessage, DisputedTransaction, TransactionContext } from "@rebuttal/core";
import type { ConnectorCase } from "@rebuttal/connectors";
import type { Case as CaseRow, Prisma } from "@rebuttal/db";
import type { Dispute } from "@rebuttal/paypal";

export const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Prisma row → the core Case shape connectors and the policy engine expect. */
export function toConnectorCase(row: CaseRow): ConnectorCase {
  return {
    id: row.id,
    paypalDisputeId: row.paypalDisputeId,
    reason: row.reason,
    status: row.status,
    disputeState: row.disputeState,
    stage: row.stage,
    channel: row.channel,
    amount: { cents: row.amountCents, currency: row.currency },
    sellerResponseDueAt: row.sellerResponseDueAt?.toISOString() ?? null,
    buyerResponseDueAt: row.buyerResponseDueAt?.toISOString() ?? null,
    outcomeCode: row.outcomeCode,
    disputedTransactions: row.disputedTransactions as unknown as DisputedTransaction[],
    messages: row.messages as unknown as DisputeMessage[],
    paypalCreatedAt: row.paypalCreatedAt.toISOString(),
    paypalUpdatedAt: row.paypalUpdatedAt.toISOString(),
    state: row.state,
    withdrawn: row.withdrawn,
    transactionContext: (row.transactionContext as TransactionContext | null) ?? null,
  };
}

/** Columns written from a PayPal snapshot on create and on every changed sync. */
export function snapshotColumns(s: CaseSnapshot, raw: Dispute) {
  return {
    reason: s.reason,
    status: s.status,
    disputeState: s.disputeState,
    stage: s.stage,
    channel: s.channel,
    amountCents: s.amount.cents,
    currency: s.amount.currency,
    sellerResponseDueAt: s.sellerResponseDueAt ? new Date(s.sellerResponseDueAt) : null,
    buyerResponseDueAt: s.buyerResponseDueAt ? new Date(s.buyerResponseDueAt) : null,
    outcomeCode: s.outcomeCode,
    sellerTransactionId: s.disputedTransactions[0]?.sellerTransactionId ?? null,
    disputedTransactions: json(s.disputedTransactions),
    messages: json(s.messages),
    allowedResponseOptions: raw.allowed_response_options ? json(raw.allowed_response_options) : undefined,
    raw: json(raw),
    paypalCreatedAt: new Date(s.paypalCreatedAt),
    paypalUpdatedAt: new Date(s.paypalUpdatedAt),
  };
}
