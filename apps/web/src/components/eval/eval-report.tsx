"use client";

import { CheckCircledIcon, CrossCircledIcon } from "@radix-ui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { EmptyState, ErrorState, LoadingState } from "@/components/case-presenters";
import { EvBars } from "@/components/charts/ev-bars";
import { ConfusionMatrix } from "@/components/charts/heatmap";
import { ChartCard, DataTable, StatTile } from "@/components/charts/primitives";
import { ReliabilityChart } from "@/components/charts/reliability";
import { Badge } from "@/components/ui/badge";
import { ApiError, apiGet } from "@/lib/api";
import { formatMoney, percent } from "@/lib/format";
import { cn } from "@/lib/utils";

const Options = ["FIGHT", "OFFER", "ACCEPT"] as const;
const Metrics = z.object({
  n: z.number(),
  accuracy: z.number(),
  strictAccuracy: z.number(),
  confusion: z.record(z.string(), z.record(z.string(), z.number())),
  brier: z.number().nullable(),
  brierVsWorld: z.number().nullable(),
  realizedCents: z.number(),
  expectedCents: z.number(),
  regretCents: z.number(),
  reliability: z.array(
    z.object({
      from: z.number(),
      to: z.number(),
      n: z.number(),
      meanPredicted: z.number(),
      winRate: z.number(),
    }),
  ),
});
const Report = z.object({
  generatedAt: z.string(),
  cases: z.number(),
  split: z.object({ train: z.array(z.string()), test: z.array(z.string()) }),
  calibration: z.object({ trainLoss: z.object({ before: z.number(), after: z.number() }) }).loose(),
  strategies: z.array(
    z
      .object({
        id: z.string(),
        label: z.string(),
        status: z.string(),
        reason: z.string().optional(),
        all: Metrics.optional(),
        test: Metrics.optional(),
      })
      .loose(),
  ),
  injection: z.array(
    z
      .object({ baseId: z.string(), strategy: z.string(), unchanged: z.boolean(), flagged: z.boolean() })
      .loose(),
  ),
  llm: z.object({ budgetUsd: z.number(), spentUsd: z.number() }).loose(),
});
type Report = z.infer<typeof Report>;

const ABLATION = ["rules-only", "llm-only", "engine", "hybrid"];
const SHORT: Record<string, string> = {
  "always-refund": "Always refund",
  "always-fight": "Always fight",
  "rules-only": "Rules only",
  engine: "Engine (hand)",
  "engine-calibrated": "Engine (calibrated)",
  "llm-only": "Claude only",
  hybrid: "Hybrid",
};

