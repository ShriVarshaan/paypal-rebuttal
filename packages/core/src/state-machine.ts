import { TERMINAL_STATES, type CaseState } from "./case.js";

/**
 * Case state machine (plan §2). A plain transition table rather than xstate: the worker
 * jobs own the side effects, this only says which moves are legal.
 *
 * NEW → GATHERING → TRIAGED → AWAITING_APPROVAL → FILING → FILED → WAITING_PAYPAL
 *   → WON | LOST | REFUNDED | OFFER_PENDING → (APPEAL_DRAFTED)
 */
const RESOLVED: CaseState[] = ["WON", "LOST", "REFUNDED"];

export const TRANSITIONS: Record<CaseState, readonly CaseState[]> = {
  NEW: ["GATHERING", "TRIAGED", "AWAITING_APPROVAL", "FILING", ...RESOLVED],
  // Re-triage (new evidence, buyer message) can happen from any pre-filing state.
  GATHERING: ["GATHERING", "TRIAGED", "AWAITING_APPROVAL", "FILING", ...RESOLVED],
  TRIAGED: ["TRIAGED", "AWAITING_APPROVAL", "FILING", ...RESOLVED],
  AWAITING_APPROVAL: ["TRIAGED", "AWAITING_APPROVAL", "FILING", ...RESOLVED],
  // A failed write goes back to a human.
  FILING: ["FILED", "OFFER_PENDING", "AWAITING_APPROVAL", ...RESOLVED],
  FILED: ["WAITING_PAYPAL", ...RESOLVED],
  WAITING_PAYPAL: ["WAITING_PAYPAL", ...RESOLVED],
  // The buyer rejected the offer: decide again.
  OFFER_PENDING: ["WAITING_PAYPAL", "TRIAGED", "AWAITING_APPROVAL", ...RESOLVED],
  WON: [],
  LOST: ["APPEAL_DRAFTED", "WAITING_PAYPAL"],
  REFUNDED: [],
  APPEAL_DRAFTED: ["WAITING_PAYPAL", "LOST", "WON", "REFUNDED"],
};

export function canTransition(from: CaseState, to: CaseState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {
  override readonly name = "IllegalTransitionError";
  constructor(
    readonly from: CaseState,
    readonly to: CaseState,
  ) {
    super(`Illegal case transition ${from} → ${to}`);
  }
}

export function assertTransition(from: CaseState, to: CaseState): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

/** States in which the engine may (re)propose a decision. */
export const TRIAGEABLE_STATES: ReadonlySet<CaseState> = new Set([
  "NEW",
  "GATHERING",
  "TRIAGED",
  "AWAITING_APPROVAL",
  "OFFER_PENDING",
]);

export const isTerminal = (s: CaseState): boolean => TERMINAL_STATES.has(s);

/** What happened to a case. `transition` maps (state, event) to the next state. */
export type CaseTransitionEvent =
  | "GATHER_STARTED"
  | "TRIAGED_AUTO"
  | "DECISION_PROPOSED"
  | "FILING_STARTED"
  | "FILED"
  | "OFFER_SENT"
  | "FILING_FAILED"
  | "UNDER_REVIEW"
  | "OFFER_REJECTED"
  | "RESOLVED_WON"
  | "RESOLVED_LOST"
  | "RESOLVED_REFUNDED"
  | "APPEAL_DRAFTED"
  | "APPEAL_FILED";

const PRE_FILING: CaseState[] = ["NEW", "GATHERING", "TRIAGED", "AWAITING_APPROVAL", "OFFER_PENDING"];
const OPEN: CaseState[] = [...PRE_FILING, "FILING", "FILED", "WAITING_PAYPAL", "APPEAL_DRAFTED"];

const EVENTS: Record<CaseTransitionEvent, { from: readonly CaseState[]; to: CaseState }> = {
  GATHER_STARTED: { from: ["NEW", "GATHERING"], to: "GATHERING" },
  TRIAGED_AUTO: { from: PRE_FILING, to: "TRIAGED" },
  DECISION_PROPOSED: { from: PRE_FILING, to: "AWAITING_APPROVAL" },
  FILING_STARTED: { from: ["NEW", "GATHERING", "TRIAGED", "AWAITING_APPROVAL"], to: "FILING" },
  FILED: { from: ["FILING"], to: "FILED" },
  OFFER_SENT: { from: ["FILING"], to: "OFFER_PENDING" },
  FILING_FAILED: { from: ["FILING"], to: "AWAITING_APPROVAL" },
  UNDER_REVIEW: { from: ["FILED", "OFFER_PENDING", "WAITING_PAYPAL"], to: "WAITING_PAYPAL" },
  OFFER_REJECTED: { from: ["OFFER_PENDING"], to: "TRIAGED" },
  RESOLVED_WON: { from: OPEN, to: "WON" },
  RESOLVED_LOST: { from: OPEN, to: "LOST" },
  RESOLVED_REFUNDED: { from: OPEN, to: "REFUNDED" },
  APPEAL_DRAFTED: { from: ["LOST"], to: "APPEAL_DRAFTED" },
  APPEAL_FILED: { from: ["LOST", "APPEAL_DRAFTED"], to: "WAITING_PAYPAL" },
};

export const CASE_TRANSITION_EVENTS = Object.keys(EVENTS) as CaseTransitionEvent[];

/** The next state for `event`, or IllegalTransitionError when the event can't happen now. */
export function transition(state: CaseState, event: CaseTransitionEvent): CaseState {
  const e = EVENTS[event];
  if (!e.from.includes(state)) throw new IllegalTransitionError(state, e.to);
  return e.to;
}
