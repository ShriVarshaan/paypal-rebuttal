import {
  ACTION_FOR_OPTION,
  idempotencyKey,
  toPayPalMoney,
  type ActionKind,
  type OfferType,
} from "@rebuttal/core";
import { isUniqueViolation, type Action, type Decision, type Case as CaseRow } from "@rebuttal/db";
import {
  PayPalError,
  isRetryable,
  mimeTypeForFilename,
  type EvidenceEntry,
  type EvidenceFile,
  type LinksResponse,
  type TrackingInfo,
} from "@rebuttal/paypal";
import { basename } from "node:path";
import { json } from "../case-row.js";
import type { Deps } from "../deps.js";

export interface Attempt {
  retryCount: number;
  retryLimit: number;
}

export type ExecuteResult =
  | { status: "succeeded"; actionId: string }
  | { status: "failed"; actionId: string; error: string }
  | { status: "waiting"; reason: string }
  | { status: "skipped"; reason: string };

/** One file of a READY EvidencePack, as C's pack job writes it. */
interface PackFile {
  path: string;
  name?: string;
  evidenceType?: string;
}

const ENDPOINT: Partial<Record<ActionKind, string>> = {
  PROVIDE_EVIDENCE: "POST /v1/customer/disputes/{id}/provide-evidence",
  MAKE_OFFER: "POST /v1/customer/disputes/{id}/make-offer",
  ACCEPT_CLAIM: "POST /v1/customer/disputes/{id}/accept-claim",
};

const PAYPAL_CARRIERS = new Set([
  "USPS",
  "UPS",
  "FEDEX",
  "DHL",
  "ROYAL_MAIL",
  "CANADA_POST",
  "AUSTRALIA_POST",
]);
function trackingInfo(carrier: unknown, trackingNumber: string): TrackingInfo {
  const c = typeof carrier === "string" ? carrier.toUpperCase().replace(/\s+/g, "_") : "";
  return PAYPAL_CARRIERS.has(c)
    ? { carrier_name: c, tracking_number: trackingNumber }
    : {
        carrier_name: "OTHER",
        carrier_name_other: typeof carrier === "string" && carrier ? carrier : "Unknown",
        tracking_number: trackingNumber,
      };
}

/** Within 2h of the deadline we file what we have instead of waiting for the PDF pack. */
function deadlineNear(c: CaseRow, now: Date): boolean {
  return !!c.sellerResponseDueAt && c.sellerResponseDueAt.getTime() - now.getTime() <= 2 * 3600 * 1000;
}

function describeError(err: unknown) {
  if (err instanceof PayPalError) {
    return {
      name: err.name,
      message: err.message,
      status: err.status,
      issue: err.issue ?? null,
      debugId: err.debugId ?? null,
    };
  }
  return {
    name: err instanceof Error ? err.name : "Error",
    message: err instanceof Error ? err.message : String(err),
  };
}

async function buildEvidence(
  deps: Deps,
  decision: Decision,
  c: CaseRow,
): Promise<{ input: { evidences: EvidenceEntry[] }; files: EvidenceFile[] } | "no-pack"> {
  const pack = await deps.db.evidencePack.findFirst({
    where: { decisionId: decision.id, status: "READY" },
    orderBy: { createdAt: "desc" },
  });
  if (!pack && decision.reason !== "DEADLINE" && !deadlineNear(c, deps.now())) return "no-pack";

  const files: EvidenceFile[] = [];
  const byType = new Map<string, EvidenceEntry>();
  const entry = (type: string) => {
    let e = byType.get(type);
    if (!e) byType.set(type, (e = { evidence_type: type, notes: decision.note }));
    return e;
  };

  for (const f of (pack?.files as PackFile[] | undefined) ?? []) {
    const filename = f.name ?? basename(f.path);
    const contentType = mimeTypeForFilename(filename);
    if (!contentType) throw new Error(`Pack file ${filename} is not a PDF, PNG or JPG`);
    files.push({ filename, contentType, data: await deps.readFile(f.path) });
    const e = entry(f.evidenceType ?? "OTHER");
    (e.documents ??= []).push({ name: filename });
  }

  // Tracking numbers go in evidence_info so PayPal can verify delivery itself.
  const tracking = await deps.db.evidenceItem.findMany({
    where: { caseId: c.id, type: "PROOF_OF_FULFILLMENT" },
  });
  const infos = tracking.flatMap((t) => {
    const d = t.data as Record<string, unknown>;
    return typeof d["trackingCode"] === "string" ? [trackingInfo(d["carrier"], d["trackingCode"])] : [];
  });
  if (infos.length) entry("PROOF_OF_FULFILLMENT").evidence_info = { tracking_info: infos };
  if (!byType.size) entry("OTHER");
  return { input: { evidences: [...byType.values()] }, files };
}

