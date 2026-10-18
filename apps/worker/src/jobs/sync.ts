import { TERMINAL_STATES, type DisputeMessage } from "@rebuttal/core";
import { isUniqueViolation, type Case as CaseRow } from "@rebuttal/db";
import { json, snapshotColumns } from "../case-row.js";
import type { Deps } from "../deps.js";
import { diffCase, hasSilentChange, nextState, snapshotFromDispute, stateForOutcome } from "../mapping.js";
import { QUEUES } from "../queues.js";
import { cancelSla, scheduleSla } from "./sla.js";

export interface SyncResult {
  caseId: string;
  created: boolean;
  events: string[];
}

/** Whether a resolution in the buyer's favour came from our own accept or offer. */
async function resolvedByUs(deps: Deps, caseId: string): Promise<boolean> {
  const n = await deps.db.action.count({
    where: { caseId, status: "SUCCEEDED", kind: { in: ["ACCEPT_CLAIM", "MAKE_OFFER", "REFUND"] } },
  });
  return n > 0;
}

/**
 * dispute.sync: show the dispute, upsert the Case by paypal_dispute_id, and emit
 * CaseEvents only for real changes. A no-op sync writes nothing at all.
 */
export async function syncDispute(deps: Deps, disputeId: string, retried = false): Promise<SyncResult> {
  const dispute = await deps.paypal.disputes.show(disputeId);
  const snap = snapshotFromDispute(dispute);
  const existing = await deps.db.case.findUnique({ where: { paypalDisputeId: snap.paypalDisputeId } });

  if (!existing) {
    const outcome =
      snap.status === "RESOLVED" ? stateForOutcome(snap.outcomeCode, { resolvedByUs: false }) : null;
    try {
      const row = await deps.db.$transaction(async (tx) => {
        const created = await tx.case.create({
          data: {
            paypalDisputeId: snap.paypalDisputeId,
            ...snapshotColumns(snap, dispute),
            state: outcome?.state ?? "NEW",
            withdrawn: outcome?.withdrawn ?? false,
          },
        });
        await tx.caseEvent.create({
          data: {
            caseId: created.id,
            type: "CREATED",
            payload: json({
              reason: snap.reason,
              status: snap.status,
              stage: snap.stage,
              amount: snap.amount,
            }),
          },
        });
        return created;
      });
      deps.log.info({ caseId: row.id, disputeId }, "case created");
      await deps.queue.send(QUEUES.caseEnrich, { caseId: row.id }, { singletonKey: row.id });
      await scheduleSla(deps, row);
      return { caseId: row.id, created: true, events: ["CREATED"] };
    } catch (err) {
      // Another worker created it between our read and insert: treat this run as an update.
      if (isUniqueViolation(err) && !retried) return syncDispute(deps, disputeId, true);
      throw err;
    }
  }

  const prev = { ...existing, messages: existing.messages as unknown as DisputeMessage[] };
  const changes = diffCase(prev, snap);
  if (!changes.length && !hasSilentChange(prev, snap))
    return { caseId: existing.id, created: false, events: [] };

  const { state, withdrawn } = nextState(
    existing.state,
    snap,
    snap.outcomeCode ? await resolvedByUs(deps, existing.id) : false,
  );
  const updated: CaseRow = await deps.db.$transaction(async (tx) => {
    const row = await tx.case.update({
      where: { id: existing.id },
      data: { ...snapshotColumns(snap, dispute), state, ...(withdrawn !== undefined ? { withdrawn } : {}) },
    });
    for (const c of changes) {
      const payload = c.type === "OUTCOME" ? { ...c.payload, state, withdrawn: row.withdrawn } : c.payload;
      await tx.caseEvent.create({ data: { caseId: row.id, type: c.type, payload: json(payload) } });
    }
    const notes = changes.flatMap((c) => {
      if (c.type === "BUYER_MESSAGE")
        return [
          {
            kind: "BUYER_MESSAGE",
            level: "info",
            message: `${row.paypalDisputeId}: new message from the buyer`,
          },
        ];
      if (c.type === "OUTCOME")
        return [
          {
            kind: "OUTCOME",
            level: state === "LOST" ? "warning" : "info",
            message: `${row.paypalDisputeId}: resolved, ${state}${row.withdrawn ? " (withdrawn)" : ""}`,
          },
        ];
      return [];
    });
    if (notes.length)
      await tx.notification.createMany({ data: notes.map((n) => ({ ...n, caseId: row.id })) });
    return row;
  });

  if (changes.length)
    deps.log.info({ caseId: updated.id, disputeId, events: changes.map((c) => c.type) }, "case updated");
  if (TERMINAL_STATES.has(updated.state) || updated.status === "RESOLVED") await cancelSla(deps, updated.id);
  else if (changes.some((c) => c.type === "DUE_DATE_CHANGED")) await scheduleSla(deps, updated);
  return { caseId: updated.id, created: false, events: changes.map((c) => c.type) };
}
