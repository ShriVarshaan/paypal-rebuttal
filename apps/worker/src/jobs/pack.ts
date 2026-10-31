import { join } from "node:path";
import { buildEvidencePack, loadPackInput, PackTooLargeError } from "@rebuttal/evidence";
import { json } from "../case-row.js";
import { PermanentJobError, type Deps } from "../deps.js";
import { QUEUES } from "../queues.js";

export type PackJobResult =
  | { status: "ready"; packId: string; totalBytes: number; files: number }
  | { status: "failed"; packId: string; error: string }
  | { status: "skipped"; reason: string };

/** Decisions whose pack can still matter: not yet filed, rejected or failed. */
const OPEN = new Set(["PROPOSED", "APPROVED", "AUTO_APPROVED"]);

/**
 * pack.build (C): render the PDF evidence pack for a FIGHT decision, store it as a READY
 * EvidencePack and send pack.ready so an approved decision files. Earlier packs for the same
 * decision become SUPERSEDED first, so the executor never files a stale pack while the new
 * one renders. A failed build is recorded, not retried: the executor still files without the
 * pack at T-2h, and the seller sees why on the case page.
 */
export async function buildPack(deps: Deps, decisionId: string): Promise<PackJobResult> {
  if (!deps.pdfEngine) return { status: "skipped", reason: "pack rendering is not configured" };
  const decision = await deps.db.decision.findUnique({ where: { id: decisionId }, include: { case: true } });
  if (!decision) throw new PermanentJobError(`Decision ${decisionId} not found`);
  if (decision.option !== "FIGHT") return { status: "skipped", reason: `decision is ${decision.option}` };
  if (!OPEN.has(decision.status)) return { status: "skipped", reason: `decision is ${decision.status}` };

  const pack = await deps.db.$transaction(async (tx) => {
    await tx.evidencePack.updateMany({
      where: { decisionId, status: { in: ["PENDING", "READY"] } },
      data: { status: "SUPERSEDED" },
    });
    return tx.evidencePack.create({
      data: { caseId: decision.caseId, decisionId, status: "PENDING", files: [] },
    });
  });

  const engine = await deps.pdfEngine().catch((err: unknown) => err as Error);
  if (engine instanceof Error)
    return fail(deps, pack.id, decision.caseId, decision.case.paypalDisputeId, engine);
  try {
    const input = await loadPackInput(
      deps.db,
      { decisionId },
      { storageDir: deps.evidenceStorageDir, now: deps.now },
    );
    const result = await buildEvidencePack(input, {
      engine,
      outDir: join(deps.evidenceStorageDir, decision.caseId, "packs", pack.id),
      readFile: deps.readFile,
    });
    await deps.db.$transaction([
      deps.db.evidencePack.update({
        where: { id: pack.id },
        data: {
          status: "READY",
          files: json(result.files),
          previewPath: result.preview.path,
          totalBytes: result.totalBytes,
          exhibits: json(result.exhibits),
          notes: result.warnings.length ? result.warnings.join("\n") : null,
        },
      }),
      deps.db.caseEvent.create({
        data: {
          caseId: decision.caseId,
          type: "PACK_READY",
          payload: json({
            packId: pack.id,
            decisionId,
            files: result.files.length,
            pages: result.preview.pages,
            totalBytes: result.totalBytes,
            profile: result.profile,
            warnings: result.warnings,
          }),
        },
      }),
    ]);
    await deps.queue.send(QUEUES.packReady, { packId: pack.id });
    deps.log.info(
      { caseId: decision.caseId, packId: pack.id, bytes: result.totalBytes },
      "evidence pack ready",
    );
    return { status: "ready", packId: pack.id, totalBytes: result.totalBytes, files: result.files.length };
  } catch (err) {
    return fail(deps, pack.id, decision.caseId, decision.case.paypalDisputeId, err);
  } finally {
    await engine.close();
  }
}

async function fail(
  deps: Deps,
  packId: string,
  caseId: string,
  disputeId: string,
  err: unknown,
): Promise<PackJobResult> {
  const error = err instanceof Error ? err.message : String(err);
  await deps.db.$transaction([
    deps.db.evidencePack.update({ where: { id: packId }, data: { status: "FAILED", error } }),
    deps.db.caseEvent.create({
      data: {
        caseId,
        type: "PACK_FAILED",
        payload: json({ packId, error, tooLarge: err instanceof PackTooLargeError }),
      },
    }),
    deps.db.notification.create({
      data: {
        caseId,
        kind: "PACK_FAILED",
        level: "warning",
        message: `${disputeId}: the evidence PDF could not be built (${error}). Rebuild it from the case page.`,
      },
    }),
  ]);
  deps.log.warn({ caseId, packId, error }, "evidence pack failed");
  return { status: "failed", packId, error };
}
