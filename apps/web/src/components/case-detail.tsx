"use client";

import { CaseDetail, type CaseDetail as CaseDetailValue } from "@rebuttal/core";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ChevronLeftIcon } from "@radix-ui/react-icons";
import { Badge } from "@/components/ui/badge";
import {
  Completeness,
  ErrorState,
  LoadingState,
  MoneyDisplay,
  ReasonLabel,
  StateBadge,
} from "@/components/case-presenters";

async function fetchCase(id: string): Promise<CaseDetailValue> {
  const response = await fetch(`/api/rebuttal/cases/${encodeURIComponent(id)}`, { cache: "no-store" });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof body === "object" && body && "error" in body
        ? String(body.error)
        : `Request failed (${response.status})`,
    );
  return CaseDetail.parse(body);
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return "Undated";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Undated"
    : date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

function timeline(caseValue: CaseDetailValue) {
  const messages = caseValue.messages.map((message, index) => ({
    key: `message-${message.postedBy}-${message.postedAt ?? "undated"}-${message.content}-${index}`,
    at: message.postedAt,
    label: `PayPal message · ${message.postedBy}`,
    text: message.content,
  }));
  const events = caseValue.events.map((event) => ({
    key: `event-${event.id}`,
    at: typeof event.createdAt === "string" ? event.createdAt : null,
    label: `Case event · ${event.type}`,
    text: typeof event.payload === "string" ? event.payload : JSON.stringify(event.payload),
  }));
  const seen = new Set<string>();
  return [...messages, ...events]
    .filter((item) => {
      const key = `${item.label}|${item.at}|${item.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => {
      if (!left.at && right.at) return 1;
      if (left.at && !right.at) return -1;
      return (
        (left.at ? Date.parse(left.at) : Number.MAX_SAFE_INTEGER) -
        (right.at ? Date.parse(right.at) : Number.MAX_SAFE_INTEGER)
      );
    });
}

function ContextPanel({ value }: { value: CaseDetailValue }) {
  const transaction = value.transactionContext;
  return (
    <section className="rounded-[8px] border border-border bg-surface p-5">
      <p className="text-[11px] font-bold uppercase tracking-[0.055em] text-accent-strong">Dispute context</p>
      <div className="mt-4 grid gap-4 text-sm">
        <div>
          <p className="text-muted">Reason</p>
          <ReasonLabel reason={value.reason} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-muted">Stage</p>
            <p className="mt-1 font-medium">{value.stage}</p>
          </div>
          <div>
            <p className="text-muted">State</p>
            <div className="mt-1">
              <StateBadge state={value.state} />
            </div>
          </div>
        </div>
        <div>
          <p className="text-muted">Claim amount</p>
          <p className="mt-1">
            <MoneyDisplay cents={value.amountCents} currency={value.currency} />
          </p>
        </div>
        <div>
          <p className="text-muted">PayPal status</p>
          <p className="mt-1">
            {value.status} · {value.disputeState ?? "state unavailable"}
          </p>
        </div>
        <div>
          <p className="text-muted">Created</p>
          <p className="mono mt-1 text-xs">{dateLabel(value.paypalCreatedAt)}</p>
        </div>
      </div>
      <div className="mt-6 border-t border-border pt-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.055em] text-muted">Transaction and order</p>
        {transaction?.order ? (
          <div className="mt-3 grid gap-3 text-sm">
            <p>
              <span className="text-muted">Order:</span> <span className="mono">{transaction.order.id}</span>
            </p>
            <p>
              <span className="text-muted">Order status:</span> {transaction.order.status}
            </p>
            <div>
              <p className="text-muted">Items</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {transaction.order.items.map((item, index) => (
                  <li key={`${item.sku ?? item.name}-${index}`}>
                    {item.name} · {item.quantity}
                  </li>
                ))}
              </ul>
            </div>
            <p>
              <span className="text-muted">Tracking:</span>{" "}
              {transaction.order.trackingNumbers.length
                ? transaction.order.trackingNumbers
                    .map((tracking) => `${tracking.trackingNumber} (${tracking.status ?? "unknown"})`)
                    .join(", ")
                : "None recorded"}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">Order context is not available yet.</p>
        )}
      </div>
    </section>
  );
}

export function CaseDetailView({ id }: { id: string }) {
  const query = useQuery({ queryKey: ["case", id], queryFn: () => fetchCase(id), refetchInterval: 10_000 });
  if (query.isLoading) return <LoadingState label="Loading case detail" />;
  if (query.error) return <ErrorState message={query.error.message} />;
  const value = query.data;
  if (!value) return <ErrorState message="Case was not returned by the API." />;
  const events = timeline(value);
  const evidenceById = new Map(value.evidence.map((item) => [item.id, item]));
  return (
    <div className="mx-auto max-w-[1500px]">
      <Link
        className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent-strong outline-none focus-visible:ring-2 focus-visible:ring-accent"
        href="/queue"
      >
        <ChevronLeftIcon aria-hidden />
        Back to queue
      </Link>
      <div className="mt-5 flex flex-col gap-4 border-b border-border pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mono text-xs text-muted">{value.paypalDisputeId}</p>
          <h1 className="mt-2 text-[28px] font-semibold leading-[34px] tracking-[-0.025em] text-foreground-strong">
            Case detail
          </h1>
          <p className="mt-2 text-sm text-muted">
            {value.buyerPseudonym ?? "Buyer identity unavailable"} · {dateLabel(value.sellerResponseDueAt)}{" "}
            deadline
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StateBadge state={value.state} />
          <span className="text-xs text-muted">{query.isFetching ? "Refreshing" : "Live API"}</span>
        </div>
      </div>
      <div className="mt-7 grid gap-5 xl:grid-cols-3">
        <ContextPanel value={value} />
        <section className="rounded-[8px] border border-border bg-surface p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.055em] text-accent-strong">Timeline</p>
          <div className="mt-5 space-y-5">
            {events.length ? (
              events.map((event) => (
                <article className="border-l-2 border-border pl-4" key={event.key}>
                  <p className="mono text-[11px] text-muted">{dateLabel(event.at)}</p>
                  <p className="mt-1 text-xs font-semibold text-foreground-strong">{event.label}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{event.text}</p>
                </article>
              ))
            ) : (
              <p className="text-sm text-muted">No timeline events have been recorded.</p>
            )}
          </div>
        </section>
        <section className="rounded-[8px] border border-border bg-surface p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.055em] text-accent-strong">
                Evidence checklist
              </p>
              <p className="mt-2 text-sm text-muted">
                Matrix-backed completeness; weak evidence is not partial credit.
              </p>
            </div>
            <span className="mono text-sm font-semibold">{Math.round(value.checklist.score * 100)}%</span>
          </div>
          <div className="mt-4">
            <Completeness value={Math.round(value.checklist.score * 100)} />
          </div>
          <div className="mt-5 space-y-3">
            {value.checklist.items.map((item) => (
              <div className="rounded-[6px] border border-border p-3" key={item.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{item.label}</p>
                    <p className="mt-1 text-xs text-muted">
                      {item.level} · {item.kind}
                    </p>
                  </div>
                  <Badge
                    tone={
                      item.status === "found" ? "success" : item.status === "weak" ? "warning" : "neutral"
                    }
                  >
                    {item.status}
                  </Badge>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted">{item.hint}</p>
                {item.evidenceIds.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.evidenceIds.map((evidenceId) => {
                      const evidence = evidenceById.get(evidenceId);
                      return evidence ? (
                        <Link
                          className="text-xs font-semibold text-accent-strong underline"
                          href={
                            evidence.hasFile
                              ? `/api/rebuttal/cases/${encodeURIComponent(value.id)}/evidence/${encodeURIComponent(evidence.id)}/file`
                              : `#evidence-${evidence.id}`
                          }
                          key={evidence.id}
                        >
                          {item.exhibitIds.join(", ") || evidence.title}
                        </Link>
                      ) : null;
                    })}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="mt-6 border-t border-border pt-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.055em] text-muted">Evidence preview</p>
            {value.evidence.length ? (
              <div className="mt-3 space-y-2">
                {value.evidence.map((item) => (
                  <div
                    className="rounded-[6px] bg-surface-subdued p-3"
                    id={`evidence-${item.id}`}
                    key={item.id}
                  >
                    <p className="text-xs font-semibold">{item.title}</p>
                    <p className="mt-1 text-xs text-muted">
                      {item.hasFile ? "File available" : "Structured evidence only · screenshot unavailable"}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">No evidence has been collected yet.</p>
            )}
          </div>
        </section>
      </div>
      <section className="mt-5 rounded-[8px] border border-dashed border-border-strong bg-surface-subdued p-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.055em] text-muted">
          Decision actions · Week 2
        </p>
        <p className="mt-2 text-sm text-muted">
          Decision editing, approval controls, and filing remain intentionally outside this Week 1 UI.
        </p>
        {value.actions.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {value.actions.map((action) => (
              <span
                className="rounded-[6px] border border-border bg-surface px-3 py-2 text-xs"
                key={action.id}
              >
                {action.kind} · {action.status}
                {action.debugId ? ` · ${action.debugId}` : ""}
              </span>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
