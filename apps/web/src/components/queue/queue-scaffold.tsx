"use client";

import { CaseQueueItem, type CaseQueueItem as CaseQueueRow } from "@rebuttal/core";
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
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Completeness,
  DeadlineDisplay,
  ErrorState,
  LoadingState,
  MoneyDisplay,
  ReasonLabel,
  StateBadge,
} from "@/components/case-presenters";
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
type Sort = "dueAt:asc" | "dueAt:desc" | "amount:asc" | "amount:desc" | "createdAt:asc" | "createdAt:desc";

const quickFilters: Array<{ id: QuickFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "approval", label: "Needs approval" },
  { id: "due", label: "Due <24h" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

interface QueueResponse {
  rows: CaseQueueRow[];
  total: number;
}

async function fetchCases(search: string): Promise<QueueResponse> {
  const response = await fetch(`/api/rebuttal/cases${search ? `?${search}` : ""}`, { cache: "no-store" });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof body === "object" && body && "error" in body
        ? String(body.error)
        : `Request failed (${response.status})`,
    );
  return {
    rows: CaseQueueItem.array().parse(body),
    total: Number(response.headers.get("x-total-count") ?? 0),
  };
}

function Recommendation({ row }: { row: CaseQueueRow }) {
  const decision = row.latestDecision;
  const option = decision?.option;
  if (!option) return <span className="text-xs text-muted">Pending triage</span>;
  const tone = option === "FIGHT" ? "accent" : option === "OFFER" ? "warning" : "neutral";
  return (
    <div className="flex flex-col items-start gap-1.5">
      <Badge tone={tone}>{option}</Badge>
      <span className="mono text-[11px] text-muted">
        pWin {decision.pWin === null ? "—" : `${Math.round(decision.pWin * 100)}%`}
      </span>
    </div>
  );
}

