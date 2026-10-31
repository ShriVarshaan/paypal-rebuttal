import { minorUnitDigits } from "@rebuttal/core";

/** Minor units → "$1,234.50" using the currency's own decimal places. */
export function formatMoney(
  cents: number,
  currency: string,
  opts: { compact?: boolean; signed?: boolean } = {},
) {
  const digits = minorUnitDigits(currency);
  const value = cents / 10 ** digits;
  const text = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    ...(opts.compact && Math.abs(value) >= 10_000
      ? { notation: "compact", maximumFractionDigits: 1 }
      : { minimumFractionDigits: digits, maximumFractionDigits: digits }),
    ...(opts.signed ? { signDisplay: "exceptZero" } : {}),
  }).format(value);
  return text.replace("-", "−");
}

export const percent = (value: number, digits = 0) => `${(value * 100).toFixed(digits)}%`;

export function dateTime(value: string | null | undefined): string {
  if (!value) return "Undated";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Undated"
    : date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export function relativeTime(value: string, now = Date.now()): string {
  const diff = Date.parse(value) - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  if (abs < 60_000) return "just now";
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  return rtf.format(Math.round(diff / 86_400_000), "day");
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const OPTION_LABEL: Record<string, string> = {
  REFUND: "Partial refund",
  REFUND_WITH_RETURN: "Refund with return",
  REFUND_WITH_REPLACEMENT: "Refund with replacement",
  REPLACEMENT_WITHOUT_REFUND: "Replacement",
};
export const offerTypeLabel = (t: string | null | undefined) => (t ? (OPTION_LABEL[t] ?? t) : "Offer");

export const evidenceTypeLabel = (type: string) =>
  type
    .toLowerCase()
    .split("_")
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
