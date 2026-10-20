import {
  ActionSummary,
  CaseDetail,
  CaseQueueItem,
  DecisionRecord,
  DisputeMessage,
  DisputedTransaction,
  EvidenceRecord,
  TransactionContext,
  assessCompleteness,
  assignExhibits,
  evidenceKind,
} from "@rebuttal/core";
import { matrixContext } from "@rebuttal/decision";
import type { Prisma } from "@rebuttal/db";

export const caseRelations = {
  decisions: { orderBy: { createdAt: "desc" as const } },
  evidence: { orderBy: { capturedAt: "asc" as const } },
  events: { orderBy: { createdAt: "asc" as const } },
  actions: { orderBy: { createdAt: "asc" as const } },
} as const;

export type CaseWithRelations = Prisma.CaseGetPayload<{ include: typeof caseRelations }>;

function parsedTransactions(value: unknown) {
  const result = DisputedTransaction.array().safeParse(value);
  return result.success ? result.data : [];
}

function parsedMessages(value: unknown) {
  const result = DisputeMessage.array().safeParse(value);
  return result.success ? result.data : [];
}

function parsedContext(value: unknown) {
  if (value === null || value === undefined) return null;
  const result = TransactionContext.safeParse(value);
  return result.success ? result.data : null;
}

export function evidenceRecord(row: CaseWithRelations["evidence"][number]) {
  return EvidenceRecord.parse({
    id: row.id,
    caseId: row.caseId,
    source: row.source,
    type: row.type,
    title: row.title,
    dedupeKey: row.dedupeKey,
    data: row.data,
    capturedAt: row.capturedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    hasFile: Boolean(row.filePath),
  });
}

function buyerPseudonym(transactions: ReturnType<typeof parsedTransactions>): string | null {
  const name = transactions.find((transaction) => transaction.buyerName)?.buyerName;
  if (!name) return null;
  if (/^Buyer\s+\S+•••\S+$/u.test(name)) return name;
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) return null;
  const [first = "?", ...rest] = clean.split(" ");
  const last = rest.at(-1) ?? first;
  return `Buyer ${first[0] ?? "?"}•••${last.at(-1) ?? "?"}`;
}

function decisionSummary(row: CaseWithRelations) {
  const decision = row.decisions.find((value) => value.status !== "REJECTED");
  return decision
    ? {
        id: decision.id,
        option: decision.option,
        status: decision.status,
        pWin: decision.pWin,
        offerAmountCents: decision.offerAmountCents,
        createdAt: decision.createdAt.toISOString(),
      }
    : null;
}

export function queueItem(row: CaseWithRelations) {
  const transactions = parsedTransactions(row.disputedTransactions);
  const transactionContext = parsedContext(row.transactionContext);
  const evidence = row.evidence.map(evidenceRecord);
  const report = assessCompleteness(
    matrixContext(
      {
        paypalDisputeId: row.paypalDisputeId,
        reason: row.reason,
        stage: row.stage,
        amount: { cents: row.amountCents, currency: row.currency },
        sellerResponseDueAt: row.sellerResponseDueAt?.toISOString() ?? null,
        paypalCreatedAt: row.paypalCreatedAt.toISOString(),
        disputedTransactions: transactions.map((transaction) => ({ createdAt: transaction.createdAt })),
        transactionContext,
      },
      evidence,
    ),
    evidence,
  );
  return CaseQueueItem.parse({
    id: row.id,
    merchantId: row.merchantId,
    paypalDisputeId: row.paypalDisputeId,
    reason: row.reason,
    status: row.status,
    disputeState: row.disputeState,
    stage: row.stage,
    channel: row.channel,
    amountCents: row.amountCents,
    currency: row.currency,
    sellerResponseDueAt: row.sellerResponseDueAt?.toISOString() ?? null,
    buyerResponseDueAt: row.buyerResponseDueAt?.toISOString() ?? null,
    state: row.state,
    outcomeCode: row.outcomeCode,
    withdrawn: row.withdrawn,
    paypalCreatedAt: row.paypalCreatedAt.toISOString(),
    paypalUpdatedAt: row.paypalUpdatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    latestDecision: decisionSummary(row),
    buyerPseudonym: buyerPseudonym(transactions),
    completeness: {
      score: report.score,
      requiredMet: report.requiredMet,
      missingRequired: report.missingRequired,
      missingOptional: report.missingOptional,
    },
  });
}

