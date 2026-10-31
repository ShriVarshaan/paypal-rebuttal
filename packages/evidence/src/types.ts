import type { Narrative, TransactionContext } from "@rebuttal/core";

/** One stored EvidenceItem as the pack sees it. `filePath` is resolved by the loader. */
export interface PackEvidence {
  id: string;
  source: string;
  /** PayPal evidence_type the item supports (EvidenceItem.type). */
  type: string;
  title: string;
  data: Record<string, unknown>;
  capturedAt: string;
  filePath: string | null;
}

/** Everything the templates need, loaded once so rendering stays free of database access. */
export interface PackInput {
  caseId: string;
  decisionId: string | null;
  paypalDisputeId: string;
  reason: string;
  stage: string;
  amountCents: number;
  currency: string;
  sellerTransactionId: string | null;
  invoiceNumber: string | null;
  paypalCreatedAt: string;
  sellerResponseDueAt: string | null;
  transactionCreatedAt: string | null;
  merchant: { name: string };
  /** B's cited statement; null when the decision has none (the note is used instead). */
  narrative: Narrative | null;
  /** The note filed with PayPal (≤ 2000 chars). */
  note: string;
  /** Exhibit numbering stored on the decision, so citations in the narrative stay valid. */
  exhibitMap: { exhibitId: string; evidenceId: string | null }[] | null;
  evidence: PackEvidence[];
  transactionContext: TransactionContext | null;
  generatedAt: string;
}

/** One exhibit in pack order. */
export interface PackExhibit {
  exhibitId: string;
  evidence: PackEvidence;
  /** Human heading, e.g. "Carrier tracking". */
  heading: string;
  summary: string;
}

export interface TimelineRow {
  at: string;
  label: string;
  detail: string;
  exhibitId: string | null;
}

/** A file handed to the executor; it uploads each one under its `evidenceType`. */
export interface PackFile {
  path: string;
  name: string;
  evidenceType: string;
  mimeType: "application/pdf";
  sizeBytes: number;
  exhibits: string[];
  pages: number;
}

export interface PackResult {
  files: PackFile[];
  totalBytes: number;
  /** Cover letter and every exhibit in one PDF, for the browser preview and download. */
  preview: { path: string; sizeBytes: number; pages: number };
  exhibits: { exhibitId: string; evidenceId: string; title: string; evidenceType: string }[];
  /** Image quality profile that met the size limits. */
  profile: string;
  warnings: string[];
}
