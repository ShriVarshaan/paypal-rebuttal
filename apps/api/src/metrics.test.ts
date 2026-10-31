import { describe, expect, it } from "vitest";
import { computeMetrics, paidOut, weekStart, type MetricCase } from "./metrics.js";

const now = new Date("2026-10-31T12:00:00Z");
const base: MetricCase = {
  id: "c",
  reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  amountCents: 10_000,
  currency: "USD",
  state: "NEW",
  createdAt: new Date("2026-10-20T00:00:00Z"),
  paypalCreatedAt: new Date("2026-10-20T00:00:00Z"),
  sellerResponseDueAt: new Date("2026-10-30T00:00:00Z"),
  resolvedAt: null,
  firstResponseAt: null,
  filedEvidence: false,
  offerPaidCents: null,
};
const c = (over: Partial<MetricCase>): MetricCase => ({ ...base, ...over });

describe("dashboard metrics", () => {
  it("pays nothing on a win, the offer on an accepted offer, the full amount otherwise", () => {
    expect(paidOut(c({ state: "WON" }))).toBe(0);
    expect(paidOut(c({ state: "REFUNDED", offerPaidCents: 3_000 }))).toBe(3_000);
    expect(paidOut(c({ state: "REFUNDED" }))).toBe(10_000);
    expect(paidOut(c({ state: "LOST" }))).toBe(10_000);
  });

  it("computes recovered money, win rate, response time and missed deadlines", () => {
    const m = computeMetrics({
      now,
      orders: [
        { placedAt: new Date("2026-10-27T00:00:00Z") },
        { placedAt: new Date("2026-10-28T00:00:00Z") },
      ],
      runs: [
        { caseId: "a", costUsd: 0.2 },
        { caseId: "a", costUsd: 0.1 },
        { caseId: "b", costUsd: 0.3 },
      ],
      cases: [
        c({
          id: "a",
          state: "WON",
          filedEvidence: true,
          resolvedAt: new Date("2026-10-28T00:00:00Z"),
          firstResponseAt: new Date("2026-10-20T06:00:00Z"),
        }),
        c({
          id: "b",
          state: "LOST",
          filedEvidence: true,
          resolvedAt: new Date("2026-10-29T00:00:00Z"),
          firstResponseAt: new Date("2026-10-20T10:00:00Z"),
        }),
        c({
          id: "d",
          state: "REFUNDED",
          offerPaidCents: 4_000,
          resolvedAt: new Date("2026-10-29T00:00:00Z"),
          firstResponseAt: new Date("2026-10-20T02:00:00Z"),
          reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
        }),
        c({ id: "e", paypalCreatedAt: new Date("2026-10-27T00:00:00Z") }), // open, deadline passed, no response: missed
        c({
          id: "f",
          currency: "EUR",
          state: "WON",
          resolvedAt: new Date("2026-10-29T00:00:00Z"),
          firstResponseAt: new Date("2026-10-21T00:00:00Z"),
        }),
      ],
    });
    expect(m.recoveredCents).toBe(10_000 + 0 + 6_000);
    expect(m.refundAllPaidOutCents).toBe(30_000);
    expect(m.winRate).toBe(0.5);
    expect(m.medianHoursToRespond).toBe(8);
    expect(m.deadlinesMissed).toBe(1);
    expect(m.claudeCostPerCaseUsd).toBeCloseTo(0.3);
    expect(m.cumulative.at(-1)).toMatchObject({ paidOutCents: 14_000, refundAllCents: 30_000 });
    const lastWeek = m.disputeRateTrend.at(-1)!;
    expect(lastWeek).toMatchObject({ disputes: 1, orders: 2, rate: 0.5 });
    expect(m.outcomesByReason.find((r) => r.reason === "MERCHANDISE_OR_SERVICE_NOT_RECEIVED")).toMatchObject({
      won: 2,
      lost: 1,
      open: 1,
    });
  });

  it("starts weeks on Monday UTC", () => {
    expect(new Date(weekStart(new Date("2026-10-31T12:00:00Z"))).toISOString()).toBe(
      "2026-10-26T00:00:00.000Z",
    );
  });
});
