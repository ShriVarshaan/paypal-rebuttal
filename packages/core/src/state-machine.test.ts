import { describe, expect, it } from "vitest";
import { CaseState } from "./case.js";
import {
  CASE_TRANSITION_EVENTS,
  canTransition,
  IllegalTransitionError,
  transition,
  TRANSITIONS,
} from "./state-machine.js";

const STATES = CaseState.options;

describe("transition(state, event)", () => {
  it("every legal event move is allowed by the transition table", () => {
    for (const s of STATES)
      for (const e of CASE_TRANSITION_EVENTS) {
        let to: CaseState | null = null;
        try {
          to = transition(s, e);
        } catch (err) {
          expect(err).toBeInstanceOf(IllegalTransitionError);
        }
        if (to) expect(canTransition(s, to), `${s} --${e}--> ${to}`).toBe(true);
      }
  });

  it("walks the fight, offer and appeal paths", () => {
    const run = (s: CaseState, ...events: Parameters<typeof transition>[1][]) => events.reduce(transition, s);
    expect(
      run(
        "NEW",
        "GATHER_STARTED",
        "DECISION_PROPOSED",
        "FILING_STARTED",
        "FILED",
        "UNDER_REVIEW",
        "RESOLVED_WON",
      ),
    ).toBe("WON");
    expect(
      run("NEW", "GATHER_STARTED", "TRIAGED_AUTO", "FILING_STARTED", "OFFER_SENT", "OFFER_REJECTED"),
    ).toBe("TRIAGED");
    expect(run("WAITING_PAYPAL", "RESOLVED_LOST", "APPEAL_DRAFTED", "APPEAL_FILED")).toBe("WAITING_PAYPAL");
  });

  it("rejects events that can't happen in a state", () => {
    expect(() => transition("WON", "RESOLVED_LOST")).toThrow(IllegalTransitionError);
    expect(() => transition("NEW", "FILED")).toThrow(IllegalTransitionError);
    expect(() => transition("REFUNDED", "APPEAL_DRAFTED")).toThrow(IllegalTransitionError);
  });
});

describe("transition table", () => {
  it("terminal WON and REFUNDED have no exits; LOST only to appeal", () => {
    expect(TRANSITIONS.WON).toEqual([]);
    expect(TRANSITIONS.REFUNDED).toEqual([]);
    expect([...TRANSITIONS.LOST].sort()).toEqual(["APPEAL_DRAFTED", "WAITING_PAYPAL"]);
  });

  it("is exhaustive: every (from, to) pair is either legal or illegal, never undefined", () => {
    let legal = 0;
    for (const a of STATES) for (const b of STATES) if (canTransition(a, b)) legal++;
    expect(legal).toBe(Object.values(TRANSITIONS).reduce((s, t) => s + t.length, 0));
  });
});