/**
 * action.execute: an APPROVED (or AUTO_APPROVED) Decision becomes exactly one PayPal write.
 * The Action row, carrying the idempotency key, is inserted before PayPal is called, and
 * every attempt sends that same key, so a crash or retry can never double-file.
 */
export async function executeDecision(
  deps: Deps,
  decisionId: string,
  attempt: Attempt,
): Promise<ExecuteResult> {
  const decision = await deps.db.decision.findUnique({ where: { id: decisionId }, include: { case: true } });
  if (!decision) return { status: "skipped", reason: "decision not found" };
  if (decision.status === "EXECUTED") return { status: "skipped", reason: "already executed" };
  if (decision.status !== "APPROVED" && decision.status !== "AUTO_APPROVED")
    return { status: "skipped", reason: `decision is ${decision.status}` };
  const c = decision.case;
  const kind = ACTION_FOR_OPTION[decision.option];
  const key = idempotencyKey(c.id, decision.id, kind);

  // A crash after PayPal accepted the call but before we recorded it: just record it.
  const previous = await deps.db.action.findUnique({ where: { idempotencyKey: key } });
  if (previous?.status === "SUCCEEDED") {
    await finalize(deps, decision, c, previous, previous.response as LinksResponse);
    return { status: "succeeded", actionId: previous.id };
  }
  if (previous?.status === "FAILED")
    return { status: "failed", actionId: previous.id, error: "previously failed" };

  // FIGHT waits for C's PDF pack; pack.ready re-enqueues this job.
  let evidence: { input: { evidences: EvidenceEntry[] }; files: EvidenceFile[] } | undefined;
  if (decision.option === "FIGHT") {
    let built: Awaited<ReturnType<typeof buildEvidence>>;
    try {
      built = await buildEvidence(deps, decision, c);
    } catch (err) {
      const action = await ensureAction(deps, decision, kind, key);
      await failPermanently(
        deps,
        decision,
        c,
        action,
        new Error(`Could not assemble evidence: ${describeError(err).message}`),
      );
      return { status: "failed", actionId: action.id, error: "could not assemble evidence" };
    }
    if (built === "no-pack") {
      if (c.state !== "FILING") {
        await deps.db.$transaction([
          deps.db.case.update({ where: { id: c.id }, data: { state: "FILING" } }),
          deps.db.caseEvent.create({
            data: {
              caseId: c.id,
              type: "DECISION_EXECUTING",
              payload: json({ decisionId, kind, waitingFor: "evidence pack" }),
            },
          }),
        ]);
      }
      return { status: "waiting", reason: "evidence pack not ready" };
    }
    evidence = built;
  }

  const action = await ensureAction(deps, decision, kind, key, evidence);

  await deps.db.$transaction([
    deps.db.action.update({
      where: { id: action.id },
      data: { status: "IN_FLIGHT", attempts: { increment: 1 } },
    }),
    deps.db.case.update({ where: { id: c.id }, data: { state: "FILING" } }),
    ...(action.attempts === 0
      ? [
          deps.db.caseEvent.create({
            data: {
              caseId: c.id,
              type: "DECISION_EXECUTING",
              payload: json({ decisionId, kind, actionId: action.id }),
            },
          }),
        ]
      : []),
  ]);

  let response: LinksResponse;
  try {
    response = await callPayPal(deps, decision, c, kind, key, evidence);
  } catch (err) {
    const lastAttempt = attempt.retryCount >= attempt.retryLimit;
    if (isRetryable(err) && !lastAttempt) {
      await deps.db.action.update({
        where: { id: action.id },
        data: { status: "PENDING", error: json(describeError(err)) },
      });
      throw err; // pg-boss retries with backoff; the retry reuses the same idempotency key
    }
    await failPermanently(deps, decision, c, action, err);
    return { status: "failed", actionId: action.id, error: describeError(err).message };
  }

  try {
    await finalize(deps, decision, c, action, response);
  } catch (err) {
    // The partial unique index refused a second successful action of this kind.
    if (isUniqueViolation(err)) {
      await failPermanently(deps, decision, c, action, new Error(`Case already has a successful ${kind}`));
      return { status: "failed", actionId: action.id, error: "duplicate action" };
    }
    throw err;
  }
  return { status: "succeeded", actionId: action.id };
}

