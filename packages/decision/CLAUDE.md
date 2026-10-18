# packages/decision (B)

The math that chooses fight / offer / accept. See docs/decision-engine.md.

- `signals.ts` → `win-model.ts` (features, logistic p_win, `explain`) → `ev.ts` + `offer.ts` → `engine.ts` (`decideCase`, autonomy, deadline-safe option, `toDecisionAnalysis`) → `index.ts` (`safeDefault` for the SLA scheduler).
- Weights: `weights.v0.json` (hand-set, a note per weight) and `weights.v1.json` (written by `pnpm eval:calibrate`; don't edit by hand).
- The only LLM input is `llmAdjustment`: clamped to ±0.10, needs cited known exhibits, ignored on injection.
- Pure functions, money in integer minor units. Keep the monotonicity tests passing when you add features.
