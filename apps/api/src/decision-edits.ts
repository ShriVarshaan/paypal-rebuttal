import { narrativeToNote } from "@rebuttal/agent";
import {
  assignExhibits,
  DecisionAnalysis,
  Narrative,
  type DecisionOption,
  type OfferType,
} from "@rebuttal/core";
import { ACCEPT_NOTE, fightNote, offerNote } from "@rebuttal/decision";
import type { Decision, Prisma } from "@rebuttal/db";
import { QUEUES, toEvidenceLike } from "@rebuttal/worker";
import type { AppDeps } from "./app.js";

export interface DecisionEdit {
  by: string;
  note?: string | undefined;
  option?: DecisionOption | undefined;
  offerType?: OfferType | undefined;
  offerAmountCents?: number | undefined;
  /** Set for an override: why the seller chose differently (stored in the audit trail). */
  overrideReason?: string | undefined;
  /** Override only: write a default note for the new option instead of requiring one. */
  defaultNote?: boolean;
}

export type EditResult = { ok: true; decision: Decision } | { ok: false; status: number; error: string };

const json = (v: unknown) => v as Prisma.InputJsonValue;

/**
 * The one path for changing a PROPOSED decision (B's PATCH, C's override). Offers are capped at
 * the disputed amount; changing the option needs a note for PayPal, or a generated default for
 * overrides. FIGHT decisions get a fresh PDF pack; leaving FIGHT supersedes the old one.
 */
export async function editDecision(deps: AppDeps, id: string, e: DecisionEdit): Promise<EditResult> {
  const d = await deps.db.decision.findUnique({
    where: { id },
    include: { case: { include: { evidence: true } } },
  });
  if (!d) return { ok: false, status: 404, error: "not found" };
  if (d.status !== "PROPOSED") return { ok: false, status: 409, error: `decision is ${d.status}` };

  const option = e.option ?? d.option;
  const offerType =
    option === "OFFER" ? (e.offerType ?? (d.offerType as OfferType | null) ?? "REFUND") : null;
  const offerAmountCents =
    option === "OFFER" && offerType !== "REPLACEMENT_WITHOUT_REFUND"
      ? (e.offerAmountCents ?? d.offerAmountCents)
      : null;
  if (option === "OFFER" && offerType !== "REPLACEMENT_WITHOUT_REFUND") {
    if (offerAmountCents == null) return { ok: false, status: 400, error: "an offer needs offerAmountCents" };
    if (offerAmountCents > d.case.amountCents)
      return { ok: false, status: 400, error: "offer exceeds the disputed amount" };
  }

  let note = e.note;
  const offerChanged =
    option === "OFFER" && (offerAmountCents !== d.offerAmountCents || offerType !== d.offerType);
  if (!note && option !== d.option) {
    if (!e.defaultNote)
      return { ok: false, status: 400, error: "changing the option needs a new note for PayPal" };
    note = defaultNote(d, option, offerType, offerAmountCents);
  } else if (!note && offerChanged) {
    // The old note names the old amount; PayPal must see the one being offered.
    note = defaultNote(d, option, offerType, offerAmountCents);
  }
  const override = option !== d.option;

  const updated = await deps.db.$transaction(async (tx) => {
    const u = await tx.decision.update({
      where: { id },
      data: { option, offerType, offerAmountCents, ...(note ? { note } : {}) },
    });
    await tx.caseEvent.create({
      data: {
        caseId: d.caseId,
        type: "DECISION_EDITED",
        payload: json({
          decisionId: id,
          editedBy: e.by,
          from: { option: d.option, offerType: d.offerType, offerAmountCents: d.offerAmountCents },
          to: { option, offerType, offerAmountCents },
          override,
          noteChanged: !!note,
        }),
      },
    });
    if (e.overrideReason)
      await tx.caseEvent.create({
        data: {
          caseId: d.caseId,
          type: "DECISION_OVERRIDDEN",
          payload: json({ decisionId: id, by: e.by, reason: e.overrideReason, from: d.option, to: option }),
        },
      });
    if (d.option === "FIGHT" && option !== "FIGHT")
      await tx.evidencePack.updateMany({
        where: { decisionId: id, status: { in: ["PENDING", "READY"] } },
        data: { status: "SUPERSEDED" },
      });
    return u;
  });
  if (option === "FIGHT" && (override || note))
    await deps.queue.send(QUEUES.packBuild, { decisionId: id }, { singletonKey: id });
  return { ok: true, decision: updated };
}

function defaultNote(
  d: Decision & { case: { currency: string; evidence: Parameters<typeof toEvidenceLike>[0] } },
  option: DecisionOption,
  offerType: string | null,
  offerAmountCents: number | null,
): string {
  if (option === "ACCEPT") return ACCEPT_NOTE;
  if (option === "OFFER")
    return offerNote((offerType ?? "REFUND") as OfferType, {
      cents: offerAmountCents ?? 0,
      currency: d.case.currency,
    });
  const narrative = Narrative.safeParse(d.narrative);
  if (narrative.success && narrative.data.claims.length) return narrativeToNote(narrative.data);
  return fightNote(assignExhibits(toEvidenceLike(d.case.evidence)));
}

/** Exhibit ids a narrative may cite: the decision's stored numbering, else the current one. */
export function citableExhibits(d: Decision, evidence: Parameters<typeof toEvidenceLike>[0]): Set<string> {
  const analysis = DecisionAnalysis.safeParse(d.analysis);
  const ids = analysis.success
    ? analysis.data.exhibits.map((x) => x.exhibitId)
    : assignExhibits(toEvidenceLike(evidence)).map((x) => x.exhibitId);
  return new Set(ids);
}
