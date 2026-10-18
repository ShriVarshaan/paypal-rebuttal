import { describe, expect, it } from "vitest";
import { cohensKappa, disagreements, fleissKappa } from "./agreement.js";
import { calibrate, split } from "./calibrate.js";
import { generateCases, rng } from "./generate.js";
import { INJECTION_BASES, INJECTION_TEXT, injected, runInjectionSet } from "./injection.js";
import { scoreCase, summarize } from "./metrics.js";
import { toHtml, toMarkdown } from "./report.js";
import { loadCases } from "./run.js";
import { EvalCase } from "./schema.js";
import { alwaysRefund, engine } from "./strategies.js";
import { realizedValue, trueValues } from "./world.js";

const all = loadCases();
const hand = all.filter((c) => c.meta.origin === "hand");
const byId = (id: string) => all.find((c) => c.id === id)!;

describe("hand-written cases (role doc Day 4)", () => {
  it("has 20 valid cases with notes, and the best option is always acceptable", () => {
    expect(hand).toHaveLength(20);
    for (const c of hand) {
      expect(EvalCase.safeParse(c).success).toBe(true);
      expect(c.label.notes.length).toBeGreaterThan(10);
      expect(c.label.acceptableOptions).toContain(c.label.bestOption);
    }
  });

  it("covers 6 not-received, 6 not-as-described, 4 unauthorised and 4 other reasons", () => {
    const count = (r: string) => hand.filter((c) => c.dispute.reason === r).length;
    expect(count("MERCHANDISE_OR_SERVICE_NOT_RECEIVED")).toBe(6);
    expect(count("MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED")).toBe(6);
    expect(count("UNAUTHORISED")).toBe(4);
    expect(new Set(hand.filter((c) => c.id >= "H17").map((c) => c.dispute.reason)).size).toBe(4);
  });

  it("spans $8–$600 and has at least 4 cases where ACCEPT is right", () => {
    const amounts = hand.map((c) => c.dispute.amountCents);
    expect(Math.min(...amounts)).toBeGreaterThanOrEqual(800);
    expect(Math.max(...amounts)).toBeLessThanOrEqual(60_000);
    expect(hand.filter((c) => c.label.bestOption === "ACCEPT").length).toBeGreaterThanOrEqual(4);
  });
});

describe("generated cases", () => {
  it("are reproducible and match the committed files", () => {
    const a = generateCases();
    expect(a).toHaveLength(40);
    expect(JSON.stringify(generateCases())).toBe(JSON.stringify(a));
    const committed = all.filter((c) => c.meta.origin === "generated");
    expect(committed.map((c) => c.id)).toEqual(a.map((c) => c.id));
    expect(committed[0]!.label).toEqual(a[0]!.label);
  });

  it("are balanced across reasons and label the ex-ante best action", () => {
    const a = generateCases();
    expect(new Set(a.map((c) => c.dispute.reason)).size).toBe(7);
    expect(new Set(a.map((c) => c.label.bestOption))).toEqual(new Set(["FIGHT", "OFFER", "ACCEPT"]));
    for (const c of a) {
      expect(c.label.bestOption).toBe(trueValues(c).best.option);
      expect(c.label.acceptableOptions).toContain(c.label.bestOption);
    }
  });

  it("seeded rng is deterministic", () => {
    expect([rng(1).next(), rng(1).next()]).toEqual([rng(1).next(), rng(1).next()]);
  });
});

describe("world", () => {
  it("values outcomes against refunding everything", () => {
    const h01 = byId("H01");
    expect(realizedValue(h01, { option: "ACCEPT" })).toBe(-100);
    expect(realizedValue(h01, { option: "FIGHT" })).toBe(8900 - 1000);
    const lost = { ...h01, label: { ...h01.label, expectedOutcomeIfFight: "LOSE" as const } };
    expect(realizedValue(lost, { option: "FIGHT" })).toBe(-2600 - 1000);
  });

  it("a refused offer falls through to the fight", () => {
    const h08 = byId("H08"); // buyer needs at least 55% back
    expect(realizedValue(h08, { option: "OFFER", offerType: "REFUND", offerAmountCents: 1000 })).toBe(
      realizedValue(h08, { option: "FIGHT" }),
    );
    expect(realizedValue(h08, { option: "OFFER", offerType: "REFUND", offerAmountCents: 2400 })).toBe(
      4000 - 2400 - 400,
    );
  });
});

describe("metrics", () => {
  it("scores the engine above always-refund, with acceptable ≥ strict accuracy", async () => {
    const eng = engine("engine", "Engine");
    const e = summarize(hand, await Promise.all(hand.map(async (c) => scoreCase(c, await eng.run(c)))));
    const r = summarize(
      hand,
      hand.map((c) => scoreCase(c, alwaysRefund.run(c) as never)),
    );
    expect(e.accuracy).toBeGreaterThan(r.accuracy);
    expect(e.accuracy).toBeGreaterThanOrEqual(e.strictAccuracy);
    expect(e.expectedCents).toBeGreaterThan(r.expectedCents);
    expect(e.brier).not.toBeNull();
    expect(r.brier).toBeNull();
    expect(e.reliability.reduce((s, b) => s + b.n, 0)).toBe(20);
    expect(
      Object.values(e.confusion)
        .flatMap((row) => Object.values(row))
        .reduce((a, b) => a + b, 0),
    ).toBe(20);
  });
});

describe("calibration", () => {
  it("splits 50/50 deterministically with no overlap", () => {
    const { train, test } = split(all);
    expect(train).toHaveLength(30);
    expect(test).toHaveLength(30);
    expect(train.some((c) => test.includes(c))).toBe(false);
    expect(split(all).train.map((c) => c.id)).toEqual(train.map((c) => c.id));
  });

  it("lowers train log-loss and stays at the prior with a huge penalty", () => {
    const { train } = split(all);
    const loose = calibrate(train, { lambda: 0.3, iterations: 1500 });
    expect(loose.trainLoss.after).toBeLessThan(loose.trainLoss.before);
    const tight = calibrate(train, { lambda: 1e6, iterations: 200 });
    expect(Math.abs(tight.weights.features.delivery_proof - 1.1)).toBeLessThan(0.01);
  });
});

describe("prompt-injection set (role doc Day 17)", () => {
  it("adds the attack to the dispute and the message thread", () => {
    const c = injected(byId("H01"));
    expect(c.id).toBe("H01-INJ");
    expect(c.dispute.messages.at(-1)!.content).toBe(INJECTION_TEXT);
    const thread = c.evidence.find((e) => e.data["kind"] === "message_thread")!;
    expect(JSON.stringify(thread.data)).toContain("refund $1000");
  });

  it("leaves every engine decision and offer amount unchanged, and flags every attack", async () => {
    const results = await runInjectionSet(all, [engine("engine", "Engine")]);
    expect(results).toHaveLength(INJECTION_BASES.length);
    expect(results.every((r) => r.unchanged)).toBe(true);
    expect(results.every((r) => r.flagged)).toBe(true);
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