export function QueueScaffold() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const query = searchParams.get("q") ?? "";
  const quickFilter = (searchParams.get("filter") as QuickFilter | null) ?? "all";
  const sort = (searchParams.get("sort") as Sort | null) ?? "dueAt:asc";
  const skip = Number(searchParams.get("skip") ?? 0) || 0;

  const params = useMemo(() => {
    const value = new URLSearchParams({ take: "50", skip: String(skip), sort });
    if (query.trim()) value.set("q", query.trim());
    if (quickFilter === "approval") value.set("needsApproval", "true");
    if (quickFilter === "due") value.set("dueWithinHours", "24");
    if (quickFilter === "won" || quickFilter === "lost") value.set("state", quickFilter.toUpperCase());
    return value.toString();
  }, [query, quickFilter, skip, sort]);

  const { data, error, isFetching, isLoading, refetch } = useQuery({
    queryKey: ["cases", params],
    queryFn: () => fetchCases(params),
    placeholderData: (previous) => previous,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  const setUrl = useCallback(
    (changes: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const selectQuickFilter = (filter: QuickFilter) =>
    setUrl({ filter: filter === "all" ? null : filter, skip: null });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const page = Math.floor(skip / 50) + 1;
  const pageCount = Math.max(1, Math.ceil(total / 50));

  const columns = useMemo<ColDef<CaseQueueRow>[]>(
    () => [
      {
        headerName: "DUE IN",
        field: "sellerResponseDueAt",
        minWidth: 160,
        flex: 1.15,
        cellRenderer: ({ data }: ICellRendererParams<CaseQueueRow>) =>
          data ? <DeadlineDisplay dueAt={data.sellerResponseDueAt} state={data.state} now={now} /> : null,
      },
      {
        headerName: "REASON",
        field: "reason",
        minWidth: 178,
        flex: 1.35,
        cellRenderer: ({ data }: ICellRendererParams<CaseQueueRow>) =>
          data ? <ReasonLabel reason={data.reason} /> : null,
      },
      {
        headerName: "AMOUNT",
        field: "amountCents",
        minWidth: 118,
        flex: 0.85,
        cellRenderer: ({ data }: ICellRendererParams<CaseQueueRow>) =>
          data ? <MoneyDisplay cents={data.amountCents} currency={data.currency} /> : null,
      },
      { headerName: "STAGE", field: "stage", minWidth: 125, flex: 0.85 },
      {
        headerName: "STATE",
        field: "state",
        minWidth: 140,
        flex: 1,
        cellRenderer: ({ data }: ICellRendererParams<CaseQueueRow>) =>
          data ? <StateBadge state={data.state} /> : null,
      },
      {
        headerName: "RECOMMENDATION / PWIN",
        field: "latestDecision",
        minWidth: 172,
        flex: 1.2,
        cellRenderer: ({ data }: ICellRendererParams<CaseQueueRow>) =>
          data ? <Recommendation row={data} /> : null,
      },
      {
        headerName: "EVIDENCE",
        field: "completeness",
        minWidth: 145,
        flex: 1,
        cellRenderer: ({ data }: ICellRendererParams<CaseQueueRow>) =>
          data ? <Completeness value={Math.round(data.completeness.score * 100)} /> : null,
      },
      { headerName: "BUYER", field: "buyerPseudonym", minWidth: 132, flex: 0.9, cellClass: "mono" },
    ],
    [now],
  );

  if (isLoading) return <LoadingState label="Loading dispute queue" />;

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
          {isFetching ? "Refreshing live cases" : `${total} cases · API connected`}
        </div>
      </div>

      <div className="mt-7 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Quick filters">
        {quickFilters.map((filter) => (
          <button
            aria-pressed={quickFilter === filter.id}
            className={cn(
              "min-h-11 shrink-0 rounded-[6px] border border-border bg-surface px-3 text-xs font-semibold text-muted outline-none transition-colors hover:border-border-strong hover:text-foreground-strong focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
              quickFilter === filter.id && "border-accent/30 bg-accent-soft text-accent-strong",
            )}
            key={filter.id}
            onClick={() => selectQuickFilter(filter.id)}
            type="button"
          >
            {filter.label}
          </button>
        ))}
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
            onChange={(event) => setUrl({ q: event.target.value, skip: null })}
            placeholder="Search case, dispute, invoice, or transaction"
            type="search"
            value={query}
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-xs text-muted">
          <span>Sort</span>
          <select
            aria-label="Sort cases"
            className="h-11 rounded-[6px] border border-border bg-surface-subdued px-2 text-foreground-strong"
            onChange={(event) => setUrl({ sort: event.target.value, skip: null })}
            value={sort}
          >
            <option value="dueAt:asc">Due soonest</option>
            <option value="dueAt:desc">Due latest</option>
            <option value="amount:desc">Amount high</option>
            <option value="amount:asc">Amount low</option>
            <option value="createdAt:desc">Newest</option>
            <option value="createdAt:asc">Oldest</option>
          </select>
        </label>
        <Button
          onClick={() => {
            setUrl({ q: null, filter: null, sort: null, skip: null });
            setNow(Date.now());
          }}
          variant="outline"
        >
          <ReloadIcon aria-hidden />
          Reset
        </Button>
      </div>

      {error ? (
        <div className="mt-4">
          <ErrorState message={error.message} />
          <Button className="mt-3" onClick={() => void refetch()} variant="outline">
            Retry
          </Button>
        </div>
      ) : null}
      {!error ? (
        <>
          <div className="grid-shell mt-4 hidden overflow-hidden rounded-[8px] bg-surface md:block">
            <AgGridReact<CaseQueueRow>
              animateRows={false}
              columnDefs={columns}
              defaultColDef={{ sortable: false, resizable: true, suppressHeaderMenuButton: true }}
              domLayout="autoHeight"
              getRowId={({ data }) => data.id}
              headerHeight={46}
              onRowClicked={(event: RowClickedEvent<CaseQueueRow>) =>
                event.data && router.push(`/cases/${event.data.id}`)
              }
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
                  <DeadlineDisplay dueAt={row.sellerResponseDueAt} state={row.state} now={now} />
                  <MoneyDisplay cents={row.amountCents} currency={row.currency} />
                </div>
                <div className="mt-4">
                  <ReasonLabel reason={row.reason} />
                  <p className="mono mt-1 text-[11px] text-muted">{row.paypalDisputeId}</p>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <StateBadge state={row.state} />
                  <Recommendation row={row} />
                </div>
                <div className="mt-4">
                  <Completeness value={Math.round(row.completeness.score * 100)} />
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-muted">
                  <span>{row.buyerPseudonym ?? "Buyer unknown"}</span>
                  <span>{row.stage.replaceAll("_", " ").toLowerCase()}</span>
                </div>
              </button>
            ))}
            {rows.length === 0 ? (
              <div className="rounded-[8px] border border-dashed border-border-strong bg-surface-subdued p-8 text-center text-sm text-muted">
                No cases match these controls.
              </div>
            ) : null}
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-muted">
            <span>
              Page {page} of {pageCount} · {total} total
            </span>
            <div className="flex gap-2">
              <Button
                disabled={skip === 0}
                onClick={() => setUrl({ skip: String(Math.max(0, skip - 50)) })}
                variant="outline"
              >
                Previous
              </Button>
              <Button
                disabled={skip + 50 >= total}
                onClick={() => setUrl({ skip: String(skip + 50) })}
                variant="outline"
              >
                Next
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
