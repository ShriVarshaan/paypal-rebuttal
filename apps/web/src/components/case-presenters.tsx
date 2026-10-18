"use client";

import { ClockIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Money, minorUnitDigits, TERMINAL_STATES, type CaseState } from "@rebuttal/core";
import { useEffect, useState, type ReactNode } from "react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const stateLabels: Record<CaseState, string> = {
  NEW: "New",
  GATHERING: "Gathering",
  TRIAGED: "Triaged",
  AWAITING_APPROVAL: "Needs approval",
  FILING: "Filing",
  FILED: "Filed",
  WAITING_PAYPAL: "Waiting on PayPal",
  OFFER_PENDING: "Offer pending",
  WON: "Won",
  LOST: "Lost",
  REFUNDED: "Refunded",
  APPEAL_DRAFTED: "Appeal drafted",
};

const stateTones: Record<CaseState, NonNullable<BadgeProps["tone"]>> = {
  NEW: "neutral",
  GATHERING: "accent",
  TRIAGED: "accent",
  AWAITING_APPROVAL: "warning",
  FILING: "accent",
  FILED: "accent",
  WAITING_PAYPAL: "neutral",
  OFFER_PENDING: "warning",
  WON: "success",
  LOST: "danger",
  REFUNDED: "neutral",
  APPEAL_DRAFTED: "warning",
};

const reasonLabels: Record<string, string> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "Not received",
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "Not as described",
  UNAUTHORISED: "Unauthorised",
  DUPLICATE_TRANSACTION: "Duplicate transaction",
  CREDIT_NOT_PROCESSED: "Credit not processed",
  CANCELED_RECURRING_BILLING: "Recurring billing canceled",
};

export function StateBadge({ state }: { state: CaseState }) {
  return <Badge tone={stateTones[state]}>{stateLabels[state]}</Badge>;
}

export function ReasonLabel({ reason }: { reason: string }) {
  return (
    <span className="font-medium text-foreground-strong">
      {reasonLabels[reason] ?? reason.replaceAll("_", " ").toLowerCase()}
    </span>
  );
}

export function MoneyDisplay({
  cents,
  currency,
  className,
}: {
  cents: number;
  currency: string;
  className?: string;
}) {
  const money = Money.parse({ cents, currency });
  const digits = minorUnitDigits(money.currency);
  const value = money.cents / 10 ** digits;
  return (
    <span className={cn("mono font-semibold text-foreground-strong", className)}>
      {new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: money.currency,
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(value)}
    </span>
  );
}

function relativeDeadline(
  dueAt: string,
  now: number,
): { label: string; tone: "danger" | "warning" | "neutral"; urgent: boolean } {
  const diff = new Date(dueAt).getTime() - now;
  const overdue = diff < 0;
  const absoluteMinutes = Math.floor(Math.abs(diff) / 60_000);
  const days = Math.floor(absoluteMinutes / 1_440);
  const hours = Math.floor((absoluteMinutes % 1_440) / 60);
  const minutes = absoluteMinutes % 60;
  const compact = days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
  if (overdue) return { label: `${compact} overdue`, tone: "danger", urgent: true };
  if (diff <= 24 * 60 * 60 * 1000)
    return { label: `${compact} remaining`, tone: "warning", urgent: diff <= 6 * 60 * 60 * 1000 };
  return { label: compact, tone: "neutral", urgent: false };
}

export function DeadlineDisplay({ dueAt, state }: { dueAt: string | null; state: CaseState }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (TERMINAL_STATES.has(state)) return <span className="text-sm text-muted">Resolved</span>;
  if (!dueAt) return <span className="text-sm text-muted">No deadline</span>;
  if (now === null) return <span className="text-sm text-muted">Calculating…</span>;

  const value = relativeDeadline(dueAt, now);
  return (
    <span
      className={cn(
        "mono inline-flex items-center gap-1.5 text-xs font-semibold",
        value.tone === "danger" && "text-danger",
        value.tone === "warning" && "text-warning",
        value.tone === "neutral" && "text-foreground",
        value.urgent && "motion-safe:animate-pulse",
      )}
    >
      {value.tone === "danger" ? <ExclamationTriangleIcon aria-hidden /> : <ClockIcon aria-hidden />}
      {value.label}
    </span>
  );
}

export function Completeness({ value }: { value: number }) {
  return (
    <div className="w-full min-w-24">
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-muted">
        <span>Evidence</span>
        <span className="mono">{value}%</span>
      </div>
      <Progress value={value} />
    </div>
  );
}

export function LoadingState({ label = "Loading cases" }: { label?: string }) {
  return (
    <div
      aria-live="polite"
      className="grid min-h-64 place-items-center rounded-[8px] border border-border bg-surface p-8"
      role="status"
    >
      <div className="text-center">
        <span
          aria-hidden
          className="mx-auto block size-6 animate-spin rounded-full border-2 border-border border-t-accent motion-reduce:animate-none"
        />
        <p className="mt-4 text-sm font-semibold text-foreground-strong">{label}</p>
      </div>
    </div>
  );
}

export function EmptyState({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="grid min-h-64 place-items-center rounded-[8px] border border-dashed border-border-strong bg-surface-subdued p-8 text-center">
      <div>
        <p className="font-semibold text-foreground-strong">{title}</p>
        <div className="mt-2 text-sm leading-6 text-muted">{children}</div>
      </div>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div
      className="rounded-[8px] border border-danger/20 bg-danger-soft p-4 text-sm text-danger"
      role="alert"
    >
      <span className="font-semibold">Could not load this view.</span> {message}
    </div>
  );
}
