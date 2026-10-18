import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LlmClient } from "@rebuttal/agent";
import { assignExhibits, DecisionOption, type AgentUsage, type TriageResult } from "@rebuttal/core";
import { FEATURES, HAND_WEIGHTS } from "@rebuttal/decision";
import { z } from "zod";
import { calibrateCv, split } from "./calibrate.js";
import { HAND_CASES } from "./cases/hand.js";
import { scoreCase, summarize, type CaseResult, type Metrics } from "./metrics.js";
import { num, pct, usd, type Report, type Section } from "./report.js";
import { EvalCase } from "./schema.js";
import {
  alwaysFight,
  alwaysRefund,
  engine,
  hybrid,
  llmOnly,
  rulesOnly,
  triageRunner,
  type Strategy,
  type TriageCache,
} from "./strategies.js";

export const PKG = join(import.meta.dirname, "..");
export const GENERATED_PATH = join(PKG, "cases/generated.json");
export const CACHE_PATH = join(PKG, "results/llm-cache.json");

export function loadCases(): EvalCase[] {
  const generated = existsSync(GENERATED_PATH)
    ? z.array(EvalCase).parse(JSON.parse(readFileSync(GENERATED_PATH, "utf8")))
    : [];
  return [...HAND_CASES.map((c) => EvalCase.parse(c)), ...generated];
}

export interface StrategyRun {
  id: string;
  label: string;
  status: "ran" | "skipped";
  note?: string;
  all?: Metrics;
  test?: Metrics;
  results?: CaseResult[];
}

export interface EvalRun {
  generatedAt: string;
  cases: number;
  split: { train: string[]; test: string[] };
  calibration: ReturnType<typeof calibrateCv>;
  strategies: StrategyRun[];
  llmUsage: AgentUsage[];
}

const CacheFile = z.record(z.string(), z.object({ triage: z.unknown(), usage: z.array(z.unknown()) }));

export function fileCache(raw: unknown): TriageCache & { dump(): Record<string, unknown>; dirty: boolean } {
  const data = CacheFile.safeParse(raw).success
    ? (raw as Record<string, { triage: TriageResult; usage: AgentUsage[] }>)
    : {};
  const cache = {
    dirty: false,
    get: (id: string) => data[id],
    set: (id: string, v: { triage: TriageResult; usage: AgentUsage[] }) => {
      data[id] = v;
      cache.dirty = true;
    },
    dump: () => data,
  };
  return cache;
}

async function runStrategy(s: Strategy, cases: EvalCase[], testIds: Set<string>): Promise<StrategyRun> {
  const results: CaseResult[] = [];
  for (const c of cases) results.push(scoreCase(c, await s.run(c)));
  return {
    id: s.id,
    label: s.label,
    status: "ran",
    all: summarize(cases, results),
    test: summarize(
      cases.filter((c) => testIds.has(c.id)),
      results.filter((r) => testIds.has(r.caseId)),
    ),
    results,
  };
}

