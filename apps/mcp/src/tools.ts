import { DecisionAnalysis, TERMINAL_STATES, toPayPalMoney, type CaseState } from "@rebuttal/core";

/** The slice of the Rebuttal api the MCP tools use (GET /cases, GET /cases/:id, approve). */
export interface RebuttalApi {
  listCases(): Promise<CaseSummary[]>;
  getCase(id: string): Promise<CaseDetail | null>;
  approve(decisionId: string, approvedBy: string): Promise<{ ok: true } | { ok: false; error: string }>;
}

export interface CaseSummary {
  id: string;
  paypalDisputeId: string;
  reason: string;
  stage: string;
  state: CaseState;
  amountCents: number;
  currency: string;
  sellerResponseDueAt: string | null;
}

export interface DecisionRow {
  id: string;
  option: string;
  status: string;
  pWin: number | null;
  offerAmountCents: number | null;
  offerType: string | null;
  note: string;
  rationale: string | null;
  analysis: unknown;
}

export interface CaseDetail extends CaseSummary {
  decisions: DecisionRow[];
}

const money = (cents: number | null | undefined, currency: string) =>
  cents == null ? "—" : `${toPayPalMoney({ cents: Math.round(cents), currency }).value} ${currency}`;

const dueIn = (iso: string | null, now: Date) => {
  if (!iso) return "no deadline";
  const h = Math.round((Date.parse(iso) - now.getTime()) / 3_600_000);
  return h < 0 ? "past due" : h < 48 ? `due in ${h}h` : `due in ${Math.round(h / 24)}d`;
};

/** The decision a human would act on: the newest one that wasn't superseded or rejected. */
const current = (c: CaseDetail) => c.decisions.find((d) => d.status !== "REJECTED") ?? null;

export async function listOpenCases(api: RebuttalApi, now = new Date()): Promise<string> {
  const open = (await api.listCases()).filter((c) => !TERMINAL_STATES.has(c.state));
  if (!open.length) return "No open disputes.";
  return [
    `${open.length} open dispute(s), soonest deadline first:`,
    ...open.map(
      (c) =>
        `- ${c.id} · ${c.paypalDisputeId} · ${c.reason} · ${c.stage} · ${money(c.amountCents, c.currency)} · ${c.state} · ${dueIn(c.sellerResponseDueAt, now)}`,
    ),
  ].join("\n");
}

/**
 * Why the engine chose what it chose, from the stored analysis. Deliberately leaves out the
 * buyer's own words: this text goes into another model's context.
 */
export async function explainDecision(api: RebuttalApi, caseId: string): Promise<string> {
  const c = await api.getCase(caseId);
  if (!c) return `No case ${caseId}.`;
  const d = current(c);
  if (!d) return `${c.paypalDisputeId}: no decision yet (state ${c.state}).`;
  const a = DecisionAnalysis.safeParse(d.analysis);
  const lines = [
    `${c.paypalDisputeId} (${c.reason}, ${c.stage}, ${money(c.amountCents, c.currency)}): ${d.option}, decision ${d.id} is ${d.status}.`,
  ];
  if (d.option === "OFFER")
    lines.push(`Offer: ${d.offerType ?? "REFUND"} of ${money(d.offerAmountCents, c.currency)}.`);
  if (a.success) {
    const x = a.data;
    lines.push(
      `p_win ${x.pWin.toFixed(2)} (model ${x.pWinModel.toFixed(2)}${x.llm?.applied ? `, Claude ${x.llm.delta >= 0 ? "+" : ""}${x.llm.delta.toFixed(2)}: ${x.llm.reason}` : ""}).`,
      `Expected value vs refunding: fight ${money(x.ev.fightCents, c.currency)}, ${x.ev.offer ? `offer ${money(x.ev.offer.evCents, c.currency)}, ` : ""}accept ${money(x.ev.acceptCents, c.currency)}.`,
      `Evidence completeness ${(x.completeness.score * 100).toFixed(0)}%${x.completeness.missingRequired.length ? `; missing required: ${x.completeness.missingRequired.join(", ")}` : ""}.`,
      "Why:",
      ...x.rationale.slice(0, 6).map((r) => `  - ${r}`),
      `Autonomy: ${x.autonomy.autoApprove ? "auto-approved" : "needs approval"} (${x.autonomy.reasons.join("; ")}).`,
    );
  } else if (d.rationale) {
    lines.push(d.rationale);
  }
  return lines.join("\n");
}

/**
 * Approval needs two calls: the first shows what would be filed, the second (confirm: true)
 * approves it. The api only approves PROPOSED decisions, so a stale id can't refile anything.
 */
export async function approveDecision(
  api: RebuttalApi,
  input: { caseId: string; decisionId: string; confirm?: boolean },
): Promise<string> {
  const c = await api.getCase(input.caseId);
  const d = c?.decisions.find((x) => x.id === input.decisionId);
  if (!c || !d) return `No decision ${input.decisionId} on case ${input.caseId}.`;
  if (d.status !== "PROPOSED")
    return `Decision ${d.id} is ${d.status}; only PROPOSED decisions can be approved.`;
  const what =
    d.option === "OFFER"
      ? `make a ${d.offerType ?? "REFUND"} offer of ${money(d.offerAmountCents, c.currency)}`
      : d.option === "ACCEPT"
        ? `accept the claim and refund ${money(c.amountCents, c.currency)}`
        : "file the evidence and contest the dispute";
  if (!input.confirm)
    return `Approving will ${what} on ${c.paypalDisputeId} through PayPal. Ask the seller to confirm, then call approve_decision again with confirm: true.`;
  const r = await api.approve(d.id, "mcp");
  return r.ok ? `Approved: Rebuttal will ${what} on ${c.paypalDisputeId}.` : `Not approved: ${r.error}`;
}

/** REST client for the api, with the same bearer token as the web app. */
export function httpApi(opts: { baseUrl: string; token?: string; fetch?: typeof fetch }): RebuttalApi {
  const f = opts.fetch ?? globalThis.fetch;
  const base = opts.baseUrl.replace(/\/+$/, "");
  const headers = {
    Accept: "application/json",
    ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
  };
  const get = async <T>(path: string): Promise<T | null> => {
    const res = await f(`${base}${path}`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${path} failed with ${res.status}`);
    return (await res.json()) as T;
  };
  return {
    listCases: async () => (await get<CaseSummary[]>("/cases")) ?? [],
    getCase: (id) => get<CaseDetail>(`/cases/${encodeURIComponent(id)}`),
    async approve(id, approvedBy) {
      const res = await f(`${base}/decisions/${encodeURIComponent(id)}/approve`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ approvedBy }),
      });
      if (res.ok) return { ok: true };
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    },
  };
}
