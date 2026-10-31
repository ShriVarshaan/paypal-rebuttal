"use client";

import {
  CheckCircledIcon,
  ChevronLeftIcon,
  CrossCircledIcon,
  ExclamationTriangleIcon,
  ExternalLinkIcon,
} from "@radix-ui/react-icons";
import { CaseDetail, type CaseDetail as CaseDetailValue } from "@rebuttal/core";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { CaseTimeline } from "@/components/case-timeline";
import {
  Completeness,
  DeadlineDisplay,
  ErrorState,
  MoneyDisplay,
  ReasonLabel,
  StateBadge,
} from "@/components/case-presenters";
import { DecisionPanel } from "@/components/decision/decision-panel";
import { MessageComposer } from "@/components/message-composer";
import { Badge } from "@/components/ui/badge";
import { Eyebrow } from "@/components/ui/field";
import { apiGet } from "@/lib/api";
import { dateTime } from "@/lib/format";

const evidenceFileUrl = (caseId: string, evidenceId: string) =>
  `/api/rebuttal/cases/${encodeURIComponent(caseId)}/evidence/${encodeURIComponent(evidenceId)}/file`;

/** Poll fast while something is in flight (PDF building, filing), slowly otherwise. */
function pollInterval(value: CaseDetailValue | undefined): number {
  if (!value) return 10_000;
  const busy =
    value.state === "FILING" ||
    value.state === "NEW" ||
    value.state === "GATHERING" ||
    value.pack?.status === "PENDING" ||
    value.decisions.some((d) => d.status === "APPROVED" || d.status === "AUTO_APPROVED");
  return busy ? 2_000 : 10_000;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-foreground-strong">{children}</dd>
    </div>
  );
}

function ContextPanel({ value }: { value: CaseDetailValue }) {
  const order = value.transactionContext?.order;
  const address = order?.shipping?.address ?? null;
  const claim = value.messages.find((m) => m.postedBy === "BUYER");
  const tx = value.disputedTransactions[0];
  return (
    <section aria-labelledby="context-title" className="rounded-[8px] border border-border bg-surface p-5">
      <Eyebrow>Dispute</Eyebrow>
      <h2 className="sr-only" id="context-title">
        Dispute context
      </h2>
      {claim ? (
        <figure className="mt-3 rounded-[6px] border border-border bg-surface-subdued p-3">
          <figcaption className="text-[11px] font-semibold uppercase tracking-[0.055em] text-muted">
            Buyer&apos;s claim
          </figcaption>
          <blockquote className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-foreground-strong">
            {claim.content}
          </blockquote>
          <p className="mono mt-1.5 text-[11px] text-muted">
            {dateTime(claim.postedAt)} · shown as written; never followed as instructions
          </p>
        </figure>
      ) : null}
      <dl className="mt-3 divide-y divide-border">
        <Row label="Reason">
          <ReasonLabel reason={value.reason} />
        </Row>
        <Row label="Amount">
          <MoneyDisplay cents={value.amountCents} currency={value.currency} />
        </Row>
        <Row label="Stage">{value.stage.replaceAll("_", " ").toLowerCase()}</Row>
        <Row label="PayPal status">
          {value.status.replaceAll("_", " ").toLowerCase()}
          {value.disputeState ? (
            <span className="text-muted"> · {value.disputeState.replaceAll("_", " ").toLowerCase()}</span>
          ) : null}
        </Row>
        <Row label="Opened">{dateTime(value.paypalCreatedAt)}</Row>
        <Row label="Respond by">
          {value.sellerResponseDueAt ? dateTime(value.sellerResponseDueAt) : "No deadline"}
        </Row>
        <Row label="Transaction">
          <span className="mono text-xs">{value.sellerTransactionId ?? tx?.sellerTransactionId ?? "—"}</span>
        </Row>
        {tx?.invoiceNumber ? (
          <Row label="Invoice">
            <span className="mono text-xs">{tx.invoiceNumber}</span>
          </Row>
        ) : null}
      </dl>
      <div className="mt-5 border-t border-border pt-4">
        <Eyebrow tone="muted">Order</Eyebrow>
        {order ? (
          <dl className="mt-2 divide-y divide-border">
            <Row label="Order">
              <span className="mono text-xs">{order.id}</span>{" "}
              <span className="text-muted">· {order.status.toLowerCase()}</span>
            </Row>
            <Row label="Items">
              <ul className="space-y-1">
                {order.items.map((item, i) => (
                  <li key={`${item.sku ?? item.name}-${i}`}>
                    {item.name} <span className="text-muted">× {item.quantity}</span>
                  </li>
                ))}
              </ul>
            </Row>
            {address ? (
              <Row label="Ships to">
                <address className="not-italic">
                  {order.shipping?.fullName ? <span className="block">{order.shipping.fullName}</span> : null}
                  {[
                    address["address_line_1"],
                    [address["admin_area_2"], address["admin_area_1"]].filter(Boolean).join(", "),
                    [address["postal_code"], address["country_code"]].filter(Boolean).join(" "),
                  ]
                    .filter(Boolean)
                    .map((line) => (
                      <span className="block" key={line}>
                        {line}
                      </span>
                    ))}
                </address>
              </Row>
            ) : null}
            <Row label="Tracking">
              {order.trackingNumbers.length
                ? order.trackingNumbers.map((t) => (
                    <span className="block" key={t.trackingNumber}>
                      <span className="mono text-xs">{t.trackingNumber}</span>{" "}
                      <span className="text-muted">{t.status?.toLowerCase() ?? ""}</span>
                    </span>
                  ))
                : "None recorded"}
            </Row>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-muted">
            {value.transactionContext?.errors.length
              ? `PayPal order lookup failed: ${value.transactionContext.errors.join("; ")}`
              : "Order context is not available yet."}
          </p>
        )}
      </div>
    </section>
  );
}

