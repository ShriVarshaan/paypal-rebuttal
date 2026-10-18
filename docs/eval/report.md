# Rebuttal eval report

_Generated 2026-10-18T17:46:11.641Z by `pnpm eval`._

- **+$4,635.35 expected (+$3,756.84 realized) vs always-refund on 60 cases (Engine (hand weights)).**
- **Only $27.84 of expected value lost against the ex-ante best decision, vs $728.25 for rules-only and $610.57 for always-fight.**
- **Decision accuracy 95.0% vs 70.0% rules-only and 45.0% always-fight.**
- **Brier score 0.135 (hand weights); on the held-out half 0.134 hand vs 0.127 calibrated.**

## Dataset

60 labeled synthetic disputes: 20 hand-written and 40 generated (seeded, `pnpm eval:generate`). Labels: FIGHT 27, OFFER 8, ACCEPT 25.

Hand-written cases carry draft labels by B with a written rationale; generated cases are labeled with the ex-ante best action under the generator's true win probability. Every case also has a realized outcome drawn from that probability, which the dollar figures use. Team labels (plan Day 12) go in `packages/eval/labels/`; run `pnpm eval:agreement` for inter-rater agreement.

| Reason | Cases | Hand | Generated |
|---|---|---|---|
| MERCHANDISE_OR_SERVICE_NOT_RECEIVED | 18 | 8 | 10 |
| MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED | 14 | 4 | 10 |
| UNAUTHORISED | 12 | 4 | 8 |
| CREDIT_NOT_PROCESSED | 6 | 2 | 4 |
| DUPLICATE_TRANSACTION | 3 | 1 | 2 |
| CANCELED_RECURRING_BILLING | 5 | 1 | 4 |
| INCORRECT_AMOUNT | 2 | 0 | 2 |

## Results on all cases

Realized $ is what the seller ends up with against refunding everything (0), using each case's drawn outcome. Expected $ uses the true win probability instead and is less noisy. Regret is expected value given up against the ex-ante best action.

| Strategy | Accuracy | Brier | Brier vs true p | Realized $ | Δ vs always-refund | Expected $ | Regret $ |
|---|---|---|---|---|---|---|---|
| Always refund (accept) | 41.7% | — | — | −$60.00 | $0.00 | −$60.00 | $4,663.19 |
| Always fight | 45.0% | — | — | $2,961.85 | $3,021.85 | $3,992.62 | $610.57 |
| Rules only (matrix) | 70.0% | — | — | $3,907.59 | $3,967.59 | $3,874.94 | $728.25 |
| Engine (hand weights) | 95.0% | 0.135 | 0.013 | $3,696.84 | $3,756.84 | $4,575.35 | $27.84 |
| Engine (calibrated on train) | 96.7% | 0.103 | 0.016 | $3,943.31 | $4,003.31 | $4,591.06 | $12.14 |
| Claude only | — | — | — | — | — | — | needs ANTHROPIC_API_KEY and --llm (or a full results/llm-cache.json) |
| Hybrid (engine + Claude nudge) | — | — | — | — | — | — | needs ANTHROPIC_API_KEY and --llm (or a full results/llm-cache.json) |

## Held-out test split (calibration)

Weights tuned on the 30-case train split (L2 toward the hand weights, λ = 1 chosen by 5-fold CV inside train; train log-loss 0.430 → 0.272), scored on the 30-case test split.

| Strategy | Accuracy | Brier | Brier vs true p | Realized $ | Δ vs always-refund | Expected $ | Regret $ |
|---|---|---|---|---|---|---|---|
| Always refund (accept) | 40.0% | — | — | −$30.00 | $0.00 | −$30.00 | $3,229.82 |
| Always fight | 50.0% | — | — | $2,481.53 | $2,511.53 | $2,971.25 | $228.57 |
| Rules only (matrix) | 73.3% | — | — | $2,901.53 | $2,931.53 | $3,062.80 | $137.02 |
| Engine (hand weights) | 90.0% | 0.134 | 0.014 | $2,777.93 | $2,807.93 | $3,178.68 | $21.14 |
| Engine (calibrated on train) | 96.7% | 0.127 | 0.017 | $2,843.93 | $2,873.93 | $3,189.42 | $10.40 |
| Claude only | — | — | — | — | — | — | needs ANTHROPIC_API_KEY and --llm (or a full results/llm-cache.json) |
| Hybrid (engine + Claude nudge) | — | — | — | — | — | — | needs ANTHROPIC_API_KEY and --llm (or a full results/llm-cache.json) |