export function detail(row: CaseWithRelations) {
  const base = queueItem(row);
  const transactions = parsedTransactions(row.disputedTransactions);
  const messages = parsedMessages(row.messages);
  const transactionContext = parsedContext(row.transactionContext);
  const evidence = row.evidence.map(evidenceRecord);
  const report = assessCompleteness(
    matrixContext(
      {
        paypalDisputeId: row.paypalDisputeId,
        reason: row.reason,
        stage: row.stage,
        amount: { cents: row.amountCents, currency: row.currency },
        sellerResponseDueAt: row.sellerResponseDueAt?.toISOString() ?? null,
        paypalCreatedAt: row.paypalCreatedAt.toISOString(),
        disputedTransactions: transactions.map((transaction) => ({ createdAt: transaction.createdAt })),
        transactionContext,
      },
      evidence,
    ),
    evidence,
  );
  const exhibitByEvidence = new Map(
    assignExhibits(evidence).map((exhibit) => [exhibit.evidenceId, exhibit.exhibitId]),
  );
  return CaseDetail.parse({
    ...base,
    sellerTransactionId: row.sellerTransactionId,
    disputedTransactions: transactions,
    messages,
    transactionContext,
    events: row.events.map((event) => ({
      id: event.id,
      caseId: event.caseId,
      type: event.type,
      payload: event.payload,
      createdAt: event.createdAt.toISOString(),
    })),
    evidence,
    decisions: row.decisions.map((decision) =>
      DecisionRecord.parse({
        ...decision,
        approvedAt: decision.approvedAt?.toISOString() ?? null,
        createdAt: decision.createdAt.toISOString(),
        updatedAt: decision.updatedAt.toISOString(),
      }),
    ),
    checklist: {
      score: report.score,
      requiredMet: report.requiredMet,
      missingRequired: report.missingRequired,
      missingOptional: report.missingOptional,
      items: report.requirements.map((item) => ({
        id: item.id,
        label: item.label,
        hint: item.hint,
        level: item.level,
        paypalEvidenceType: item.paypalEvidenceType,
        kind: evidenceKindForRequirement(item.id, evidence),
        status: item.met
          ? "found"
          : evidence.some((value) => evidenceKind(value) === requirementKind[item.id])
            ? "weak"
            : "missing",
        evidenceIds: item.satisfiedBy,
        exhibitIds: item.satisfiedBy.flatMap((id) => {
          const exhibitId = exhibitByEvidence.get(id);
          return exhibitId ? [exhibitId] : [];
        }),
      })),
    },
    actions: row.actions.map((action) =>
      ActionSummary.parse({
        id: action.id,
        kind: action.kind,
        status: action.status,
        completedAt: action.completedAt?.toISOString() ?? null,
        debugId:
          typeof action.response === "object" && action.response !== null && "debug_id" in action.response
            ? String((action.response as Record<string, unknown>)["debug_id"])
            : null,
      }),
    ),
  });
}

function evidenceKindForRequirement(id: string, evidence: ReturnType<typeof evidenceRecord>[]) {
  const first = evidence.find((item) => item.data["requirementId"] === id);
  return (
    evidenceKind(
      first ?? { source: "matrix", type: "ORDER_DETAILS", data: { kind: requirementKind[id] ?? "order" } },
    ) ?? "order"
  );
}

const requirementKind: Record<string, string> = {
  carrier_delivered: "carrier_tracking",
  delivered_to_address: "carrier_tracking",
  signature_confirmation: "carrier_tracking",
  digital_access: "access_log",
  digital_ip_match: "access_log",
  listing_snapshot_at_order: "listing_snapshot",
  return_policy: "return_policy",
  item_photos: "item_photos",
  message_thread: "message_thread",
  order_details: "order",
  checkout_verification: "checkout_risk",
  device_ip_match: "checkout_risk",
  repeat_customer: "buyer_history",
  refund_issued: "refund",
  refund_or_policy: "refund",
  distinct_orders: "order",
  agreed_amount: "order",
  billing_terms: "subscription",
  not_cancelled_before_charge: "subscription",
  usage_after_charge: "access_log",
  single_payment: "order",
};
