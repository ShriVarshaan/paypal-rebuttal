"use client";

import { MagnifyingGlassIcon, ReloadIcon } from "@radix-ui/react-icons";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type ICellRendererParams,
  type RowClickedEvent,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Completeness,
  DeadlineDisplay,
  MoneyDisplay,
  ReasonLabel,
  StateBadge,
} from "@/components/case-presenters";
import { demoCases, type DemoCase } from "@/lib/demo-cases";
import { cn } from "@/lib/utils";

ModuleRegistry.registerModules([AllCommunityModule]);

const gridTheme = themeQuartz.withParams({
  accentColor: "#1f766b",
  backgroundColor: "var(--surface)",
  borderColor: "var(--border)",
  browserColorScheme: "inherit",
  fontFamily: "var(--font-geist-sans)",
  fontSize: 13,
  foregroundColor: "var(--foreground)",
  headerBackgroundColor: "var(--surface-subdued)",
  headerFontSize: 11,
  headerFontWeight: 650,
  headerTextColor: "var(--muted)",
  oddRowBackgroundColor: "var(--surface-subdued)",
  rowBorder: true,
  rowHoverColor: "var(--accent-soft)",
  spacing: 7,
  wrapperBorderRadius: 8,
});

type QuickFilter = "all" | "approval" | "due" | "won" | "lost";

const quickFilters: Array<{ id: QuickFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "approval", label: "Needs approval" },
  { id: "due", label: "Due <24h" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

function Recommendation({ value, pWin }: { value: DemoCase["recommendation"]; pWin: number | null }) {
  if (!value) return <span className="text-xs text-muted">Pending triage</span>;
  const tone = value === "FIGHT" ? "accent" : value === "OFFER" ? "warning" : "neutral";
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Badge tone={tone}>{value}</Badge>
      <span className="mono text-[11px] text-muted">
        pWin {pWin === null ? "—" : `${Math.round(pWin * 100)}%`}
      </span>
    </div>
  );
}

function applyQuickFilter(row: DemoCase, filter: QuickFilter): boolean {
  if (filter === "approval") return row.state === "AWAITING_APPROVAL";
  if (filter === "won") return row.state === "WON";
  if (filter === "lost") return row.state === "LOST";
  if (filter === "due") {
    if (!row.dueAt || row.state === "WON" || row.state === "LOST" || row.state === "REFUNDED") return false;
    return new Date(row.dueAt).getTime() <= Date.now() + 24 * 60 * 60 * 1000;
  }
  return true;
}