## Ablation: rules only vs Claude only vs hybrid

The production design is the hybrid: the EV engine decides and Claude may only nudge p_win by ±0.10 with cited exhibits. Claude only takes the triage agent's advisory suggestedOption at face value.

The Claude rows were not run in this report (no API key). Run `pnpm eval --llm` with ANTHROPIC_API_KEY set; responses are cached in `results/llm-cache.json` so reruns are free.

| Strategy | Accuracy | Brier | Brier vs true p | Realized $ | Δ vs always-refund | Expected $ | Regret $ |
|---|---|---|---|---|---|---|---|
| Rules only (matrix) | 70.0% | — | — | $3,907.59 | $3,967.59 | $3,874.94 | $728.25 |
| Claude only | — | — | — | — | — | — | needs ANTHROPIC_API_KEY and --llm (or a full results/llm-cache.json) |
| Engine (hand weights) | 95.0% | 0.135 | 0.013 | $3,696.84 | $3,756.84 | $4,575.35 | $27.84 |
| Hybrid (engine + Claude nudge) | — | — | — | — | — | — | needs ANTHROPIC_API_KEY and --llm (or a full results/llm-cache.json) |

## Engine confusion matrix and per-reason accuracy

**Rows: label. Columns: engine's choice.**

| Label \ Engine | FIGHT | OFFER | ACCEPT |
|---|---|---|---|
| FIGHT | 27 | 0 | 0 |
| OFFER | 0 | 8 | 0 |
| ACCEPT | 3 | 0 | 22 |

| Reason | Cases | Engine accuracy |
|---|---|---|
| MERCHANDISE_OR_SERVICE_NOT_RECEIVED | 18 | 100.0% |
| MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED | 14 | 85.7% |
| UNAUTHORISED | 12 | 100.0% |
| CREDIT_NOT_PROCESSED | 6 | 83.3% |
| DUPLICATE_TRANSACTION | 3 | 100.0% |
| CANCELED_RECURRING_BILLING | 5 | 100.0% |
| INCORRECT_AMOUNT | 2 | 100.0% |

## Calibrated weights

Largest changes from the hand-set weights. `pnpm eval:calibrate` writes them to `packages/decision/src/weights.calibrated.json`; set `winModel: "calibrated"` in the merchant policy to use them.

| Feature | Hand | Calibrated | Change |
|---|---|---|---|
| amount_log | -0.15 | -1.18 | -1.03 |
| seller_responsive | 0.30 | -0.42 | -0.72 |
| required_met | 0.70 | 1.33 | +0.63 |
| digital_access | 1.30 | 1.78 | +0.48 |
| signature | 0.60 | 0.12 | -0.48 |
| delivery_proof | 1.10 | 0.71 | -0.39 |
| checkout_verified | 0.90 | 1.22 | +0.32 |
| completeness | 1.20 | 1.42 | +0.22 |

## Where the engine disagrees with the label

| Case | Label | Engine | p_win | True p | Label rationale |
|---|---|---|---|---|---|
| H11 | ACCEPT | FIGHT | 0.17 | 0.12 | Damage photos and no listing/packing evidence: a fight is very likely lost and adds a fee. |
| G18 | ACCEPT | FIGHT | 0.83 | 0.63 | World p_win 0.63: EV fight $-7.47, accept $-1.00. |
| G30 | ACCEPT | FIGHT | 0.21 | 0.14 | World p_win 0.14: EV fight $-8.05, accept $-1.00. |

## Caveats

The cases are synthetic, and the generator's world shares the engine's feature definitions (with different weights and hidden noise), so absolute numbers flatter a real deployment. The comparison between strategies is the useful signal.

Dollar figures use the default policy's economics ($20 loss fee, $30/h labour, 20 minutes per fight); see docs/decision-engine.md. Labels are draft until the team's independent labeling round is merged.

Realized dollars are one draw of 60 coin flips, so they are noisy: on this draw Rules only (matrix), Engine (calibrated on train) realized more than the engine (hand weights) despite a lower expected value. Judge strategies on expected value and regret.
