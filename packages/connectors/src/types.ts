import type { Case, EvidenceItem, TransactionContext } from "@rebuttal/core";

/** A Case plus the order/capture context `case.enrich` attached. */
export interface ConnectorCase extends Case {
  transactionContext: TransactionContext | null;
}

/**
 * One source of seller-side evidence. B and C add storefront, messages and
 * download-log sources against this interface; register them in `sources.ts`.
 */
export interface EvidenceSource {
  /** Stable id, stored as EvidenceItem.source: "easypost" | "storefront" | ... */
  id: string;
  supports(c: ConnectorCase): boolean;
  gather(c: ConnectorCase): Promise<EvidenceItem[]>;
}
