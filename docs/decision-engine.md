# Decision engine

How Rebuttal decides whether to **fight**, **offer a partial refund** or **accept** a PayPal dispute (plan §3). Owner: B. Code: `packages/decision`, with the evidence matrix and policy schema in `packages/core`.

The design rule: **the math decides**. The win-probability model and the expected-value comparison pick the action. Claude may only nudge p_win by at most ±0.10, with a reason that cites evidence exhibits, and it never sets amounts.

```
evidence items ──▶ signals ──▶ features ──▶ p_win (logistic) ──┐
      │                                  ▲                     ├─▶ EV(fight), EV(offer x*), EV(accept) ──▶ argmax over allowed
      └─▶ matrix completeness ───────────┘   Claude nudge ±0.10│
                                              (cited, clamped) ┘                              │
                                                                       autonomy policy ◀──────┘──▶ PROPOSED | AUTO_APPROVED
```

## 1. Reason → evidence matrix

`packages/core/src/evidence-matrix.ts`. Each dispute reason lists the evidence that wins it in three tiers: **required** (without it p_win drops sharply), **strong** (raises p_win), and **nice** (helps the story). Each requirement says how it's filed with PayPal (`evidence_type`) and how to recognise it among gathered items (by `data.kind`; see `evidence-kinds.ts`).

| Reason | Required | Strong | Nice |
|---|---|---|---|
| Not received, physical | carrier tracking shows delivered | delivered to the address on file; signature above $250 | order record, messages; signature ≤ $250 |
| Not received, digital | download/access after purchase | accessed from the checkout IP | order record, messages |
| Not as described | listing snapshot from before the order | messages, return policy, packing photos | delivery (or access) proof |
| Unauthorised | delivery to the address on file (or access, digital) | repeat customer, known device/IP, AVS/CVV match | — |
| Credit not processed | refund record, or a policy showing no credit was due | messages | — |
| Duplicate | proof the two charges are separate orders | — | refund record |
| Incorrect amount | order shows the agreed amount | — | messages |
| Cancelled recurring billing | billing terms, and no cancellation before the charge | usage after the charge | messages |
| Paid by other means | single PayPal payment on the order | — | refund record |

Signature confirmation becomes **required** from $750, where PayPal Seller Protection demands it.

**Completeness** = Σ over tiers present of `weight × (met in tier / items in tier)`, divided by the sum of those tiers' weights. The weights are required 0.6, strong 0.3 and nice 0.1, so the score runs from 0 to 1.

## 2. Win probability

`p_win = logistic( logit(baseRate[reason]) + stage[stage] + Σ wᵢ·xᵢ )`. Code: `win-model.ts`; weights in `weights.v0.json`, which has a note on every weight.

- **Base rates** with no evidence: not received 0.40, unauthorised 0.30, duplicate 0.35, not as described 0.25, others 0.25–0.35.
- **Stage** shifts (logit): inquiry 0, chargeback −0.15, pre-arbitration −0.30, arbitration −0.40.
- **Features** are reason-aware. A feature that doesn't bear on a reason is 0, so one weight vector serves every reason. Examples: `delivery_proof` (+1.1), `signature` (+0.6), `shipment_problem` (−1.6), `listing_snapshot` (+1.0), `fraud_signals` (−1.8), `refund_proof` (+1.8), `amount_log` (−0.15 per decade above $50).

Every decision stores each feature's contribution to the logit, plus a readable line such as "No delivery confirmation: −1.20".

**Calibration.** `pnpm eval:calibrate` fits the feature weights and one shared shift of the base rates. It uses logistic regression on the train half of the eval set, with an L2 penalty pulling each weight back towards its hand-set value (λ chosen by 5-fold CV inside train), and writes `weights.v1.json`. Merchants switch with `winModel: "calibrated"`. The default stays on the hand weights until the team signs off.

## 3. Expected value

All values are in minor units, measured against "refund the full amount" = 0. Code: `ev.ts`.

- **EV(fight)** = p·A − (1−p)·(fee + risk) − labour_fight
- **EV(offer x)** = P_accept(x)·(kept(x) − labour_offer) + (1 − P_accept(x))·EV(fight)
  - REFUND: kept = A − x. REFUND_WITH_RETURN: kept = recovery·A − return shipping. REPLACEMENT_WITHOUT_REFUND: kept = A − replacement cost.