async function ensureAction(
  deps: Deps,
  decision: Decision,
  kind: ActionKind,
  key: string,
  evidence?: { input: { evidences: EvidenceEntry[] }; files: EvidenceFile[] },
): Promise<Action> {
  const request =
    decision.option === "FIGHT"
      ? {
          evidences: evidence?.input.evidences ?? [],
          files: evidence?.files.map((f) => ({ name: f.filename, bytes: f.data.byteLength })) ?? [],
        }
      : decision.option === "OFFER"
        ? {
            offerType: decision.offerType ?? "REFUND",
            offerAmountCents: decision.offerAmountCents,
            note: decision.note,
          }
        : { note: decision.note };
  return deps.db.action.upsert({
    where: { idempotencyKey: key },
    create: {
      caseId: decision.caseId,
      decisionId: decision.id,
      kind,
      endpoint: ENDPOINT[kind] ?? kind,
      idempotencyKey: key,
      request: json(request),
    },
    update: {},
  });
}

function callPayPal(
  deps: Deps,
  decision: Decision,
  c: CaseRow,
  kind: ActionKind,
  key: string,
  evidence?: { input: { evidences: EvidenceEntry[] }; files: EvidenceFile[] },
): Promise<LinksResponse> {
  const id = c.paypalDisputeId;
  switch (kind) {
    case "PROVIDE_EVIDENCE":
      return deps.paypal.disputes.provideEvidence(id, evidence!.input, evidence!.files, key);
    case "MAKE_OFFER": {
      const offerType = (decision.offerType ?? "REFUND") as OfferType;
      if (offerType !== "REPLACEMENT_WITHOUT_REFUND" && decision.offerAmountCents == null) {
        throw new Error("OFFER decision has no offer amount");
      }
      return deps.paypal.disputes.makeOffer(
        id,
        {
          offer_type: offerType,
          note: decision.note,
          ...(decision.offerAmountCents != null
            ? { offer_amount: toPayPalMoney({ cents: decision.offerAmountCents, currency: c.currency }) }
            : {}),
        },
        key,
      );
    }
    case "ACCEPT_CLAIM":
      return deps.paypal.disputes.acceptClaim(id, { note: decision.note }, key);
    default:
      throw new Error(`Executor does not handle ${kind}`);
  }
}

async function finalize(
  deps: Deps,
  decision: Decision,
  c: CaseRow,
  action: Action,
  response: LinksResponse,
): Promise<void> {
  const state = decision.option === "OFFER" ? "OFFER_PENDING" : "FILED";
  await deps.db.$transaction([
    deps.db.action.update({
      where: { id: action.id },
      data: {
        status: "SUCCEEDED",
        response: json(response ?? {}),
        error: undefined,
        completedAt: deps.now(),
      },
    }),
    deps.db.decision.update({ where: { id: decision.id }, data: { status: "EXECUTED" } }),
    deps.db.case.update({ where: { id: c.id }, data: { state } }),
    deps.db.caseEvent.create({
      data: {
        caseId: c.id,
        type: "ACTION_SUCCEEDED",
        payload: json({ decisionId: decision.id, actionId: action.id, kind: action.kind }),
      },
    }),
  ]);
  deps.log.info({ caseId: c.id, decisionId: decision.id, kind: action.kind }, "action succeeded");
}

async function failPermanently(
  deps: Deps,
  decision: Decision,
  c: CaseRow,
  action: Action,
  err: unknown,
): Promise<void> {
  const error = describeError(err);
  await deps.db.$transaction([
    deps.db.action.update({
      where: { id: action.id },
      data: { status: "FAILED", error: json(error), completedAt: deps.now() },
    }),
    deps.db.decision.update({ where: { id: decision.id }, data: { status: "FAILED" } }),
    deps.db.case.update({ where: { id: c.id }, data: { state: "AWAITING_APPROVAL" } }),
    deps.db.caseEvent.create({
      data: {
        caseId: c.id,
        type: "ACTION_FAILED",
        payload: json({ decisionId: decision.id, actionId: action.id, kind: action.kind, error }),
      },
    }),
    deps.db.notification.create({
      data: {
        caseId: c.id,
        kind: "ACTION_FAILED",
        level: "critical",
        message: `${c.paypalDisputeId}: ${action.kind} failed: ${error.message}`,
      },
    }),
  ]);
  deps.log.warn(
    { caseId: c.id, decisionId: decision.id, kind: action.kind, error },
    "action failed permanently",
  );
}

/** pack.ready: C's pack job finished; file the decision it belongs to. */
export async function onPackReady(
  deps: Deps,
  packId: string,
  send: (decisionId: string) => Promise<unknown>,
): Promise<void> {
  const pack = await deps.db.evidencePack.findUnique({ where: { id: packId }, include: { decision: true } });
  if (!pack?.decision || pack.status !== "READY") return;
  if (pack.decision.status === "APPROVED" || pack.decision.status === "AUTO_APPROVED")
    await send(pack.decision.id);
}