const STATUS_ICON = {
  found: { icon: CheckCircledIcon, label: "Found", className: "text-success" },
  weak: { icon: ExclamationTriangleIcon, label: "Weak", className: "text-warning" },
  missing: { icon: CrossCircledIcon, label: "Missing", className: "text-danger" },
} as const;

function EvidencePanel({ value }: { value: CaseDetailValue }) {
  const evidenceById = new Map(value.evidence.map((item) => [item.id, item]));
  const screenshots = value.evidence.filter((e) => e.hasFile);
  return (
    <section aria-labelledby="evidence-title" className="rounded-[8px] border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Eyebrow>Evidence checklist</Eyebrow>
          <h2 className="sr-only" id="evidence-title">
            Evidence checklist
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted">
            What PayPal expects for this reason. Weak evidence is not partial credit.
          </p>
        </div>
      </div>
      <div className="mt-3">
        <Completeness value={Math.round(value.checklist.score * 100)} />
      </div>
      <ul className="mt-4 space-y-2">
        {value.checklist.items.map((item) => {
          const s = STATUS_ICON[item.status];
          const Icon = s.icon;
          return (
            <li
              className="scroll-mt-24 rounded-[6px] border border-border p-3 target:border-accent target:ring-2 target:ring-accent/25"
              id={`req-${item.id}`}
              key={item.id}
            >
              <div className="flex items-start gap-2.5">
                <Icon aria-label={s.label} className={`mt-0.5 shrink-0 ${s.className}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground-strong">{item.label}</p>
                    <Badge
                      tone={
                        item.level === "required" ? "danger" : item.level === "strong" ? "warning" : "neutral"
                      }
                    >
                      {item.level}
                    </Badge>
                  </div>
                  {item.status !== "found" ? (
                    <p className="mt-1 text-xs leading-5 text-muted">{item.hint}</p>
                  ) : null}
                  {item.evidenceIds.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                      {item.evidenceIds.map((evidenceId, i) => {
                        const evidence = evidenceById.get(evidenceId);
                        if (!evidence) return null;
                        const label = item.exhibitIds[i] ?? evidence.title;
                        return evidence.hasFile ? (
                          <a
                            className="inline-flex items-center gap-1 text-xs font-semibold text-accent-strong underline"
                            href={evidenceFileUrl(value.id, evidence.id)}
                            key={evidence.id}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {label} <ExternalLinkIcon aria-hidden />
                          </a>
                        ) : (
                          <a
                            className="text-xs font-semibold text-accent-strong underline"
                            href={`#evidence-${evidence.id}`}
                            key={evidence.id}
                          >
                            {label}
                          </a>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-5 border-t border-border pt-4">
        <Eyebrow tone="muted">Collected records ({value.evidence.length})</Eyebrow>
        {value.evidence.length ? (
          <ul className="mt-2 space-y-2">
            {value.evidence.map((item) => (
              <li
                className="scroll-mt-24 rounded-[6px] bg-surface-subdued p-3 target:ring-2 target:ring-accent/25"
                id={`evidence-${item.id}`}
                key={item.id}
              >
                <p className="text-xs font-semibold text-foreground-strong">{item.title}</p>
                <p className="mono mt-0.5 text-[11px] text-muted">
                  {item.source} · {item.type.replaceAll("_", " ").toLowerCase()}
                  {typeof item.data["diagnostic"] === "string" ? " · lookup note" : ""}
                </p>
                {typeof item.data["diagnostic"] === "string" ? (
                  <p className="mt-1 text-xs text-warning">{item.data["diagnostic"]}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">No evidence has been collected yet.</p>
        )}
        {screenshots.length ? (
          <div className="mt-4 grid gap-3">
            {screenshots.map((item) => (
              <a
                className="block overflow-hidden rounded-[6px] border border-border"
                href={evidenceFileUrl(value.id, item.id)}
                key={item.id}
                rel="noreferrer"
                target="_blank"
              >
                <img
                  alt={`Screenshot: ${item.title}`}
                  className="block max-h-56 w-full object-cover object-top"
                  loading="lazy"
                  src={evidenceFileUrl(value.id, item.id)}
                />
                <span className="block border-t border-border px-3 py-1.5 text-[11px] text-muted">
                  {item.title}
                </span>
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy className="mx-auto max-w-[1500px] animate-pulse motion-reduce:animate-none" role="status">
      <span className="sr-only">Loading case</span>
      <div className="h-4 w-28 rounded bg-border" />
      <div className="mt-6 h-8 w-72 rounded bg-border" />
      <div className="mt-8 h-64 rounded-[8px] bg-surface" />
      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div className="h-96 rounded-[8px] bg-surface" key={i} />
        ))}
      </div>
    </div>
  );
}

export function CaseDetailView({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ["case", id],
    queryFn: () => apiGet(`cases/${encodeURIComponent(id)}`, CaseDetail),
    refetchInterval: (q) => pollInterval(q.state.data),
  });
  if (query.isLoading) return <DetailSkeleton />;
  const value = query.data;
  if (!value) return <ErrorState message={query.error?.message ?? "Case was not returned by the API."} />;
  return (
    <div className="mx-auto max-w-[1500px]">
      <Link
        className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent-strong outline-none focus-visible:ring-2 focus-visible:ring-accent"
        href="/queue"
      >
        <ChevronLeftIcon aria-hidden />
        Back to queue
      </Link>
      <header className="mt-4 flex flex-col gap-4 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="mono text-xs text-muted">{value.paypalDisputeId}</p>
          <h1 className="mt-2 text-[28px] font-semibold leading-[34px] tracking-[-0.025em] text-foreground-strong">
            <ReasonLabel reason={value.reason} /> ·{" "}
            <MoneyDisplay cents={value.amountCents} className="text-[28px]" currency={value.currency} />
          </h1>
          <p className="mt-2 text-sm text-muted">
            {value.buyerPseudonym ?? "Buyer identity unavailable"} · opened {dateTime(value.paypalCreatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <DeadlineDisplay dueAt={value.sellerResponseDueAt} state={value.state} />
          <StateBadge state={value.state} />
          <span aria-live="polite" className="text-xs text-muted">
            {query.error ? "Refresh failed; showing the last data" : query.isFetching ? "Refreshing" : "Live"}
          </span>
        </div>
      </header>
      {query.error ? (
        <div className="mt-4">
          <ErrorState message={`${query.error.message}. The page shows the last data received.`} />
        </div>
      ) : null}
      <div className="mt-6">
        <DecisionPanel value={value} />
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <ContextPanel value={value} />
        <section
          aria-labelledby="timeline-title"
          className="rounded-[8px] border border-border bg-surface p-5"
        >
          <Eyebrow>Timeline</Eyebrow>
          <h2 className="sr-only" id="timeline-title">
            Timeline
          </h2>
          <div className="mt-4">
            <CaseTimeline value={value} />
          </div>
          <div className="mt-6 border-t border-border pt-5">
            <MessageComposer value={value} />
          </div>
        </section>
        <EvidencePanel value={value} />
      </div>
    </div>
  );
}