export function EvalReport() {
  const [split, setSplit] = useState<"test" | "all">("test");
  const query = useQuery({ queryKey: ["eval"], queryFn: () => apiGet("eval/report", Report), retry: 0 });
  if (query.isLoading) return <LoadingState label="Loading the eval report" />;
  if (query.error instanceof ApiError && query.error.status === 404)
    return (
      <EmptyState title="No eval report yet">
        Run <code className="mono">pnpm eval</code> to score every strategy on the 60 labelled cases.
      </EmptyState>
    );
  const r = query.data;
  if (!r) return <ErrorState message={query.error?.message ?? "Eval report unavailable"} />;

  const ran = r.strategies.filter((s) => s.status === "ran" && s[split]);
  const metrics = (id: string) => r.strategies.find((s) => s.id === id)?.[split];
  const best = ran.some((s) => s.id === "hybrid")
    ? "hybrid"
    : ran.some((s) => s.id === "engine-calibrated")
      ? "engine-calibrated"
      : "engine";
  const engine = metrics(best);
  const refund = metrics("always-refund");
  const fight = metrics("always-fight");
  const injectionHeld = r.injection.filter((i) => i.unchanged).length;
  const n = engine?.n ?? 0;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {r.cases} labelled cases · train {r.split.train.length} / test {r.split.test.length} · generated{" "}
          {new Date(r.generatedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}
        </p>
        <div aria-label="Split" className="flex rounded-[6px] border border-border p-0.5" role="radiogroup">
          {(["test", "all"] as const).map((s) => (
            <button
              aria-checked={split === s}
              className={cn(
                "min-h-9 rounded-[4px] px-3 text-xs font-semibold",
                split === s ? "bg-accent-soft text-accent-strong" : "text-muted",
              )}
              key={s}
              onClick={() => setSplit(s)}
              role="radio"
              type="button"
            >
              {s === "test" ? "Held-out test split" : "All 60 cases"}
            </button>
          ))}
        </div>
      </div>

      {engine ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatTile
            context={`Correct action on ${Math.round(engine.accuracy * n)} of ${n} ${split === "test" ? "held-out " : ""}cases`}
            hero
            label="Rebuttal decision accuracy"
            value={percent(engine.accuracy)}
          />
          <StatTile
            context={
              refund
                ? `vs ${formatMoney(refund.realizedCents, "USD")} if every dispute were refunded`
                : undefined
            }
            label="Money recovered"
            tone="success"
            value={formatMoney(engine.realizedCents, "USD", { compact: true })}
          />
          <StatTile
            context={
              fight
                ? `Always fighting leaves ${formatMoney(fight.regretCents, "USD", { compact: true })} on the table`
                : undefined
            }
            label="Regret vs the best choice"
            value={formatMoney(engine.regretCents, "USD", { compact: true })}
          />
          <StatTile
            context="Attacks that left the decision unchanged"
            label="Prompt-injection resilience"
            tone={injectionHeld === r.injection.length ? "success" : "danger"}
            value={`${injectionHeld}/${r.injection.length}`}
          />
        </div>
      ) : null}

      <ChartCard
        subtitle="Money each strategy recovers on the same cases, against refunding in full. Highlighted: Rebuttal."
        table={
          <DataTable
            head={["Strategy", "Accuracy", "Recovered", "Regret"]}
            rows={ran.map((s) => [
              s.label,
              percent(s[split]!.accuracy),
              formatMoney(s[split]!.realizedCents, "USD"),
              formatMoney(Math.round(s[split]!.regretCents), "USD"),
            ])}
          />
        }
        title="Baselines vs Rebuttal"
      >
        <EvBars
          bars={ran.map((s) => ({
            key: s.id,
            label: SHORT[s.id] ?? s.label,
            detail: `${s.label}: ${percent(s[split]!.accuracy)} correct, regret ${formatMoney(Math.round(s[split]!.regretCents), "USD")}`,
            cents: s[split]!.realizedCents,
          }))}
          best={best}
          currency="USD"
          labelWidth={150}
        />
      </ChartCard>

      <div className="grid gap-5 xl:grid-cols-2">
        {engine ? (
          <ChartCard
            subtitle="Rows are the labelled best action; columns are what Rebuttal chose. The outlined diagonal is correct."
            title="Confusion matrix"
          >
            <ConfusionMatrix labels={[...Options]} matrix={engine.confusion} />
          </ChartCard>
        ) : null}
        {engine?.reliability.length ? (
          <ChartCard
            subtitle={`Predicted p(win) against how often those cases were won. Brier ${engine.brier?.toFixed(3) ?? "—"}; calibration cut training loss from ${r.calibration.trainLoss.before.toFixed(3)} to ${r.calibration.trainLoss.after.toFixed(3)}.`}
            table={
              <DataTable
                head={["Bin", "Cases", "Predicted", "Won"]}
                rows={engine.reliability.map((b) => [
                  `${Math.round(b.from * 100)}–${Math.round(b.to * 100)}%`,
                  b.n,
                  percent(b.meanPredicted),
                  percent(b.winRate),
                ])}
              />
            }
            title="Reliability"
          >
            <ReliabilityChart bins={engine.reliability} />
          </ChartCard>
        ) : null}
      </div>

      <ChartCard
        subtitle="The design is the hybrid: the EV engine decides; Claude may only nudge p(win) by ±0.10 with cited exhibits."
        title="Ablation"
      >
        <DataTable
          head={["Strategy", "Accuracy", "Strict", "Brier", "Recovered", "Regret"]}
          rows={r.strategies
            .filter((s) => ABLATION.includes(s.id) || s.id === "engine-calibrated")
            .map((s) => {
              const m = s[split];
              return s.status === "ran" && m
                ? [
                    s.label,
                    percent(m.accuracy, 1),
                    percent(m.strictAccuracy, 1),
                    m.brier?.toFixed(3) ?? "—",
                    formatMoney(m.realizedCents, "USD"),
                    formatMoney(Math.round(m.regretCents), "USD"),
                  ]
                : [
                    <span key="l">
                      {s.label} <Badge>not run</Badge>
                    </span>,
                    "—",
                    "—",
                    "—",
                    "—",
                    <span className="font-sans text-muted" key="r">
                      needs ANTHROPIC_API_KEY and pnpm eval --llm
                    </span>,
                  ];
            })}
        />
      </ChartCard>

      <ChartCard
        subtitle="Buyer text rewritten to instruct the assistant (raise p(win), accept, change the amount). The decision must not move."
        title="Prompt-injection set"
      >
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {r.injection.map((i) => (
            <li
              className="flex items-center gap-2 rounded-[6px] border border-border p-3 text-sm"
              key={`${i.baseId}-${i.strategy}`}
            >
              {i.unchanged ? (
                <CheckCircledIcon aria-hidden className="text-success" />
              ) : (
                <CrossCircledIcon aria-hidden className="text-danger" />
              )}
              <span className="mono text-xs">{i.baseId}</span>
              <span className="text-muted">{i.unchanged ? "unchanged" : "changed"}</span>
              {i.flagged ? <Badge tone="warning">flagged</Badge> : null}
            </li>
          ))}
        </ul>
      </ChartCard>
    </div>
  );
}
