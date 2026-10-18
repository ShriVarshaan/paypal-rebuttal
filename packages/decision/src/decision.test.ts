import {
  DEFAULT_POLICY,
  Economics,
  OfferPolicy,
  Policy,
  assignExhibits,
  type TriageResult,
} from "@rebuttal/core";
import { describe, expect, it } from "vitest";
import { decideCase, llmAdjustment, safeOption, analyzeCase, chooseOption } from "./engine.js";
import { evAccept, evFight, evOffer, labor, pAccept, riskPenalty } from "./ev.js";
import { safeDefault } from "./index.js";
import { optimizeOffer } from "./offer.js";
import { extractSignals, isDigital } from "./signals.js";
import { ev, testCase } from "./testing.js";
import { HAND_WEIGHTS, features, predictWin } from "./win-model.js";

const E = Economics.parse({});
const O = OfferPolicy.parse({});
const NOW = new Date("2026-10-20T12:00:00Z");

describe("signals and win model", () => {
  it("rewards delivery to the address on file and punishes failed shipments", () => {
    const c = testCase();
    const p = (items: Parameters<typeof extractSignals>[1]) => predictWin(c, extractSignals(c, items)).pWin;
    const delivered = p([ev.tracking()]);
    const wrongAddress = p([ev.tracking("delivered", { deliveredTo: { zip: "10001" } })]);
    const returned = p([ev.tracking("return_to_sender")]);
    const none = p([]);
    expect(delivered).toBeGreaterThan(0.8);
    expect(wrongAddress).toBeLessThan(delivered);
    expect(none).toBeLessThan(0.3);
    expect(returned).toBeLessThan(none);
  });

  it("zeroes features that don't apply to the reason", () => {
    const c = testCase({ reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED" });
    const x = features(c, extractSignals(c, [ev.tracking()]));
    expect(x.delivery_proof).toBe(0);
    expect(x.no_tracking).toBe(0);
  });

  it("explains itself: contributions sum to the logit", () => {
    const c = testCase();
    const pred = predictWin(
      c,
      extractSignals(c, [ev.tracking(), ev.of("message_thread", { sellerReplied: true })]),
    );
    const z = pred.contributions.reduce((s, k) => s + k.contribution, 0);
    expect(z).toBeCloseTo(pred.logit);
    expect(pred.contributions[0]!.feature).toBe("delivery_proof");
  });

  it("detects digital goods", () => {
    expect(isDigital(testCase(), [ev.of("access_log", { accessCount: 2 })])).toBe(true);
    expect(isDigital(testCase(), [ev.of("order", { items: [{ name: "e-book", digital: true }] })])).toBe(
      true,
    );
    expect(isDigital(testCase(), [ev.tracking()])).toBe(false);
  });

  it("stage lowers the odds", () => {
    const s = extractSignals(testCase(), [ev.tracking()]);
    expect(predictWin(testCase({ stage: "ARBITRATION" }), s).pWin).toBeLessThan(
      predictWin(testCase({ stage: "INQUIRY" }), s).pWin,
    );
    expect(HAND_WEIGHTS.base["default"]).toBeLessThan(0);
  });
});

describe("EV", () => {
  it("matches the plan's formulas", () => {
    expect(labor(E, 30)).toBe(1500);
    expect(riskPenalty(E)).toBeCloseTo(600); // 1500 × 0.004 / 0.01
    expect(evFight(10_000, 0.7, E)).toBeCloseTo(7000 - 0.3 * 2600 - 1000);
    expect(evAccept(E)).toBeCloseTo(-100);
  });

  it("acceptance rises with the offer and drops when a return is required", () => {
    expect(pAccept(0.2, "REFUND", O)).toBeLessThan(pAccept(0.6, "REFUND", O));
    expect(pAccept(1, "REFUND_WITH_RETURN", O)).toBeCloseTo(pAccept(1, "REFUND", O) - O.returnAcceptPenalty);
  });

  it("an offer the buyer refuses falls back to fighting", () => {
    const fight = evFight(10_000, 0.5, E);
    const { ev: v, pAccept: p } = evOffer(10_000, 4000, "REFUND", 0.5, E, O);
    expect(v).toBeCloseTo(p * (6000 - labor(E, E.offerMinutes)) + (1 - p) * fight);
  });
});

describe("offer optimizer", () => {
  const base = { amountCents: 6450, currency: "USD", pWin: 0.2, digital: false, economics: E, offer: O };

  it("finds an interior partial refund in whole dollars that beats both extremes", () => {
    const best = optimizeOffer({ ...base, allowedTypes: ["REFUND"] })!;
    expect(best.type).toBe("REFUND");
    expect(best.amountCents % 100).toBe(0);
    expect(best.amountCents).toBeGreaterThan(0.2 * 6450);
    expect(best.amountCents).toBeLessThan(0.9 * 6450);
    for (const r of [0.1, 0.9]) {
      expect(best.evCents).toBeGreaterThanOrEqual(
        evOffer(6450, Math.round(r * 6450), "REFUND", 0.2, E, O).ev,
      );
    }
  });

  it("offers more when the case is weaker", () => {
    const weak = optimizeOffer({ ...base, pWin: 0.05, allowedTypes: ["REFUND"] })!;
    const strong = optimizeOffer({ ...base, pWin: 0.6, allowedTypes: ["REFUND"] })!;
    expect(weak.amountCents).toBeGreaterThanOrEqual(strong.amountCents);
  });

  it("returns null when PayPal allows no offers, and skips returns for digital goods", () => {
    expect(optimizeOffer({ ...base, allowedTypes: [] })).toBeNull();
    expect(optimizeOffer({ ...base, digital: true, allowedTypes: ["REFUND_WITH_RETURN"] })).toBeNull();
    expect(optimizeOffer({ ...base, allowedTypes: ["REFUND_WITH_REPLACEMENT"] })).toBeNull();
  });
});

describe("decideCase on the three fixture paths", () => {
  it("PP-D-90001 not received, delivered with signature: FIGHT", () => {
    const d = decideCase({
      c: testCase(),
      evidence: [
        ev.tracking("delivered", { signedBy: "J. DOE" }),
        ev.of("message_thread", { sellerReplied: true }),
      ],
      policy: DEFAULT_POLICY,
      now: NOW,
    });
    expect(d.option).toBe("FIGHT");
    expect(d.decision.pWin).toBeGreaterThan(0.85);
    // $89 is above the $50 auto-file limit.
    expect(d.autonomy.autoApprove).toBe(false);
  });

  it("PP-D-90002 not as described, no listing snapshot, inquiry: OFFER a partial refund", () => {
    const d = decideCase({
      c: testCase({
        reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
        stage: "INQUIRY",
        amount: { cents: 6450, currency: "USD" },
        allowedResponseOptions: {
          make_offer: { offer_types: ["REFUND", "REFUND_WITH_RETURN", "REFUND_WITH_REPLACEMENT"] },
          accept_claim: { accept_claim_types: ["REFUND", "REFUND_WITH_RETURN"] },
        },
      }),
      evidence: [ev.of("message_thread", { sellerReplied: true })],
      policy: DEFAULT_POLICY,
      now: NOW,
    });
    expect(d.option).toBe("OFFER");
    expect(d.offerType).toBe("REFUND");
    expect(d.offerAmountCents).toBeGreaterThan(0);
    expect(d.offerAmountCents).toBeLessThan(6450);
  });

  it("PP-D-90003 unauthorised $8.50 digital: ACCEPT (fighting costs more than it's worth) and auto-files", () => {
    const d = decideCase({
      c: testCase({ reason: "UNAUTHORISED", amount: { cents: 850, currency: "USD" } }),
      evidence: [ev.of("access_log", { accessCount: 3, accessedAfterPurchase: true })],
      policy: DEFAULT_POLICY,
      now: NOW,
    });
    expect(d.option).toBe("ACCEPT");
    expect(d.autonomy.autoApprove).toBe(true);
  });
});

describe("autonomy", () => {
  const strong = [
    ev.tracking("delivered", { signedBy: "J" }),
    ev.of("message_thread", { sellerReplied: true }),
    ev.of("order"),
  ];

  it("auto-files a strong small fight", () => {
    const d = decideCase({
      c: testCase({ amount: { cents: 4500, currency: "USD" } }),
      evidence: strong,
      policy: DEFAULT_POLICY,
      now: NOW,
    });
    expect(d.option).toBe("FIGHT");
    expect(d.autonomy).toMatchObject({ autoApprove: true });
  });

  it("asks a human when policy is off, and explains why", () => {
    const policy = Policy.parse({ autonomy: { enabled: false } });
    const d = decideCase({
      c: testCase({ amount: { cents: 4500, currency: "USD" } }),
      evidence: strong,
      policy,
      now: NOW,
    });
    expect(d.autonomy.autoApprove).toBe(false);
    expect(d.autonomy.reasons).toContain("autonomy is off");
  });

  it("deadline override auto-approves the safe option", () => {
    const c = testCase({
      amount: { cents: 30_000, currency: "USD" },
      sellerResponseDueAt: "2026-10-21T06:00:00Z",
    });
    const d = decideCase({ c, evidence: [], policy: DEFAULT_POLICY, now: NOW });
    expect(d.autonomy).toMatchObject({ autoApprove: true, reason: "DEADLINE" });
    expect(d.option).not.toBe("FIGHT");
  });

  it("safeOption swaps an incomplete FIGHT for the next best option", () => {
    const c = testCase({ amount: { cents: 50_000, currency: "USD" } });
    const analysis = analyzeCase(
      c,
      [ev.tracking("delivered", { deliveredTo: { zip: "10001" } })],
      DEFAULT_POLICY,
    );
    const d = chooseOption(c, analysis, DEFAULT_POLICY, 0.6);
    expect(d.option).toBe("FIGHT");
    expect(safeOption(d, analysis)).toBe("ACCEPT");
  });
});

describe("LLM adjustment", () => {
  const exhibits = assignExhibits([ev.tracking()]);
  const triage = (over: Partial<TriageResult> = {}): TriageResult => ({
    summary: "s",
    pWinAdjustment: 0.08,
    adjustmentReason: "Signed delivery in EX-1",
    citedExhibits: ["EX-1"],
    strengths: [],
    weaknesses: [],
    missingEvidence: [],
    suggestedOption: "FIGHT",
    injectionSuspected: false,
    ...over,
  });

  it("applies a cited adjustment and clamps to the policy bound", () => {
    expect(llmAdjustment(triage(), exhibits, DEFAULT_POLICY)).toMatchObject({ applied: true, delta: 0.08 });
    const tight = Policy.parse({ llm: { maxAdjustment: 0.05 } });
    expect(llmAdjustment(triage(), exhibits, tight)?.delta).toBe(0.05);
  });

  it("ignores uncited, unknown-exhibit or injection-flagged adjustments", () => {
    expect(llmAdjustment(triage({ citedExhibits: [] }), exhibits, DEFAULT_POLICY)?.applied).toBe(false);
    expect(
      llmAdjustment(triage({ citedExhibits: ["EX-9"] }), exhibits, DEFAULT_POLICY)?.ignoredBecause,
    ).toMatch(/no known exhibit/);
    expect(llmAdjustment(triage({ injectionSuspected: true }), exhibits, DEFAULT_POLICY)?.applied).toBe(
      false,
    );
  });

  it("moves p_win by exactly the delta", () => {
    const c = testCase();
    const without = decideCase({ c, evidence: [ev.tracking()], policy: DEFAULT_POLICY, now: NOW });
    const withLlm = decideCase({
      c,
      evidence: [ev.tracking()],
      policy: DEFAULT_POLICY,
      now: NOW,
      exhibits,
      triage: triage({ pWinAdjustment: -0.1 }),
    });
    expect(withLlm.decision.pWin).toBeCloseTo(without.decision.pWin - 0.1);
  });
});

describe("safeDefault (SLA T-2h)", () => {
  it("fights a delivered not-received claim with a note citing the tracking", () => {
    const out = safeDefault({
      case: {
        paypalDisputeId: "PP-D-1",
        reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
        stage: "CHARGEBACK",
        amount: { cents: 8900, currency: "USD" },
      },
      evidence: [{ type: "PROOF_OF_FULFILLMENT", source: "easypost", data: ev.tracking().data }],
      now: NOW,
    });
    expect(out).toMatchObject({ option: "FIGHT", reason: "DEADLINE" });
    expect(out.note).toContain("EZ4000000004");
  });

  it("accepts when there's no evidence", () => {
    const out = safeDefault({
      case: {
        paypalDisputeId: "PP-D-1",
        reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
        stage: "CHARGEBACK",
        amount: { cents: 8900, currency: "USD" },
      },
      evidence: [],
      now: NOW,
    });
    expect(out).toMatchObject({ option: "ACCEPT", reason: "DEADLINE" });
  });
});
