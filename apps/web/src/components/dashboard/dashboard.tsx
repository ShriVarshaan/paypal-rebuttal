"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ErrorState } from "@/components/case-presenters";
import { LineChart } from "@/components/charts/line-chart";
import { ChartCard, DataTable, StatTile } from "@/components/charts/primitives";
import { StackedBars } from "@/components/charts/stacked-bars";
import { apiGet } from "@/lib/api";
import { formatMoney, percent } from "@/lib/format";

const Summary = z.object({
  generatedAt: z.string(),
  currency: z.string(),
  recoveredCents: z.number(),
  recovered30dCents: z.number(),
  refundAllPaidOutCents: z.number(),
  paidOutCents: z.number(),
  winRate: z.number().nullable(),
  fought: z.number(),
  won: z.number(),
  casesTotal: z.number(),
  demoCases: z.number().default(0),
  casesResolved: z.number(),
  casesOpen: z.number(),
  responded: z.number(),
  medianHoursToRespond: z.number().nullable(),
  deadlinesMissed: z.number(),
  claudeCostUsd: z.number(),
  claudeCostPerCaseUsd: z.number().nullable(),
  disputeRateTrend: z.array(
    z.object({
      weekStart: z.string(),
      disputes: z.number(),
      orders: z.number(),
      rate: z.number().nullable(),
    }),
  ),
  outcomesByReason: z.array(
    z.object({
      reason: z.string(),
      won: z.number(),
      lost: z.number(),
      refunded: z.number(),
      open: z.number(),
    }),
  ),
  cumulative: z.array(z.object({ at: z.string(), paidOutCents: z.number(), refundAllCents: z.number() })),
});

const REASON: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  UNAUTHORISED: "Unauthorised",
  DUPLICATE_TRANSACTION: "Duplicate",
  CREDIT_NOT_PROCESSED: "Credit not processed",
  CANCELED_RECURRING_BILLING: "Recurring billing",
  INCORRECT_AMOUNT: "Incorrect amount",
};
const OUTCOMES = [
  { key: "won", label: "Won", color: "var(--success)" },
  { key: "lost", label: "Lost", color: "var(--danger)" },
  { key: "refunded", label: "Refunded / settled", color: "var(--muted)" },
  { key: "open", label: "Open", color: "var(--border-strong)" },
];
const PAYPAL_REVIEW_RATE = 0.01;

const week = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const usd = (cents: number) => formatMoney(cents, "USD", { compact: true });
const hours = (h: number | null) =>
  h == null
    ? "—"
    : h < 1
      ? `${Math.round(h * 60)} min`
      : h < 48
        ? `${h.toFixed(1)} h`
        : `${(h / 24).toFixed(1)} days`;

function Skeleton() {
  return (
    <div aria-busy className="grid animate-pulse gap-4 motion-reduce:animate-none" role="status">
      <span className="sr-only">Loading dashboard</span>
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div className="h-28 rounded-[8px] bg-surface" key={i} />
        ))}
      </div>
      <div className="h-72 rounded-[8px] bg-surface" />
    </div>
  );
}

