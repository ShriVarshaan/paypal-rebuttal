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
