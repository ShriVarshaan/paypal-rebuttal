import { isAbsolute, resolve } from "node:path";
import { DecisionAnalysis, DisputedTransaction, Narrative, TransactionContext } from "@rebuttal/core";
import type { Db } from "@rebuttal/db";
import { findRepoRoot } from "@rebuttal/paypal";
import type { PackInput } from "./types.js";

export interface LoadPackOptions {
  /** Root for relative EvidenceItem.filePath values. Default storage/evidence. */
  storageDir?: string;
  now?: () => Date;
}

/**
 * Loads a case (and, when given, the decision whose narrative and exhibit numbering the pack
 * follows) into a PackInput. With only a caseId it uses the newest non-rejected decision.
 */
export async function loadPackInput(
  db: Db,
  ref: { decisionId: string } | { caseId: string },
  opts: LoadPackOptions = {},
): Promise<PackInput> {
  const decision =
    "decisionId" in ref
      ? await db.decision.findUniqueOrThrow({ where: { id: ref.decisionId } })
      : await db.decision.findFirst({
          where: { caseId: ref.caseId, status: { not: "REJECTED" } },
          orderBy: { createdAt: "desc" },
        });
  const caseId = "decisionId" in ref ? decision!.caseId : ref.caseId;
  const row = await db.case.findUniqueOrThrow({
    where: { id: caseId },
    include: { evidence: { orderBy: { capturedAt: "asc" } }, merchant: true },
  });
  const storageDir = resolve(
    findRepoRoot(),
    opts.storageDir ?? process.env["EVIDENCE_STORAGE_DIR"] ?? "storage/evidence",
  );
  const transactions = DisputedTransaction.array().safeParse(row.disputedTransactions);
  const tx = transactions.success ? transactions.data : [];
  const context = TransactionContext.safeParse(row.transactionContext);
  const analysis = DecisionAnalysis.safeParse(decision?.analysis);
  const narrative = Narrative.safeParse(decision?.narrative);

  return {
    caseId: row.id,
    decisionId: decision?.id ?? null,
    paypalDisputeId: row.paypalDisputeId,
    reason: row.reason,
    stage: row.stage,
    amountCents: row.amountCents,
    currency: row.currency,
    sellerTransactionId: row.sellerTransactionId ?? tx[0]?.sellerTransactionId ?? null,
    invoiceNumber: tx.find((t) => t.invoiceNumber)?.invoiceNumber ?? null,
    paypalCreatedAt: row.paypalCreatedAt.toISOString(),
    sellerResponseDueAt: row.sellerResponseDueAt?.toISOString() ?? null,
    transactionCreatedAt:
      (context.success ? context.data.capture?.createdAt : null) ??
      tx.find((t) => t.createdAt)?.createdAt ??
      null,
    merchant: { name: row.merchant.name },
    narrative: narrative.success ? narrative.data : null,
    note: decision?.note ?? "",
    exhibitMap: analysis.success
      ? analysis.data.exhibits.map((x) => ({ exhibitId: x.exhibitId, evidenceId: x.evidenceId }))
      : null,
    evidence: row.evidence.map((e) => ({
      id: e.id,
      source: e.source,
      type: e.type,
      title: e.title,
      data: (e.data ?? {}) as Record<string, unknown>,
      capturedAt: e.capturedAt.toISOString(),
      filePath: e.filePath ? (isAbsolute(e.filePath) ? e.filePath : resolve(storageDir, e.filePath)) : null,
    })),
    transactionContext: context.success ? context.data : null,
    generatedAt: (opts.now?.() ?? new Date()).toISOString(),
  };
}