export async function runEval(opts: {
  llm: LlmClient | null;
  cache: TriageCache;
  now?: Date;
}): Promise<EvalRun> {
  const cases = loadCases();
  const { train, test } = split(cases);
  const testIds = new Set(test.map((c) => c.id));
  const calibration = calibrateCv(train);

  const offline: Strategy[] = [
    alwaysRefund,
    alwaysFight,
    rulesOnly,
    engine("engine", "Engine (hand weights)"),
    engine("engine-calibrated", "Engine (calibrated on train)", calibration.weights),
  ];
  const strategies: StrategyRun[] = [];
  for (const s of offline) strategies.push(await runStrategy(s, cases, testIds));

  // Claude strategies run when a client is available or every case is already cached.
  const triage = triageRunner(opts.llm, opts.cache);
  const canLlm = !!opts.llm || cases.every((c) => opts.cache.get(c.id));
  for (const s of [llmOnly(triage), hybrid(triage)]) {
    if (!canLlm) {
      strategies.push({
        id: s.id,
        label: s.label,
        status: "skipped",
        note: "needs ANTHROPIC_API_KEY and --llm (or a full results/llm-cache.json)",
      });
      continue;
    }
    try {
      strategies.push(await runStrategy(s, cases, testIds));
    } catch (err) {
      strategies.push({
        id: s.id,
        label: s.label,
        status: "skipped",
        note: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const llmUsage = canLlm ? cases.flatMap((c) => opts.cache.get(c.id)?.usage ?? []) : [];
  return {
    generatedAt: (opts.now ?? new Date()).toISOString(),
    cases: cases.length,
    split: { train: train.map((c) => c.id), test: test.map((c) => c.id) },
    calibration,
    strategies,
    llmUsage,
  };
}

const metricRow = (s: StrategyRun, m: Metrics | undefined, baseline: Metrics | undefined) =>
  s.status === "ran" && m
    ? [
        s.label,
        pct(m.accuracy),
        num(m.brier),
        num(m.brierVsTruth),
        usd(m.realizedCents),
        baseline ? usd(m.realizedCents - baseline.realizedCents) : "—",
        usd(m.expectedCents),
        usd(m.regretCents),
      ]
    : [s.label, "—", "—", "—", "—", "—", "—", s.note ?? "skipped"];

const HEAD = [
  "Strategy",
  "Accuracy",
  "Brier",
  "Brier vs true p",
  "Realized $",
  "Δ vs always-refund",
  "Expected $",
  "Regret $",
];

export function buildReport(run: EvalRun): Report {
  const cases = loadCases();
  const byId = (id: string) => run.strategies.find((s) => s.id === id);
  const base = byId("always-refund");
  const eng = byId("engine")!;
  const cal = byId("engine-calibrated")!;
  const hyb = byId("hybrid");
  const prod = hyb?.status === "ran" ? hyb : eng;

  const rules = byId("rules-only")!;
  const fight = byId("always-fight")!;
  const headline = [
    `+${usd(prod.all!.expectedCents - base!.all!.expectedCents)} expected (+${usd(prod.all!.realizedCents - base!.all!.realizedCents)} realized) vs always-refund on ${run.cases} cases (${prod.label}).`,
    `Only ${usd(prod.all!.regretCents)} of expected value lost against the ex-ante best decision, vs ${usd(rules.all!.regretCents)} for rules-only and ${usd(fight.all!.regretCents)} for always-fight.`,
    `Decision accuracy ${pct(prod.all!.accuracy)} vs ${pct(rules.all!.accuracy)} rules-only and ${pct(fight.all!.accuracy)} always-fight.`,
    `Brier score ${num(eng.all!.brier)} (hand weights); on the held-out half ${num(eng.test!.brier)} hand vs ${num(cal.test!.brier)} calibrated.`,
  ];
  const luckier = run.strategies.filter(
    (s) => s.status === "ran" && s.id !== prod.id && s.all!.realizedCents > prod.all!.realizedCents,
  );

  const reasons = [...new Set(cases.map((c) => c.dispute.reason))];
  const labelMix = DecisionOption.options
    .map((o) => `${o} ${cases.filter((c) => c.label.option === o).length}`)
    .join(", ");
  const sections: Section[] = [
    {
      title: "Dataset",
      text: [
        `${run.cases} labeled synthetic disputes: ${cases.filter((c) => c.origin === "hand").length} hand-written and ${cases.filter((c) => c.origin === "generated").length} generated (seeded, \`pnpm eval:generate\`). Labels: ${labelMix}.`,
        "Hand-written cases carry draft labels by B with a written rationale; generated cases are labeled with the ex-ante best action under the generator's true win probability. Every case also has a realized outcome drawn from that probability, which the dollar figures use. Team labels (plan Day 12) go in `packages/eval/labels/`; run `pnpm eval:agreement` for inter-rater agreement.",
      ],
      tables: [
        {
          table: {
            head: ["Reason", "Cases", "Hand", "Generated"],
            rows: reasons.map((r) => [
              r,
              cases.filter((c) => c.dispute.reason === r).length,
              cases.filter((c) => c.dispute.reason === r && c.origin === "hand").length,
              cases.filter((c) => c.dispute.reason === r && c.origin === "generated").length,
            ]),
          },
        },
      ],
    },
    {
      title: "Results on all cases",
      text: [
        "Realized $ is what the seller ends up with against refunding everything (0), using each case's drawn outcome. Expected $ uses the true win probability instead and is less noisy. Regret is expected value given up against the ex-ante best action.",
      ],
      tables: [{ table: { head: HEAD, rows: run.strategies.map((s) => metricRow(s, s.all, base?.all)) } }],
    },
    {
      title: "Held-out test split (calibration)",
      text: [
        `Weights tuned on the ${run.split.train.length}-case train split (L2 toward the hand weights, λ = ${run.calibration.lambda} chosen by 5-fold CV inside train; train log-loss ${num(run.calibration.trainLoss.before)} → ${num(run.calibration.trainLoss.after)}), scored on the ${run.split.test.length}-case test split.`,
      ],
      tables: [{ table: { head: HEAD, rows: run.strategies.map((s) => metricRow(s, s.test, base?.test)) } }],
    },
    {
      title: "Ablation: rules only vs Claude only vs hybrid",
      text: [
        "The production design is the hybrid: the EV engine decides and Claude may only nudge p_win by ±0.10 with cited exhibits. Claude only takes the triage agent's advisory suggestedOption at face value.",
        hyb?.status === "ran"
          ? `Claude cost: ${usd(run.llmUsage.reduce((s, u) => s + u.costUsd, 0) * 100)} total, ${usd((run.llmUsage.reduce((s, u) => s + u.costUsd, 0) * 100) / run.cases)} per case; median latency ${Math.round([...run.llmUsage.map((u) => u.latencyMs)].sort((a, b) => a - b)[Math.floor(run.llmUsage.length / 2)] ?? 0)} ms per call.`
          : "The Claude rows were not run in this report (no API key). Run `pnpm eval --llm` with ANTHROPIC_API_KEY set; responses are cached in `results/llm-cache.json` so reruns are free.",
      ],
      tables: [
        {
          table: {
            head: HEAD,
            rows: ["rules-only", "llm-only", "engine", "hybrid"]
              .map((id) => byId(id)!)
              .map((s) => metricRow(s, s.all, base?.all)),
          },
        },
      ],
    },
    {
      title: "Engine confusion matrix and per-reason accuracy",
      tables: [
        {
          caption: "Rows: label. Columns: engine's choice.",
          table: {
            head: ["Label \\ Engine", ...DecisionOption.options],
            rows: DecisionOption.options.map((l) => [
              l,
              ...DecisionOption.options.map((p) => eng.all!.confusion[l][p]),
            ]),
          },
        },
        {
          table: {
            head: ["Reason", "Cases", "Engine accuracy"],
            rows: Object.entries(eng.all!.byReason).map(([r, v]) => [r, v.n, pct(v.correct / v.n)]),
          },
        },
      ],
    },
    {
      title: "Calibrated weights",
      text: [
        'Largest changes from the hand-set weights. `pnpm eval:calibrate` writes them to `packages/decision/src/weights.calibrated.json`; set `winModel: "calibrated"` in the merchant policy to use them.',
      ],
      tables: [
        {
          table: {
            head: ["Feature", "Hand", "Calibrated", "Change"],
            rows: FEATURES.map(
              (f) =>
                [
                  f,
                  HAND_WEIGHTS.features[f],
                  run.calibration.weights.features[f],
                  run.calibration.weights.features[f] - HAND_WEIGHTS.features[f],
                ] as const,
            )
              .sort((a, b) => Math.abs(b[3]) - Math.abs(a[3]))
              .slice(0, 8)
              .map(([f, a, b, d]) => [f, a.toFixed(2), b.toFixed(2), `${d >= 0 ? "+" : ""}${d.toFixed(2)}`]),
          },
        },
      ],
    },
    {
      title: "Where the engine disagrees with the label",
      tables: [
        {
          table: {
            head: ["Case", "Label", "Engine", "p_win", "True p", "Label rationale"],
            rows: eng
              .results!.filter((r) => r.output.option !== r.label)
              .map((r) => {
                const c = cases.find((x) => x.id === r.caseId)!;
                return [
                  c.id,
                  r.label,
                  r.output.option,
                  num(r.output.pWin, 2),
                  num(c.truth.pWin, 2),
                  c.label.rationale,
                ];
              }),
          },
        },
      ],
    },
    {
      title: "Caveats",
      text: [
        "The cases are synthetic, and the generator's world shares the engine's feature definitions (with different weights and hidden noise), so absolute numbers flatter a real deployment. The comparison between strategies is the useful signal.",
        "Dollar figures use the default policy's economics ($20 loss fee, $30/h labour, 20 minutes per fight); see docs/decision-engine.md. Labels are draft until the team's independent labeling round is merged.",
        ...(luckier.length
          ? [
              `Realized dollars are one draw of 60 coin flips, so they are noisy: on this draw ${luckier.map((s) => s.label).join(", ")} realized more than the ${prod.label.toLowerCase()} despite a lower expected value. Judge strategies on expected value and regret.`,
            ]
          : []),
      ],
    },
  ];
  return { title: "Rebuttal eval report", generatedAt: run.generatedAt, headline, sections };
}

/** Exhibit index for a case, used by the label sheet. */
export function caseSummary(c: EvalCase): string {
  return (
    assignExhibits(c.evidence)
      .map((e) => `${e.exhibitId}: ${e.summary}`)
      .join("; ") || "no evidence"
  );
}