export function Dashboard() {
  const query = useQuery({
    queryKey: ["metrics", "summary"],
    queryFn: () => apiGet("metrics/summary", Summary),
    refetchInterval: 60_000,
  });
  if (query.isLoading) return <Skeleton />;
  const m = query.data;
  if (!m) return <ErrorState message={query.error?.message ?? "Metrics unavailable"} />;

  const hasOrders = m.disputeRateTrend.some((w) => w.orders > 0);
  const saved = m.refundAllPaidOutCents - m.paidOutCents;

  return (
    <div className="grid gap-5">
      {query.error ? (
        <ErrorState message={`${query.error.message}. Showing the last numbers received.`} />
      ) : null}
      {m.demoCases ? (
        <p
          className="rounded-[6px] border border-warning/25 bg-warning-soft px-4 py-2.5 text-sm text-foreground-strong"
          role="note"
        >
          Includes {m.demoCases} synthetic demo case{m.demoCases === 1 ? "" : "s"} (DEMO-…) seeded for this
          walkthrough.
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="md:col-span-2">
          <StatTile
            context={
              m.casesResolved
                ? `Paid out ${usd(m.paidOutCents)} instead of ${usd(m.refundAllPaidOutCents)} if every dispute had been refunded.`
                : "No disputes resolved yet."
            }
            hero
            label="Money recovered, all time"
            tone={saved > 0 ? "success" : undefined}
            value={usd(m.recoveredCents)}
          />
        </div>
        <StatTile
          context="Resolved in the last 30 days"
          label="Recovered, 30 days"
          value={usd(m.recovered30dCents)}
        />
        <StatTile
          context={
            m.fought
              ? `${m.won} of ${m.fought} disputes fought with evidence`
              : "No fought disputes resolved yet"
          }
          label="Win rate"
          value={m.winRate == null ? "—" : percent(m.winRate)}
        />
        <StatTile
          context={`${m.casesResolved} resolved · ${m.casesOpen} open`}
          label="Cases handled"
          value={m.casesTotal}
        />
        <StatTile
          context={`Across ${m.responded} responses filed`}
          label="Median time to respond"
          value={hours(m.medianHoursToRespond)}
        />
        <StatTile
          context={
            m.deadlinesMissed
              ? "Response deadlines that passed unanswered"
              : "Every deadline answered in time"
          }
          label="Deadlines missed"
          tone={m.deadlinesMissed ? "danger" : "success"}
          value={m.deadlinesMissed}
        />
        <StatTile
          context={
            m.claudeCostUsd
              ? `$${m.claudeCostUsd.toFixed(2)} total on Claude reviews`
              : "Running on deterministic templates"
          }
          label="Claude cost per case"
          value={m.claudeCostPerCaseUsd == null ? "$0.00" : `$${m.claudeCostPerCaseUsd.toFixed(3)}`}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard
          subtitle={
            hasOrders
              ? "Disputes opened per store order, by week. PayPal starts reviewing accounts around 1%."
              : "Disputes opened per week. Connect the store to see the rate per order."
          }
          table={
            <DataTable
              head={["Week of", "Disputes", "Orders", "Rate"]}
              rows={m.disputeRateTrend.map((w) => [
                week(w.weekStart),
                w.disputes,
                w.orders,
                w.rate == null ? "—" : percent(w.rate, 1),
              ])}
            />
          }
          title="Dispute rate"
        >
          <LineChart
            format={(v) => (hasOrders ? percent(v, 1) : String(Math.round(v)))}
            reference={hasOrders ? { value: PAYPAL_REVIEW_RATE, label: "Review 1%" } : undefined}
            series={[
              {
                key: "rate",
                label: hasOrders ? "Dispute rate" : "Disputes",
                color: "var(--accent)",
                values: m.disputeRateTrend.map((w) => (hasOrders ? w.rate : w.disputes)),
              },
            ]}
            xLabels={m.disputeRateTrend.map((w) => week(w.weekStart))}
          />
        </ChartCard>

        <ChartCard
          legend={[
            { label: "With Rebuttal", color: "var(--accent)", shape: "line" },
            { label: "If you refunded everything", color: "var(--muted)", shape: "line" },
          ]}
          subtitle="Cumulative money paid to buyers on resolved disputes. The gap is what Rebuttal recovered."
          table={
            <DataTable
              head={["Resolved", "With Rebuttal", "Refund everything"]}
              rows={m.cumulative.map((c) => [
                new Date(c.at).toLocaleDateString("en-US"),
                usd(c.paidOutCents),
                usd(c.refundAllCents),
              ])}
            />
          }
          title="Paid out vs refunding everything"
        >
          {m.cumulative.length ? (
            <LineChart
              format={(v) => usd(v)}
              series={[
                {
                  key: "refund",
                  label: "Refund everything",
                  color: "var(--muted)",
                  values: [0, ...m.cumulative.map((c) => c.refundAllCents)],
                },
                {
                  key: "actual",
                  label: "With Rebuttal",
                  color: "var(--accent)",
                  values: [0, ...m.cumulative.map((c) => c.paidOutCents)],
                },
              ]}
              step
              xLabels={[
                "Start",
                ...m.cumulative.map((c) =>
                  new Date(c.at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                ),
              ]}
            />
          ) : (
            <p className="py-16 text-center text-sm text-muted">This fills in as PayPal resolves disputes.</p>
          )}
        </ChartCard>
      </div>

      <ChartCard
        legend={OUTCOMES.map((o) => ({ label: o.label, color: o.color }))}
        subtitle="How each kind of dispute ended. Counts include open cases."
        table={
          <DataTable
            head={["Reason", "Won", "Lost", "Refunded", "Open"]}
            rows={m.outcomesByReason.map((r) => [
              REASON[r.reason] ?? r.reason,
              r.won,
              r.lost,
              r.refunded,
              r.open,
            ])}
          />
        }
        title="Outcomes by reason"
      >
        {m.outcomesByReason.length ? (
          <StackedBars
            rows={m.outcomesByReason.map(({ reason, ...values }) => ({
              label: REASON[reason] ?? reason,
              values,
            }))}
            segments={OUTCOMES}
          />
        ) : (
          <p className="py-10 text-center text-sm text-muted">No disputes yet.</p>
        )}
      </ChartCard>
      <p className="text-xs text-muted">
        Updated {new Date(m.generatedAt).toLocaleTimeString("en-US")}. Amounts in USD; other currencies are
        counted but not summed.
      </p>
    </div>
  );
}