- **EV(accept)** = −labour_accept. The executor files accept-claim as a plain refund, so no return value is credited.

`risk` is the cost of one more lost dispute on the merchant's dispute ratio: `ratioPenalty × min(1, ratio / threshold)`.

**Offer optimizer** (`offer.ts`): a grid search over the refund ratio x/A from 10% to 90% in 5% steps, rounded to whole currency units, plus the fixed-amount offer types PayPal allows. Returns are skipped for digital goods. REFUND_WITH_REPLACEMENT (a refund *and* a replacement) isn't modelled and is never proposed.

**Buyer acceptance curve (an assumption, not fitted):** `P_accept(r) = 1 / (1 + e^(−9·(r − m)))`, with m = 0.45 shifted by reason: −0.05 for not-as-described (those buyers usually want compensation) and +0.10 for not-received (those buyers want the item or all their money). Offers that require a return are 0.15 less likely to be accepted. The eval's simulated buyers are drawn from the same curve, so the eval can't validate the curve itself. Only real sandbox or production data can.

**Allowed options** come from PayPal's `allowed_response_options`. When PayPal sends none, offers are assumed possible only at the inquiry stage.

## 4. Policy and autonomy

`packages/core/src/policy.ts` (the schema and defaults) and `engine.ts` (`autonomy`, `safeOption`).

A decision is **auto-approved** only when all of these hold:
- autonomy is on and the option is in the allowed list (default FIGHT and ACCEPT; offers always need a human),
- the amount is ≤ $50 and the reason isn't in `requireApprovalReasons`,
- for FIGHT: p_win ≥ 0.8, every required item present, and completeness ≥ 0.8,
- no prompt-injection signs in buyer text.

Otherwise it's PROPOSED and waits for the seller.

**Deadline override:** if the response is due within 24 h and nobody has approved, the engine's choice is auto-approved. It uses the deadline-safe version: a FIGHT missing required evidence becomes the best of OFFER/ACCEPT. At T-2h the SLA scheduler calls `safeDefault`, which is the same logic without Claude.

## 5. Default economics (assumptions)

| Parameter | Default | Why |
|---|---|---|
| Loss fee | $20 | PayPal dispute/chargeback fee on a lost case |
| Labour | $30/h; fight 20 min, offer 8 min, accept 2 min | a small seller's time |
| Return recovery | 30% of price, minus $8 return label | returned "not as described" items rarely resell at full price |
| Replacement cost | 45% of price | cost of goods plus shipping |
| Dispute ratio | 0.4% now, 1% threshold, $15 per loss at the threshold | PayPal starts reviewing accounts around 1% |

All of these are per-merchant settings (`PUT /policy`).

## 6. Worked example: PP-D-90001 / eval case H01

$89 headphones, chargeback stage, buyer says it never arrived. Evidence: USPS tracking *delivered* to the shipping postal code with a signature, the seller replied to the buyer, and an order record. Completeness 1.0.

| Logit term | Value |
|---|---|
| base rate: logit(0.40) + chargeback −0.15 | −0.555 |
| delivered to the address on file | +1.100 |
| all required evidence present | +0.700 |
| completeness (1.0 − 0.5) × 1.2 | +0.600 |
| signature confirmation | +0.600 |
| seller replied | +0.300 |
| amount, log10(89/50) × −0.15 | −0.038 |
| days to dispute | +0.013 |
| **logit** | **2.720 → p_win 0.938** |

- EV(fight) = 0.938 × $89 − 0.062 × ($20 + $6) − $10 = **+$71.90**
- EV(accept) = **−$1.00** (no offers at the chargeback stage)

The engine picks **FIGHT**. It isn't auto-filed: $89 is above the $50 auto-file limit, so it waits for the seller.

Compare **H15**, an $8.50 e-book with the same strength of evidence (p_win 0.974): EV(fight) = 0.974 × $8.50 − 0.026 × $26 − $10 = −$2.39, below EV(accept) = −$1.00. The engine accepts, and auto-files it, because fighting costs more than the dispute is worth.
