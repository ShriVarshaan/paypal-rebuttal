import { describe, expect, it } from "vitest";
import {
  approveDecision,
  explainDecision,
  httpApi,
  listOpenCases,
  type CaseDetail,
  type RebuttalApi,
} from "./tools.js";

const analysis = {
  engineVersion: "engine-v1/v0",
  pWinModel: 0.9,
  pWin: 0.92,
  contributions: [],
  rationale: ["Delivered to the shipping address on file: +1.10", "Signature confirmation: +0.60"],
  completeness: { score: 0.8, requiredMet: true, missingRequired: [], missingOptional: ["order_details"] },
  ev: { fightCents: 7100, acceptCents: -100, offer: null },
  allowed: ["ACCEPT", "FIGHT"],
  chosen: "FIGHT",
  llm: {
    applied: true,
    delta: 0.02,
    reason: "EX-1 shows a signature",
    exhibits: ["EX-1"],
    ignoredBecause: null,
    triage: null,
  },
  autonomy: { autoApprove: false, reasons: ["amount above the 5000 auto-file limit"] },
  exhibits: [],
  usage: [],
};

function fakeApi(): RebuttalApi & { approved: string[] } {
  const c: CaseDetail = {
    id: "c1",
    paypalDisputeId: "PP-D-90001",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    stage: "CHARGEBACK",
    state: "AWAITING_APPROVAL",
    amountCents: 8900,
    currency: "USD",
    sellerResponseDueAt: "2026-10-21T12:00:00Z",
    decisions: [
      {
        id: "d2",
        option: "FIGHT",
        status: "PROPOSED",
        pWin: 0.92,
        offerAmountCents: null,
        offerType: null,
        note: "n",
        rationale: "r",
        analysis,
      },
      {
        id: "d1",
        option: "ACCEPT",
        status: "REJECTED",
        pWin: 0.5,
        offerAmountCents: null,
        offerType: null,
        note: "n",
        rationale: "r",
        analysis: null,
      },
    ],
  };
  const done = { ...c, id: "c2", paypalDisputeId: "PP-D-2", state: "WON" as const, decisions: [] };
  const approved: string[] = [];
  return {
    approved,
    listCases: async () => [c, done],
    getCase: async (id) => (id === "c1" ? c : null),
    approve: async (id) => (approved.push(id), { ok: true }),
  };
}

describe("MCP tools", () => {
  it("lists only open cases with their deadline", async () => {
    const out = await listOpenCases(fakeApi(), new Date("2026-10-20T12:00:00Z"));
    expect(out).toContain("1 open dispute(s)");
    expect(out).toContain("PP-D-90001");
    expect(out).toContain("due in 24h");
    expect(out).not.toContain("PP-D-2");
  });

  it("explains the current decision from its analysis", async () => {
    const out = await explainDecision(fakeApi(), "c1");
    expect(out).toContain("FIGHT, decision d2 is PROPOSED");
    expect(out).toContain("p_win 0.92 (model 0.90, Claude +0.02: EX-1 shows a signature)");
    expect(out).toContain("fight 71.00 USD");
    expect(out).toContain("Delivered to the shipping address on file: +1.10");
    expect(await explainDecision(fakeApi(), "nope")).toBe("No case nope.");
  });

  it("approval asks for confirmation first, then approves exactly that decision", async () => {
    const api = fakeApi();
    const first = await approveDecision(api, { caseId: "c1", decisionId: "d2" });
    expect(first).toMatch(/confirm: true/);
    expect(api.approved).toEqual([]);
    expect(await approveDecision(api, { caseId: "c1", decisionId: "d2", confirm: true })).toMatch(
      /^Approved/,
    );
    expect(api.approved).toEqual(["d2"]);
    expect(await approveDecision(api, { caseId: "c1", decisionId: "d1", confirm: true })).toMatch(/REJECTED/);
  });

  it("http client sends the bearer token and maps 404 to null", async () => {
    const seen: [string, RequestInit | undefined][] = [];
    const fetch = (async (url: string, init?: RequestInit) => {
      seen.push([url, init]);
      return url.endsWith("/cases/x")
        ? new Response("", { status: 404 })
        : new Response(JSON.stringify({ error: "decision is APPROVED" }), { status: 409 });
    }) as unknown as typeof globalThis.fetch;
    const api = httpApi({ baseUrl: "http://api.test/", token: "t", fetch });
    expect(await api.getCase("x")).toBeNull();
    expect(await api.approve("d", "mcp")).toEqual({ ok: false, error: "decision is APPROVED" });
    expect((seen[0]![1]!.headers as Record<string, string>)["Authorization"]).toBe("Bearer t");
    expect(seen[1]![0]).toBe("http://api.test/decisions/d/approve");
  });
});
