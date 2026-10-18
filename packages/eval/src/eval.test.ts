import { describe, expect, it } from "vitest";
import { cohensKappa, disagreements, fleissKappa } from "./agreement.js";
import { calibrate, split } from "./calibrate.js";
import { HAND_CASES } from "./cases/hand.js";
import { generateCases, rng } from "./generate.js";
import { scoreCase, summarize } from "./metrics.js";
import { toHtml, toMarkdown } from "./report.js";
import { EvalCase } from "./schema.js";
import { alwaysRefund, engine } from "./strategies.js";
import { realizedValue, trueValues } from "./world.js";

describe("cases", () => {
  it("has 20 valid hand-written cases with rationales", () => {
    expect(HAND_CASES).toHaveLength(20);
    for (const c of HAND_CASES) {
      expect(EvalCase.safeParse(c).success).toBe(true);
      expect(c.label.rationale.length).toBeGreaterThan(10);
    }
    expect(new Set(HAND_CASES.map((c) => c.id)).size).toBe(20);
  });

  it("generates the same 40 cases for the same seed, balanced across reasons", () => {
    const a = generateCases();
    expect(a).toHaveLength(40);
    expect(JSON.stringify(generateCases())).toBe(JSON.stringify(a));
    const reasons = new Set(a.map((c) => c.dispute.reason));
    expect(reasons.size).toBe(7);
    expect(new Set(a.map((c) => c.label.option))).toEqual(new Set(["FIGHT", "OFFER", "ACCEPT"]));
    // Labels are the ex-ante best action under the world's p_win.
    for (const c of a) expect(c.label.option).toBe(trueValues(c).best.option);
  });

  it("seeded rng is deterministic", () => {
    expect([rng(1).next(), rng(1).next()]).toEqual([rng(1).next(), rng(1).next()]);
  });
});

describe("world", () => {
  const h01 = HAND_CASES.find((c) => c.id === "H01")!;

  it("values outcomes against refunding everything", () => {
    expect(realizedValue(h01, { option: "ACCEPT" })).toBe(-100);
    expect(realizedValue(h01, { option: "FIGHT" })).toBe(8900 - 1000);
    expect(realizedValue({ ...h01, truth: { ...h01.truth, wins: false } }, { option: "FIGHT" })).toBe(
      -2600 - 1000,
    );
  });

  it("a refused offer falls through to the fight", () => {
    const h08 = HAND_CASES.find((c) => c.id === "H08")!;
    const low = realizedValue(h08, { option: "OFFER", offerType: "REFUND", offerAmountCents: 1000 });
    const ok = realizedValue(h08, { option: "OFFER", offerType: "REFUND", offerAmountCents: 4000 });
    expect(low).toBe(realizedValue(h08, { option: "FIGHT" }));
    expect(ok).toBe(6450 - 4000 - 400);
  });
});

describe("metrics", () => {
  it("scores the engine above always-refund on the hand cases", async () => {
    const eng = engine("engine", "Engine");
    const e = summarize(
      HAND_CASES,
      await Promise.all(HAND_CASES.map(async (c) => scoreCase(c, await eng.run(c)))),
    );
    const r = summarize(
      HAND_CASES,
      HAND_CASES.map((c) => scoreCase(c, alwaysRefund.run(c) as never)),
    );
    expect(e.accuracy).toBeGreaterThan(r.accuracy);
    expect(e.expectedCents).toBeGreaterThan(r.expectedCents);
    expect(e.brier).not.toBeNull();
    expect(r.brier).toBeNull();
    expect(
      Object.values(e.confusion)
        .flatMap((row) => Object.values(row))
        .reduce((a, b) => a + b, 0),
    ).toBe(20);
  });
});

describe("calibration", () => {
  const all = [...HAND_CASES, ...generateCases()];

  it("splits 50/50 deterministically with no overlap", () => {
    const { train, test } = split(all);
    expect(train).toHaveLength(30);
    expect(test).toHaveLength(30);
    expect(train.some((c) => test.includes(c))).toBe(false);
    expect(split(all).train.map((c) => c.id)).toEqual(train.map((c) => c.id));
  });

  it("lowers train log-loss and stays near the prior with a strong penalty", () => {
    const { train } = split(all);
    const loose = calibrate(train, { lambda: 0.3, iterations: 1500 });
    expect(loose.trainLoss.after).toBeLessThan(loose.trainLoss.before);
    const tight = calibrate(train, { lambda: 1e6, iterations: 200 });
    expect(Math.abs(tight.weights.features.delivery_proof - 1.1)).toBeLessThan(0.01);
  });
});

describe("agreement", () => {
  const a = { labeler: "A", labels: { x: "FIGHT", y: "ACCEPT", z: "OFFER", w: "FIGHT" } } as const;
  const b = { labeler: "B", labels: { x: "FIGHT", y: "ACCEPT", z: "OFFER", w: "FIGHT" } } as const;
  const c = { labeler: "C", labels: { x: "ACCEPT", y: "ACCEPT", z: "OFFER", w: "FIGHT" } } as const;

  it("is 1 for identical raters and lower when they disagree", () => {
    expect(cohensKappa(a.labels, b.labels).kappa).toBe(1);
    expect(cohensKappa(a.labels, c.labels).kappa).toBeLessThan(1);
    expect(fleissKappa([a, b]).kappa).toBeCloseTo(1);
    expect(fleissKappa([a, b, c]).kappa).toBeLessThan(1);
    expect(disagreements([a, b, c])).toEqual([
      { caseId: "x", votes: { A: "FIGHT", B: "FIGHT", C: "ACCEPT" } },
    ]);
  });
});

describe("report", () => {
  it("renders markdown and escaped HTML", () => {
    const r = {
      title: "T",
      generatedAt: "now",
      headline: ["**h** <x>"],
      sections: [{ title: "S", tables: [{ table: { head: ["a|b"], rows: [["<i>"]] } }] }],
    };
    expect(toMarkdown(r)).toContain("| a\\|b |");
    const html = toHtml(r);
    expect(html).toContain("&lt;i&gt;");
    expect(html).toContain("<strong>h</strong> &lt;x&gt;");
    expect(html).toContain("prefers-color-scheme:dark");
  });
});
