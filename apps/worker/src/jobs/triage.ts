import {
  AgentError,
  Budget,
  injectionSignals,
  MAX_COST_PER_CASE_USD,
  narrativeToNote,
  runTriage,
  untrustedText,
  writeNarrative,
  type AgentCase,
  type AgentEvidence,
} from "@rebuttal/agent";
import {
  assignExhibits,
  canTransition,
  policyFrom,
  TRIAGEABLE_STATES,
  type AgentUsage,
  type CaseState,
  type DisputedTransaction,
  type EvidenceLike,
  type Narrative,
  type TriageResult,
} from "@rebuttal/core";
import {
  ACCEPT_NOTE,
  analyzeCase,
  decideCase,
  fightNote,
  money,
  offerNote,
  toDecisionAnalysis,
  type FullDecision,
} from "@rebuttal/decision";
import type { Case as CaseRow, EvidenceItem as EvidenceRow } from "@rebuttal/db";
import { json, toConnectorCase } from "../case-row.js";
import { PermanentJobError, type Deps } from "../deps.js";
import { QUEUES } from "../queues.js";

export type TriageJobResult =
  | { status: "decided"; decisionId: string; option: string; autoApproved: boolean }
  | { status: "skipped"; reason: string };

export const POLICY_ID = "default";

/** AgentRun rows for the cost dashboard. */
export function agentRuns(usage: AgentUsage[], caseId: string, decisionId: string | null) {
  return usage.map((u) => ({
    caseId,
    decisionId,
    agent: u.agent,
    model: u.model,
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheReadTokens: u.cacheReadTokens,
    cacheWriteTokens: u.cacheWriteTokens,
    costUsd: u.costUsd,
    latencyMs: Math.round(u.latencyMs),
  }));
}

export async function loadPolicy(deps: Pick<Deps, "db">) {
  const row = await deps.db.policy.findUnique({ where: { id: POLICY_ID } });
  return policyFrom(row?.config);
}

export function toEvidenceLike(rows: EvidenceRow[]): EvidenceLike[] {
  return rows.map((e) => ({
    id: e.id,
    source: e.source,
    type: e.type,
    title: e.title,
    data: e.data as Record<string, unknown>,
    capturedAt: e.capturedAt,
  }));
}

export function agentCase(row: CaseRow): AgentCase {
  const c = toConnectorCase(row);
  const items =
    c.transactionContext?.order?.items.map((i) => i.name) ??
    (row.disputedTransactions as unknown as DisputedTransaction[]).flatMap((t) =>
      t.items.flatMap((i) => (i.name ? [i.name] : [])),
    );
  return { ...c, allowedResponseOptions: row.allowedResponseOptions, items };
}

const usd = (cents: number, currency: string) => money({ cents: Math.round(cents), currency });

function rationale(d: FullDecision, currency: string): string {
  const parts = [`p_win ${d.decision.pWin.toFixed(2)} (model ${d.analysis.prediction.pWin.toFixed(2)}`];
  parts[0] += d.llm?.applied
    ? `, Claude ${d.llm.delta >= 0 ? "+" : ""}${d.llm.delta.toFixed(2)}: ${d.llm.reason})`
    : ")";
  parts.push(
    `EV fight ${usd(d.decision.evFight, currency)}, ` +
      (d.decision.offer
        ? `offer ${usd(d.decision.offer.evCents, currency)} (${d.decision.offer.type} ${usd(d.decision.offer.amountCents, currency)}, P_accept ${d.decision.offer.pAccept.toFixed(2)}), `
        : "") +
      `accept ${usd(d.decision.evAccept, currency)}`,
  );
  const missing = d.analysis.signals.completeness.missingRequired;
  if (missing.length) parts.push(`missing required evidence: ${missing.join(", ")}`);
  parts.push(`${d.option}${d.autonomy.reason === "DEADLINE" ? " (deadline-safe choice)" : ""}`);
  return parts.join(". ") + ".";
}

/**
 * case.triage: evidence → p_win (model, optionally nudged by Claude) → EV → policy →
 * a Decision. PROPOSED decisions wait for a human; AUTO_APPROVED ones go to the executor.
 * Re-running replaces a still-PROPOSED decision; an approved or filed one is never touched.
 */
