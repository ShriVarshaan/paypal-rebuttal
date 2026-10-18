import type { Money, TransactionContext } from "@rebuttal/core";

/**
 * The slice of a Case the engine reads. A worker Case row, a ConnectorCase and an eval
 * case all fit, so the eval exercises exactly the production code path.
 */
export interface DecisionCase {
  paypalDisputeId: string;
  reason: string;
  stage: string;
  amount: Money;
  sellerResponseDueAt?: string | null;
  /** When the dispute was opened. */
  paypalCreatedAt?: string | null;
  disputedTransactions?: { createdAt: string | null }[];
  transactionContext?: TransactionContext | null;
  /** Raw PayPal `allowed_response_options`. */
  allowedResponseOptions?: unknown;
}
