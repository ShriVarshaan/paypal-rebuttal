import { describe, expect, it } from "vitest";
import { TriageResult } from "./analysis.js";
import { CaseState } from "./case.js";
import { assignExhibits, isExhibitId } from "./exhibits.js";
import { DEFAULT_POLICY, Policy, policyFrom } from "./policy.js";
import { allowedResponses } from "./response-options.js";
import { assertTransition, canTransition, IllegalTransitionError, TRANSITIONS } from "./state-machine.js";

describe("state machine", () => {
  it("covers every state", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...CaseState.options].sort());
  });

  it("allows the happy path and resolution from open states", () => {
    const path: CaseState[] = [
      "NEW",
      "GATHERING",
      "TRIAGED",
      "AWAITING_APPROVAL",
      "FILING",
      "FILED",
      "WAITING_PAYPAL",
      "WON",
    ];
    for (let i = 1; i < path.length; i++) expect(canTransition(path[i - 1]!, path[i]!)).toBe(true);
    expect(canTransition("FILING", "OFFER_PENDING")).toBe(true);
    expect(canTransition("LOST", "APPEAL_DRAFTED")).toBe(true);
  });

  it("rejects moves out of WON/REFUNDED and skipping filing", () => {
    expect(canTransition("WON", "LOST")).toBe(false);
    expect(canTransition("REFUNDED", "TRIAGED")).toBe(false);
    expect(canTransition("AWAITING_APPROVAL", "FILED")).toBe(false);
    expect(() => assertTransition("WON", "FILING")).toThrow(IllegalTransitionError);
  });
});

describe("policy", () => {
  it("fills nested defaults from an empty object", () => {
    expect(DEFAULT_POLICY.autonomy.maxAmountCents).toBe(5000);
    expect(DEFAULT_POLICY.economics.lossFeeCents).toBe(2000);
    expect(DEFAULT_POLICY.llm.maxAdjustment).toBe(0.1);
  });

  it("keeps partial overrides and never lets the LLM bound exceed 0.10", () => {
    const p = Policy.parse({ autonomy: { maxAmountCents: 10000 } });
    expect(p.autonomy.maxAmountCents).toBe(10000);
    expect(p.autonomy.minPWinToFight).toBe(0.8);
    expect(Policy.safeParse({ llm: { maxAdjustment: 0.3 } }).success).toBe(false);
    expect(policyFrom({ llm: { maxAdjustment: 0.3 } })).toEqual(DEFAULT_POLICY);
  });
});

describe("allowedResponses", () => {
  it("reads PayPal's allowed_response_options", () => {
    const a = allowedResponses(
      { make_offer: { offer_types: ["REFUND", "BOGUS"] }, accept_claim: { accept_claim_types: ["REFUND"] } },
      "INQUIRY",
    );
    expect(a).toEqual({
      fight: true,
      offerTypes: ["REFUND"],
      accept: true,
      acceptTypes: ["REFUND"],
      fromPayPal: true,
    });
  });

  it("assumes offers only at the inquiry stage when PayPal is silent", () => {
    expect(allowedResponses(null, "INQUIRY").offerTypes).toEqual(["REFUND", "REFUND_WITH_RETURN"]);
    expect(allowedResponses(undefined, "CHARGEBACK").offerTypes).toEqual([]);
    expect(allowedResponses({ accept_claim: {} }, "INQUIRY").offerTypes).toEqual([]);
  });
});

describe("exhibits", () => {
  it("numbers deterministically, tracking first", () => {
    const items = [
      {
        id: "m",
        source: "messages",
        type: "OTHER",
        data: { kind: "message_thread", messages: [{}], sellerReplied: true },
      },
      {
        id: "t",
        source: "easypost",
        type: "PROOF_OF_FULFILLMENT",
        data: { trackingCode: "EZ1", status: "delivered", signedBy: "J" },
      },
    ];
    const ex = assignExhibits(items);
    expect(ex.map((e) => [e.exhibitId, e.evidenceId])).toEqual([
      ["EX-1", "t"],
      ["EX-2", "m"],
    ]);
    expect(assignExhibits([...items].reverse())).toEqual(ex);
    expect(ex[0]!.summary).toContain("signature on file");
    expect(ex[1]!.summary).toBe("Message thread: 1 message(s), seller replied: yes");
    expect(isExhibitId("EX-12")).toBe(true);
    expect(isExhibitId("EX-")).toBe(false);
  });
});

describe("TriageResult", () => {
  it("rejects adjustments beyond ±0.10", () => {
    const base = {
      summary: "s",
      pWinAdjustment: 0.05,
      adjustmentReason: "EX-1 shows delivery",
      citedExhibits: ["EX-1"],
      strengths: [],
      weaknesses: [],
      missingEvidence: [],
      keyFacts: [],
      riskFlags: [],
      suggestedOption: "FIGHT",
      injectionSuspected: false,
    };
    expect(TriageResult.safeParse(base).success).toBe(true);
    expect(TriageResult.safeParse({ ...base, pWinAdjustment: 0.2 }).success).toBe(false);
    expect(TriageResult.safeParse({ ...base, citedExhibits: ["exhibit 1"] }).success).toBe(false);
  });
});
