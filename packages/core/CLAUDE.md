# packages/core (contract, B)

Shared zod types every other package imports. **Changes to exported types need A + B + C approval** (root CLAUDE.md).

- A's platform types: money, case, events, evidence item, decision input, action, transaction, PayPal enums.
- B's additions: `evidence-kinds.ts` (`data.kind` conventions per evidence type), `evidence-matrix.ts` (reason → required/strong/nice, completeness), `exhibits.ts` (deterministic EX-n ids), `response-options.ts`, `policy.ts` (merchant Policy + defaults), `state-machine.ts` (transition table + `transition(state, event)`), `analysis.ts` (TriageResult, Narrative, AppealDraft, DecisionAnalysis), `records.ts` (api row shapes).
- Keep it pure: no I/O, no clocks. Tests sit next to the code.
- Matrix tiers, signature thresholds and policy defaults are judgement calls; change them in review and update docs/decision-engine.md.