export function QueueScaffold() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");

  const rows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return demoCases.filter((row) => {
      const matchesQuickFilter = applyQuickFilter(row, quickFilter);
      const matchesQuery =
        normalized.length === 0 ||
        [row.paypalDisputeId, row.reason, row.buyer, row.stage, row.state]
          .join(" ")
          .toLowerCase()
          .includes(normalized);
      return matchesQuickFilter && matchesQuery;
    });
  }, [query, quickFilter]);

  const columns = useMemo<ColDef<DemoCase>[]>(
    () => [
      {
        headerName: "DUE IN",
        field: "dueAt",
        minWidth: 160,
        flex: 1.15,
        cellRenderer: ({ data }: ICellRendererParams<DemoCase>) =>
          data ? <DeadlineDisplay dueAt={data.dueAt} state={data.state} /> : null,
      },
      {
        headerName: "REASON",
        field: "reason",
        minWidth: 178,
        flex: 1.35,
        cellRenderer: ({ data }: ICellRendererParams<DemoCase>) =>
          data ? <ReasonLabel reason={data.reason} /> : null,
      },
      {
        headerName: "AMOUNT",
        field: "amountCents",
        minWidth: 118,
        flex: 0.85,
        cellRenderer: ({ data }: ICellRendererParams<DemoCase>) =>
          data ? <MoneyDisplay cents={data.amountCents} currency={data.currency} /> : null,
      },
      { headerName: "STAGE", field: "stage", minWidth: 125, flex: 0.85 },
      {
        headerName: "STATE",
        field: "state",
        minWidth: 140,
        flex: 1,
        cellRenderer: ({ data }: ICellRendererParams<DemoCase>) =>
          data ? <StateBadge state={data.state} /> : null,
      },
      {
        headerName: "RECOMMENDATION / PWIN",
        field: "recommendation",
        minWidth: 172,
        flex: 1.2,
        cellRenderer: ({ data }: ICellRendererParams<DemoCase>) =>
          data ? <Recommendation pWin={data.pWin} value={data.recommendation} /> : null,
      },
      {
        headerName: "EVIDENCE",
        field: "evidenceCompleteness",
        minWidth: 145,
        flex: 1,
        cellRenderer: ({ data }: ICellRendererParams<DemoCase>) =>
          data ? <Completeness value={data.evidenceCompleteness} /> : null,
      },
      {
        headerName: "BUYER",
        field: "buyer",
        minWidth: 132,
        flex: 0.9,
        cellClass: "mono",
      },
    ],
    [],
  );

  const openCase = (event: RowClickedEvent<DemoCase>) => {
    if (event.data) router.push(`/cases/${event.data.id}`);
  };

  return (
    <div>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.055em] text-accent-strong">
            Week 1 workspace
          </p>
          <h1 className="mt-2 text-[28px] font-semibold leading-[34px] tracking-[-0.025em] text-foreground-strong">
            Dispute queue
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Active PayPal claims, their deadlines, and the evidence available for a safe response.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span aria-hidden className="size-2 rounded-full bg-success" />
          Temporary synthetic data · API connection on Day 4
        </div>
      </div>

      <div className="mt-7 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Quick filters">
        {quickFilters.map((filter) => {
          const count = demoCases.filter((row) => applyQuickFilter(row, filter.id)).length;
          return (
            <button
              aria-pressed={quickFilter === filter.id}
              className={cn(
                "min-h-11 shrink-0 rounded-[6px] border border-border bg-surface px-3 text-xs font-semibold text-muted outline-none transition-colors hover:border-border-strong hover:text-foreground-strong focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                quickFilter === filter.id && "border-accent/30 bg-accent-soft text-accent-strong",
              )}
              key={filter.id}
              onClick={() => setQuickFilter(filter.id)}
              type="button"
            >
              {filter.label} <span className="mono ml-1">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col gap-3 rounded-[8px] border border-border bg-surface p-3 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search cases</span>
          <MagnifyingGlassIcon
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            className="h-11 w-full rounded-[6px] border border-border bg-surface-subdued pl-10 pr-3 text-sm text-foreground-strong outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search case, reason, stage, or buyer"
            type="search"
            value={query}
          />
        </label>
        <Button onClick={() => setQuery("")} variant="outline">
          <ReloadIcon aria-hidden />
          Reset
        </Button>
      </div>

      <div className="grid-shell mt-4 hidden overflow-hidden rounded-[8px] bg-surface md:block">
        <AgGridReact<DemoCase>
          animateRows={false}
          columnDefs={columns}
          defaultColDef={{ sortable: true, resizable: true, suppressHeaderMenuButton: true }}
          domLayout="autoHeight"
          getRowId={({ data }) => data.id}
          headerHeight={46}
          onRowClicked={openCase}
          pagination
          paginationPageSize={50}
          rowData={rows}
          rowHeight={72}
          suppressCellFocus={false}
          theme={gridTheme}
        />
      </div>

      <div className="mt-4 space-y-3 md:hidden">
        {rows.map((row) => (
          <button
            className="w-full rounded-[8px] border border-border bg-surface p-4 text-left outline-none transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            key={row.id}
            onClick={() => router.push(`/cases/${row.id}`)}
            type="button"
          >
            <div className="flex items-start justify-between gap-4">
              <DeadlineDisplay dueAt={row.dueAt} state={row.state} />
              <MoneyDisplay cents={row.amountCents} currency={row.currency} />
            </div>
            <div className="mt-4">
              <ReasonLabel reason={row.reason} />
              <p className="mono mt-1 text-[11px] text-muted">{row.paypalDisputeId}</p>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <StateBadge state={row.state} />
              {row.recommendation && (
                <Badge tone={row.recommendation === "FIGHT" ? "accent" : "warning"}>
                  {row.recommendation}
                </Badge>
              )}
              <span className="mono text-[11px] text-muted">
                pWin {row.pWin === null ? "—" : `${Math.round(row.pWin * 100)}%`}
              </span>
            </div>
            <div className="mt-4">
              <Completeness value={row.evidenceCompleteness} />
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-muted">
              <span>{row.buyer}</span>
              <span>{row.stage.replaceAll("_", " ").toLowerCase()}</span>
            </div>
          </button>
        ))}
        {rows.length === 0 && (
          <div className="rounded-[8px] border border-dashed border-border-strong bg-surface-subdued p-8 text-center text-sm text-muted">
            No synthetic cases match these controls.
          </div>
        )}
      </div>
    </div>
  );
}