export async function triageCase(deps: Deps, caseId: string): Promise<TriageJobResult> {
  const row = await deps.db.case.findUnique({
    where: { id: caseId },
    include: { evidence: true, decisions: { orderBy: { createdAt: "desc" } } },
  });
  if (!row) throw new PermanentJobError(`Case ${caseId} not found`);
  if (!TRIAGEABLE_STATES.has(row.state) || row.status === "RESOLVED")
    return { status: "skipped", reason: `case is ${row.state}` };
  if (row.decisions.some((d) => d.status === "APPROVED" || d.status === "AUTO_APPROVED"))
    return { status: "skipped", reason: "an approved decision is waiting to be filed" };
  // After a filed offer only an escalation (buyer said no) brings the case back here.
  if (row.state !== "OFFER_PENDING" && row.decisions.some((d) => d.status === "EXECUTED"))
    return { status: "skipped", reason: "already filed" };

  const policy = await loadPolicy(deps);
  const c = agentCase(row);
  const items = toEvidenceLike(row.evidence);
  const exhibits = assignExhibits(items);
  const ev: AgentEvidence = { exhibits, items };
  const now = deps.now();
  const heuristics = injectionSignals(untrustedText(c, ev));
  const usage: AgentUsage[] = [];
  const errors: string[] = [];

  let triage: TriageResult | null = null;
  const budget = new Budget(MAX_COST_PER_CASE_USD);
  if (deps.llm && policy.llm.enabled) {
    try {
      const analysis = analyzeCase(c, items, policy);
      const out = await runTriage(deps.llm, { c, evidence: ev, analysis, policy, budget });
      triage = out.result;
      usage.push(...out.usage);
    } catch (err) {
      // Claude is an enhancement: without it the math still decides.
      if (err instanceof AgentError) usage.push(...err.usage);
      errors.push(`triage: ${err instanceof Error ? err.message : String(err)}`);
      deps.log.warn({ caseId, err: errors.at(-1) }, "triage agent failed; using the model alone");
    }
  }

  const d = decideCase({
    c,
    evidence: items,
    policy,
    now,
    exhibits,
    triage,
    injectionSuspected: heuristics.length > 0,
  });
  const currency = row.currency;

  let narrative: Narrative | null = null;
  let note: string;
  if (d.option === "FIGHT") {
    const out = await writeNarrative(deps.llm, c, ev, { budget });
    usage.push(...out.usage);
    if (out.error) errors.push(`narrative: ${out.error}`);
    narrative = out.narrative;
    note = narrative.claims.length ? narrativeToNote(narrative) : fightNote(exhibits);
  } else if (d.option === "OFFER") {
    note = offerNote(d.offerType ?? "REFUND", { cents: d.offerAmountCents ?? 0, currency });
  } else {
    note = ACCEPT_NOTE;
  }

  const autoApproved = d.autonomy.autoApprove;
  const analysis = toDecisionAnalysis(d, { exhibits, triage, usage });
  const target: CaseState = autoApproved ? "TRIAGED" : "AWAITING_APPROVAL";
  const costUsd = usage.reduce((s, u) => s + u.costUsd, 0);

  const decision = await deps.db.$transaction(async (tx) => {
    const superseded = await tx.decision.updateMany({
      where: { caseId, status: "PROPOSED" },
      data: { status: "REJECTED", reason: "SUPERSEDED" },
    });
    const created = await tx.decision.create({
      data: {
        caseId,
        option: d.option,
        status: autoApproved ? "AUTO_APPROVED" : "PROPOSED",
        pWin: d.decision.pWin,
        evFight: d.decision.evFight,
        evOffer: d.decision.offer?.evCents ?? null,
        evAccept: d.decision.evAccept,
        offerAmountCents: d.offerAmountCents,
        offerType: d.offerType,
        note,
        rationale: rationale(d, currency),
        reason: d.autonomy.reason ?? null,
        modelVersion: analysis.engineVersion + (triage ? "+claude-opus-5-5" : ""),
        analysis: json(analysis),
        narrative: narrative ? json(narrative) : undefined,
        ...(autoApproved ? { approvedBy: "policy-engine", approvedAt: now } : {}),
      },
    });
    if (row.state !== target && canTransition(row.state, target))
      await tx.case.update({ where: { id: caseId }, data: { state: target } });
    if (superseded.count)
      await tx.caseEvent.create({
        data: {
          caseId,
          type: "DECISION_SUPERSEDED",
          payload: json({ count: superseded.count, by: created.id }),
        },
      });
    await tx.caseEvent.create({
      data: {
        caseId,
        type: "TRIAGED",
        payload: json({
          decisionId: created.id,
          option: d.option,
          pWin: d.decision.pWin,
          pWinModel: d.analysis.prediction.pWin,
          completeness: d.analysis.signals.completeness.score,
          llm: triage ? { applied: d.llm?.applied ?? false, delta: d.llm?.delta ?? 0 } : null,
          injection: heuristics,
          costUsd,
          errors,
        }),
      },
    });
    await tx.caseEvent.create({
      data: {
        caseId,
        type: "DECISION_PROPOSED",
        payload: json({ decisionId: created.id, autoApproved, reasons: d.autonomy.reasons }),
      },
    });
    if (!autoApproved)
      await tx.notification.create({
        data: {
          caseId,
          kind: "DECISION_PROPOSED",
          level: heuristics.length ? "warning" : "info",
          message: `${row.paypalDisputeId}: recommend ${d.option} (p_win ${d.decision.pWin.toFixed(2)}), approval needed${heuristics.length ? "; buyer text looks like a prompt-injection attempt" : ""}`,
        },
      });
    if (usage.length) await tx.agentRun.createMany({ data: agentRuns(usage, caseId, created.id) });
    return created;
  });

  if (autoApproved)
    await deps.queue.send(QUEUES.actionExecute, { decisionId: decision.id }, { singletonKey: decision.id });
  deps.log.info({ caseId, decisionId: decision.id, option: d.option, autoApproved, costUsd }, "case triaged");
  return { status: "decided", decisionId: decision.id, option: d.option, autoApproved };
}
