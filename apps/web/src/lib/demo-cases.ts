import type { CaseState } from "@rebuttal/core";

export type DemoRecommendation = "FIGHT" | "OFFER" | "ACCEPT";

export interface DemoCase {
  id: string;
  paypalDisputeId: string;
  reason: string;
  amountCents: number;
  currency: string;
  stage: string;
  state: CaseState;
  recommendation: DemoRecommendation | null;
  pWin: number | null;
  evidenceCompleteness: number;
  buyer: string;
  dueAt: string | null;
}

export const demoCases: DemoCase[] = [
  {
    id: "demo-urgent",
    paypalDisputeId: "DEMO-CASE-001",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    amountCents: 12900,
    currency: "USD",
    stage: "CHARGEBACK",
    state: "AWAITING_APPROVAL",
    recommendation: "FIGHT",
    pWin: 0.82,
    evidenceCompleteness: 88,
    buyer: "Buyer M•••4",
    dueAt: "2026-10-19T06:30:00.000Z",
  },
  {
    id: "demo-gathering",
    paypalDisputeId: "DEMO-CASE-002",
    reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    amountCents: 7450,
    currency: "USD",
    stage: "INQUIRY",
    state: "GATHERING",
    recommendation: null,
    pWin: null,
    evidenceCompleteness: 42,
    buyer: "Buyer R•••8",
    dueAt: "2026-10-21T14:15:00.000Z",
  },
  {
    id: "demo-offer",
    paypalDisputeId: "DEMO-CASE-003",
    reason: "CREDIT_NOT_PROCESSED",
    amountCents: 2499,
    currency: "USD",
    stage: "PRE_ARBITRATION",
    state: "TRIAGED",
    recommendation: "OFFER",
    pWin: 0.48,
    evidenceCompleteness: 63,
    buyer: "Buyer A•••2",
    dueAt: null,
  },
  {
    id: "demo-won",
    paypalDisputeId: "DEMO-CASE-004",
    reason: "UNAUTHORISED",
    amountCents: 19900,
    currency: "JPY",
    stage: "ARBITRATION",
    state: "WON",
    recommendation: "FIGHT",
    pWin: 0.76,
    evidenceCompleteness: 100,
    buyer: "Buyer K•••1",
    dueAt: "2026-10-18T08:00:00.000Z",
  },
  {
    id: "demo-lost",
    paypalDisputeId: "DEMO-CASE-005",
    reason: "DUPLICATE_TRANSACTION",
    amountCents: 5600,
    currency: "USD",
    stage: "ARBITRATION",
    state: "LOST",
    recommendation: "ACCEPT",
    pWin: 0,
    evidenceCompleteness: 18,
    buyer: "Buyer T•••7",
    dueAt: "2026-10-17T11:00:00.000Z",
  },
];
