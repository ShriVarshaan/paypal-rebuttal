import { draftAppeal } from "@rebuttal/agent";
import { assignExhibits } from "@rebuttal/core";
import { analyzeCase } from "@rebuttal/decision";
import { json } from "../case-row.js";
import { PermanentJobError, type Deps } from "../deps.js";
import { agentCase, loadPolicy, toEvidenceLike } from "./triage.js";

/**
 * case.appeal: when a case is LOST, explain why and what new evidence would help, and
 * store the draft on an APPEAL_DRAFTED event. Filing the appeal stays a human decision.
 */
export async function appealCase(deps: Deps, caseId: string): Promise<{ status: string }> {
  const row = await deps.db.case.findUnique({
    where: { id: caseId },
    include: {
      evidence: true,
      decisions: { where: { status: "EXECUTED" }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!row) throw new PermanentJobError(`Case ${caseId} not found`);
  if (row.state !== "LOST") return { status: `skipped: case is ${row.state}` };

  const c = agentCase(row);
  const items = toEvidenceLike(row.evidence);
  const analysis = analyzeCase(c, items, await loadPolicy(deps));
  const filed = row.decisions[0] ? { option: row.decisions[0].option, note: row.decisions[0].note } : null;
  const out = await draftAppeal(deps.llm, {
    c,
    evidence: { exhibits: assignExhibits(items), items },
    completeness: analysis.signals.completeness,
    filed,
  });

  await deps.db.$transaction([
    deps.db.case.update({ where: { id: caseId }, data: { state: "APPEAL_DRAFTED" } }),
    deps.db.caseEvent.create({
      data: {
        caseId,
        type: "APPEAL_DRAFTED",
        payload: json({ draft: out.draft, usage: out.usage, error: out.error }),
      },
    }),
    deps.db.notification.create({
      data: {
        caseId,
        kind: "APPEAL_DRAFTED",
        level: "info",
        message: `${row.paypalDisputeId}: lost; appeal draft ready (${out.draft.recommendAppeal ? "appeal recommended" : "appeal not recommended"})`,
      },
    }),
  ]);
  return { status: "drafted" };
}
