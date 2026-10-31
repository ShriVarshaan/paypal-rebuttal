/**
 * Dashboard metrics (C, Day 15). Pure: rows in, numbers out, so every definition is testable.
 *
 * Definitions (money in minor units of USD; other currencies are counted, not summed):
 * - paid out: what the seller lost on a resolved case. WON 0; an accepted partial offer
 *   (REFUNDED after a successful MAKE_OFFER) the offer; any other LOST/REFUNDED the full amount.
 * - recovered: disputed amount minus paid out, over resolved cases.
 * - refund-everything baseline: paid out = the full amount for every resolved case.
 * - win rate: WON / (WON + LOST) among cases where evidence was filed.
 * - time to respond: case created → first successful PayPal response (evidence, offer, accept).
 * - deadline missed: the response deadline passed before any response and before resolution.
 */

export interface MetricCase {
  id: string;
  reason: string;
  amountCents: number;
  currency: string;
  state: string;
  createdAt: Date;
  paypalCreatedAt: Date;
  sellerResponseDueAt: Date | null;
  /** When PayPal's outcome arrived (OUTCOME event), if resolved. */
  resolvedAt: Date | null;
  /** First successful PROVIDE_EVIDENCE / MAKE_OFFER / ACCEPT_CLAIM. */
  firstResponseAt: Date | null;
  filedEvidence: boolean;
  /** Amount of a successful MAKE_OFFER, when one was made. */
  offerPaidCents: number | null;
}

export interface MetricRun {
  caseId: string | null;
  costUsd: number;
}

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const RESOLVED = new Set(["WON", "LOST", "REFUNDED"]);

export function paidOut(c: MetricCase): number {
  if (c.state === "WON") return 0;
  if (c.state === "REFUNDED" && c.offerPaidCents != null) return Math.min(c.offerPaidCents, c.amountCents);
  return c.amountCents;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Monday 00:00 UTC of the week containing `d`. */
export function weekStart(d: Date): number {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const offset = (day.getUTCDay() + 6) % 7;
  return day.getTime() - offset * DAY;
}

export function computeMetrics(input: {
  cases: MetricCase[];
  orders: { placedAt: Date }[];
  runs: MetricRun[];
  now: Date;
  weeks?: number;
}) {
  const { now } = input;
  const usd = input.cases.filter((c) => c.currency === "USD");
  const resolved = usd.filter((c) => RESOLVED.has(c.state) && c.resolvedAt);
  const since30 = now.getTime() - 30 * DAY;
  const recovered = (cs: MetricCase[]) => cs.reduce((s, c) => s + (c.amountCents - paidOut(c)), 0);

  const fought = input.cases.filter((c) => c.filedEvidence && (c.state === "WON" || c.state === "LOST"));
  const won = fought.filter((c) => c.state === "WON").length;
  const responseHours = input.cases.flatMap((c) =>
    c.firstResponseAt ? [(c.firstResponseAt.getTime() - c.createdAt.getTime()) / 3_600_000] : [],
  );
  const missed = input.cases.filter((c) => {
    if (!c.sellerResponseDueAt) return false;
    const due = c.sellerResponseDueAt.getTime();
    const answeredBy = Math.min(
      c.firstResponseAt?.getTime() ?? Infinity,
      c.resolvedAt?.getTime() ?? Infinity,
    );
    return due < Math.min(answeredBy, now.getTime());
  });

  const casesWithRuns = new Set(input.runs.flatMap((r) => (r.caseId ? [r.caseId] : [])));
  const totalCost = input.runs.reduce((s, r) => s + r.costUsd, 0);

  // Weekly dispute rate over the last N weeks (disputes opened / store orders placed).
  const weeks = input.weeks ?? 12;
  const thisWeek = weekStart(now);
  const trend = Array.from({ length: weeks }, (_, i) => {
    const start = thisWeek - (weeks - 1 - i) * WEEK;
    const inWeek = (d: Date) => d.getTime() >= start && d.getTime() < start + WEEK;
    const disputes = input.cases.filter((c) => inWeek(c.paypalCreatedAt)).length;
    const orders = input.orders.filter((o) => inWeek(o.placedAt)).length;
    return {
      weekStart: new Date(start).toISOString(),
      disputes,
      orders,
      rate: orders ? disputes / orders : null,
    };
  });

  const reasons = [...new Set(input.cases.map((c) => c.reason))].sort();
  const byReason = reasons.map((reason) => {
    const cs = input.cases.filter((c) => c.reason === reason);
    return {
      reason,
      won: cs.filter((c) => c.state === "WON").length,
      lost: cs.filter((c) => c.state === "LOST").length,
      refunded: cs.filter((c) => c.state === "REFUNDED").length,
      open: cs.filter((c) => !RESOLVED.has(c.state)).length,
    };
  });

  // Cumulative money paid out, by resolution date: with Rebuttal vs refunding everything.
  let actual = 0;
  let baseline = 0;
  const cumulative = [...resolved]
    .sort((a, b) => a.resolvedAt!.getTime() - b.resolvedAt!.getTime())
    .map((c) => {
      actual += paidOut(c);
      baseline += c.amountCents;
      return { at: c.resolvedAt!.toISOString(), paidOutCents: actual, refundAllCents: baseline };
    });

  return {
    generatedAt: now.toISOString(),
    currency: "USD",
    recoveredCents: recovered(resolved),
    recovered30dCents: recovered(resolved.filter((c) => c.resolvedAt!.getTime() >= since30)),
    refundAllPaidOutCents: resolved.reduce((s, c) => s + c.amountCents, 0),
    paidOutCents: resolved.reduce((s, c) => s + paidOut(c), 0),
    winRate: fought.length ? won / fought.length : null,
    fought: fought.length,
    won,
    casesTotal: input.cases.length,
    casesResolved: input.cases.filter((c) => RESOLVED.has(c.state)).length,
    casesOpen: input.cases.filter((c) => !RESOLVED.has(c.state)).length,
    responded: responseHours.length,
    medianHoursToRespond: median(responseHours),
    deadlinesMissed: missed.length,
    claudeCostUsd: totalCost,
    claudeCostPerCaseUsd: casesWithRuns.size ? totalCost / casesWithRuns.size : null,
    disputeRateTrend: trend,
    outcomesByReason: byReason,
    cumulative,
  };
}
