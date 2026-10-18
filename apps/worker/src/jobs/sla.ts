import { randomUUID } from "node:crypto";
import { TERMINAL_STATES, type EvidenceType } from "@rebuttal/core";
import type { Case as CaseRow, SlaKind } from "@rebuttal/db";
import { json, toConnectorCase } from "../case-row.js";
import type { Deps } from "../deps.js";
import { QUEUES } from "../queues.js";

const HOUR = 3600 * 1000;

/** Reminders at T-72h/24h/6h; at T-2h the policy engine's safe default is executed. */
export const SLA_OFFSETS: Record<SlaKind, number> = {
  REMIND_72H: 72 * HOUR,
  REMIND_24H: 24 * HOUR,
  REMIND_6H: 6 * HOUR,
  FORCE_DECISION: 2 * HOUR,
};

const LEVEL: Record<SlaKind, string> = {
  REMIND_72H: "info",
  REMIND_24H: "warning",
  REMIND_6H: "critical",
  FORCE_DECISION: "critical",
};

/**
 * States in which the case has already been answered, so no forced decision is needed.
 * FILING is not one of them: an approved FIGHT can sit in FILING waiting for its PDF pack,
 * and the forced decision below re-enqueues it so the executor files without the pack.
 */
const RESPONDED = new Set(["FILED", "WAITING_PAYPAL", "OFFER_PENDING", "WON", "LOST", "REFUNDED"]);

export async function cancelSla(deps: Deps, caseId: string, keepDueAt?: Date): Promise<void> {
  const scheduled = await deps.db.slaJob.findMany({ where: { caseId, status: "SCHEDULED" } });
  for (const job of scheduled) {
    if (keepDueAt && job.dueAt.getTime() === keepDueAt.getTime()) continue;
    await deps.queue.cancel(QUEUES.slaFire, job.jobId).catch(() => {}); // already ran or gone: fine
    await deps.db.slaJob.update({ where: { id: job.id }, data: { status: "CANCELLED" } });
  }
}

/**
 * (Re)schedules the SLA jobs for a case's `seller_response_due_date`. Jobs for the current
 * due date are kept, jobs for an old one are cancelled. Reminders already in the past are
 * skipped; a forced decision whose time has passed runs now if the deadline hasn't.
 */
export async function scheduleSla(deps: Deps, row: CaseRow): Promise<void> {
  const due = row.sellerResponseDueAt;
  const open = due && !TERMINAL_STATES.has(row.state) && row.status !== "RESOLVED";
  await cancelSla(deps, row.id, open ? due : undefined);
  if (!open) return;

  const now = deps.now().getTime();
  if (due.getTime() <= now) return;
  const existing = new Set(
    (await deps.db.slaJob.findMany({ where: { caseId: row.id, status: "SCHEDULED", dueAt: due } })).map(
      (j) => j.kind,
    ),
  );

  for (const kind of Object.keys(SLA_OFFSETS) as SlaKind[]) {
    if (existing.has(kind)) continue;
    let runAt = due.getTime() - SLA_OFFSETS[kind];
    if (runAt <= now) {
      if (kind !== "FORCE_DECISION") continue;
      runAt = now;
    }
    const slaJobId = randomUUID();
    // Send first: if the insert below fails, the orphan job finds no row and does nothing.
    const jobId = await deps.queue.send(
      QUEUES.slaFire,
      { slaJobId },
      { startAfter: new Date(runAt), singletonKey: slaJobId },
    );
    if (!jobId) continue;
    await deps.db.slaJob.create({
      data: { id: slaJobId, caseId: row.id, kind, jobId, runAt: new Date(runAt), dueAt: due },
    });
  }
}

/** sla.fire: a reminder (CaseEvent + Notification) or the T-2h forced decision. */
export async function fireSla(deps: Deps, slaJobId: string): Promise<{ outcome: string }> {
  const job = await deps.db.slaJob.findUnique({ where: { id: slaJobId }, include: { case: true } });
  if (!job || job.status !== "SCHEDULED") return { outcome: "stale" };
  const c = job.case;
  if (
    c.sellerResponseDueAt?.getTime() !== job.dueAt.getTime() ||
    TERMINAL_STATES.has(c.state) ||
    c.status === "RESOLVED"
  ) {
    await deps.db.slaJob.update({ where: { id: job.id }, data: { status: "CANCELLED" } });
    return { outcome: "stale" };
  }
  await deps.db.slaJob.update({ where: { id: job.id }, data: { status: "FIRED" } });

  const hoursLeft = Math.max(0, Math.round((job.dueAt.getTime() - deps.now().getTime()) / HOUR));
  if (job.kind !== "FORCE_DECISION") {
    await deps.db.$transaction([
      deps.db.caseEvent.create({
        data: {
          caseId: c.id,
          type: "SLA_REMINDER",
          payload: json({ kind: job.kind, dueAt: job.dueAt, hoursLeft }),
        },
      }),
      deps.db.notification.create({
        data: {
          caseId: c.id,
          kind: "SLA_REMINDER",
          level: LEVEL[job.kind],
          message: `${c.paypalDisputeId}: response due in ${hoursLeft}h`,
        },
      }),
    ]);
    return { outcome: "reminded" };
  }

  if (RESPONDED.has(c.state)) return { outcome: "already responded" };
  const approved = await deps.db.decision.findFirst({
    where: { caseId: c.id, status: { in: ["APPROVED", "AUTO_APPROVED"] } },
    orderBy: { createdAt: "desc" },
  });
  if (approved) {
    // Approved but not filed yet (e.g. still waiting for its PDF pack): file it now.
    await deps.queue.send(QUEUES.actionExecute, { decisionId: approved.id }, { singletonKey: approved.id });
    return { outcome: "executing approved decision" };
  }

  const evidence = await deps.db.evidenceItem.findMany({ where: { caseId: c.id } });
  const input = deps.safeDefault({
    case: toConnectorCase(c),
    evidence: evidence.map((e) => ({
      type: e.type as EvidenceType,
      data: e.data as Record<string, unknown>,
    })),
  });
  const decision = await deps.db.$transaction(async (tx) => {
    const d = await tx.decision.create({
      data: {
        caseId: c.id,
        option: input.option,
        status: "AUTO_APPROVED",
        note: input.note,
        reason: "DEADLINE",
        offerAmountCents: input.offerAmount?.cents ?? null,
        offerType: input.offerType ?? null,
        rationale: "Forced by the SLA scheduler: no approved decision 2h before the response deadline.",
        modelVersion: "policy.safeDefault",
        approvedBy: "sla-scheduler",
        approvedAt: deps.now(),
      },
    });
    await tx.caseEvent.create({
      data: {
        caseId: c.id,
        type: "SLA_FORCED_DECISION",
        payload: json({ decisionId: d.id, option: d.option, reason: "DEADLINE", hoursLeft }),
      },
    });
    await tx.notification.create({
      data: {
        caseId: c.id,
        kind: "SLA_FORCED_DECISION",
        level: "critical",
        message: `${c.paypalDisputeId}: deadline in ${hoursLeft}h, auto-filing ${d.option}`,
      },
    });
    return d;
  });
  await deps.queue.send(QUEUES.actionExecute, { decisionId: decision.id }, { singletonKey: decision.id });
  return { outcome: `forced ${decision.option}` };
}
