import { z } from "zod";
import { TransactionContext } from "./transaction.js";
import { CaseState, DisputeMessage, DisputedTransaction } from "./case.js";
import { DecisionOption, DecisionStatus } from "./decision.js";
import { EvidenceKind } from "./evidence-kinds.js";
import { EvidenceType } from "./paypal-enums.js";
import { CaseEventRecord, DecisionRecord, IsoDateTime } from "./records.js";

export const MerchantSummary = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  defaultCurrency: z.string().length(3),
});
export type MerchantSummary = z.infer<typeof MerchantSummary>;

export const DecisionSummary = z.object({
  id: z.string(),
  option: DecisionOption,
  status: DecisionStatus,
  pWin: z.number().min(0).max(1).nullable(),
  offerAmountCents: z.number().int().nullable(),
  createdAt: IsoDateTime,
});
export type DecisionSummary = z.infer<typeof DecisionSummary>;

export const EvidenceCompletenessSummary = z.object({
  score: z.number().min(0).max(1),
  requiredMet: z.boolean(),
  missingRequired: z.array(z.string()),
  missingOptional: z.array(z.string()),
});
export type EvidenceCompletenessSummary = z.infer<typeof EvidenceCompletenessSummary>;

export const ChecklistStatus = z.enum(["found", "weak", "missing"]);
export type ChecklistStatus = z.infer<typeof ChecklistStatus>;

/** JSON-safe presentation of one executable evidence-matrix requirement. */
export const EvidenceChecklistItem = z.object({
  id: z.string(),
  label: z.string(),
  hint: z.string(),
  level: z.enum(["required", "strong", "nice"]),
  paypalEvidenceType: EvidenceType,
  kind: EvidenceKind,
  status: ChecklistStatus,
  evidenceIds: z.array(z.string()),
  exhibitIds: z.array(z.string()),
});
export type EvidenceChecklistItem = z.infer<typeof EvidenceChecklistItem>;

export const EvidenceChecklist = EvidenceCompletenessSummary.extend({
  items: z.array(EvidenceChecklistItem),
});
export type EvidenceChecklist = z.infer<typeof EvidenceChecklist>;

/** Browser projection of an EvidenceItem. Deliberately excludes its filesystem path. */
export const EvidenceRecord = z.object({
  id: z.string(),
  caseId: z.string(),
  source: z.string(),
  type: EvidenceType,
  title: z.string(),
  dedupeKey: z.string(),
  data: z.record(z.string(), z.unknown()),
  capturedAt: IsoDateTime,
  createdAt: IsoDateTime,
  hasFile: z.boolean(),
});
export type EvidenceRecord = z.infer<typeof EvidenceRecord>;

/** Safe action outcome shown in the browser; request/response bodies stay server-side. */
export const ActionSummary = z.object({
  id: z.string(),
  kind: z.string(),
  status: z.string(),
  completedAt: IsoDateTime.nullable(),
  debugId: z.string().nullable(),
  /** Added by C (Day 11): when it started, its decision and PayPal's error message, if any. */
  decisionId: z.string().nullable().default(null),
  createdAt: IsoDateTime.nullable().default(null),
  attempts: z.number().int().nonnegative().default(0),
  errorMessage: z.string().nullable().default(null),
});
export type ActionSummary = z.infer<typeof ActionSummary>;

export const PackStatus = z.enum(["PENDING", "READY", "FAILED", "SUPERSEDED"]);
export type PackStatus = z.infer<typeof PackStatus>;

/** The newest PDF evidence pack for the current decision (C, Days 9–11). Paths stay server-side. */
export const PackSummary = z.object({
  id: z.string(),
  decisionId: z.string().nullable(),
  status: PackStatus,
  totalBytes: z.number().int().nullable(),
  files: z.array(
    z.object({
      name: z.string(),
      evidenceType: z.string(),
      sizeBytes: z.number().int(),
      pages: z.number().int().nullable(),
      exhibits: z.array(z.string()),
    }),
  ),
  exhibits: z.array(
    z.object({ exhibitId: z.string(), evidenceId: z.string(), title: z.string(), evidenceType: z.string() }),
  ),
  hasPreview: z.boolean(),
  warnings: z.array(z.string()),
  error: z.string().nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type PackSummary = z.infer<typeof PackSummary>;

export const CaseQueueItem = z.object({
  id: z.string(),
  merchantId: z.string(),
  paypalDisputeId: z.string(),
  reason: z.string(),
  status: z.string(),
  disputeState: z.string().nullable(),
  stage: z.string(),
  channel: z.string().nullable(),
  amountCents: z.number().int(),
  currency: z.string().length(3),
  sellerResponseDueAt: IsoDateTime.nullable(),
  buyerResponseDueAt: IsoDateTime.nullable(),
  state: CaseState,
  outcomeCode: z.string().nullable(),
  withdrawn: z.boolean(),
  paypalCreatedAt: IsoDateTime,
  paypalUpdatedAt: IsoDateTime,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  latestDecision: DecisionSummary.nullable(),
  buyerPseudonym: z.string().nullable(),
  completeness: EvidenceCompletenessSummary,
});
export type CaseQueueItem = z.infer<typeof CaseQueueItem>;

export const CaseDetail = CaseQueueItem.extend({
  sellerTransactionId: z.string().nullable(),
  disputedTransactions: z.array(DisputedTransaction),
  messages: z.array(DisputeMessage),
  transactionContext: TransactionContext.nullable(),
  events: z.array(CaseEventRecord),
  evidence: z.array(EvidenceRecord),
  decisions: z.array(DecisionRecord),
  checklist: EvidenceChecklist,
  actions: z.array(ActionSummary),
  pack: PackSummary.nullable().default(null),
});
export type CaseDetail = z.infer<typeof CaseDetail>;
