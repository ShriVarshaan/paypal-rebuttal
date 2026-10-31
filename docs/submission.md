# Rebuttal: submission

Draft for the hackathon form (role doc Day 19). A and B proofread before submitting; every number is from
`docs/eval-report.md` (`pnpm eval`, held-out split) unless marked as demo data.

## Pitch (one line)

Rebuttal is an AI dispute desk for small PayPal sellers: it gathers the seller's own evidence, does the math on fight,
partial refund or accept, and files the response through PayPal's Disputes API before the deadline.

## Problem

A small seller gets a PayPal dispute and has a few days to answer. The evidence (tracking, the listing as it was when
the buyer ordered, the message thread, download logs) lives in five different places. Answering takes time the seller
doesn't have, so many disputes are refunded by default or simply missed, and a rising dispute rate puts the PayPal account
itself at risk. Fighting every dispute isn't the answer either: some cost more in fees and time than they recover.

## How it works

1. **A dispute arrives.** PayPal's `CUSTOMER.DISPUTE.CREATED` webhook is verified and stored; a polling sync is the backstop.
2. **Evidence is gathered** from the seller's own records: carrier tracking, the order, the purchase-time listing snapshot
   and a screenshot of it, the message thread, digital access logs, checkout verification and buyer history.
3. **The math decides.** A transparent win-probability model and an expected-value engine compare fighting, the best
   partial-refund offer, and accepting, using the seller's own fees, labour cost and dispute-rate risk. Claude reviews the
   case and may nudge the win probability by at most ±0.10, only with cited exhibits.
4. **An evidence pack is built.** A PDF cover letter whose every statement cites an exhibit, followed by labeled exhibits
   (carrier scans with delivery address vs order address, the listing as the buyer saw it, the message thread, access
   logs), split per PayPal evidence type and kept under PayPal's 10MB/50MB limits.
5. **The seller approves, or the policy does.** Small, strong cases can auto-file; everything else waits for one click.
   Before a deadline, the safe default is filed so no dispute is ever missed.
6. **Rebuttal files** through PayPal's API with an idempotency key on every write, and follows the case to its outcome. A
   lost case gets an appeal draft.

## PayPal APIs used

Disputes: `GET /v1/customer/disputes` and `/{id}` (via the PayPal Agent Toolkit), `provide-evidence` (multipart),
`make-offer`, `accept-claim`, `send-message`, `appeal`, `acknowledge-return-item`, `provide-supporting-info`, and the
sandbox `require-evidence` and `adjudicate`. Also OAuth, `verify-webhook-signature`, webhooks
`CUSTOMER.DISPUTE.CREATED/UPDATED/RESOLVED`, Payments captures, Orders (including tracking), and refunds. Full table with
source links: [README](../README.md#paypal-endpoints-used).

## AI use

- **Claude Opus 5.5** triages each case through read-only tools and drafts the seller statement, buyer messages and
  appeal analyses. **Claude Haiku 5.5** labels buyer messages (admits receipt, threatening, asks refund…).
- **Bounded by design:** the expected-value engine picks the action and the amount; Claude's adjustment is capped at ±0.10
  and must cite exhibits that exist. Narrative claims without valid citations are dropped.
- **Injection-resistant:** buyer text is fenced as untrusted data, heuristics flag instruction-like text, and flagged cases
  never auto-file. On the eval's injection set, 5 of 5 decisions were unchanged.
- **Runs offline:** without an API key every agent uses a deterministic template, which is how the demo and eval run.

## Impact

On 30 held-out labeled disputes (60 total; weights tuned only on the other 30):

| Strategy | Correct decisions | Money recovered | Regret vs best choice |
|---|---|---|---|
| Always refund | 46.7% | −$30 | $2,570 |
| Always fight | 50.0% | $1,355 | $277 |
| Rules only | 73.3% | $1,775 | $168 |
| **Rebuttal** | **90.0%** | **$1,699** | **$47** |

Recovered dollars use one labeled outcome per case and are noisy (the rules-only baseline happened to recover slightly
more); regret under the world's probabilities is the stable measure, and there Rebuttal leaves $47 on the table versus
$277 for always fighting. The cases are synthetic. The dashboard in the video uses disclosed demo history.

## Product

- **Queue:** live (server-sent events), every deadline counting down, quick filters, recommendation and evidence
  completeness per row; cards on mobile.
- **Case page:** dispute and order context, a readable timeline, the evidence checklist, the decision panel (p(win),
  expected-value bars, the reasons, Claude's adjustment), the PDF preview, and approve / edit / override / reject with
  every change in the audit trail.
- **Settings** for autonomy and costs, a **dashboard** (recovered vs refund-everything, win rate, time to respond,
  deadlines missed, dispute rate vs PayPal's review level), an **eval** page, and a four-step **onboarding**.

## Built with Claude Code

Claude Code wrote the code across all three roles, with each person directing and reviewing their area. Humans own the
judgement calls: the evidence matrix, the weights and cost assumptions, the autonomy rules, the eval labels, and the
product and evidence-pack wording. Process notes: `docs/log/`.

## Team

| Role | Owns |
|---|---|
| A: Platform & PayPal | PayPal client, webhooks, worker pipeline, executor, SLA, deploy |
| B: Intelligence & Decisions | contracts, evidence matrix, win model, EV engine, agents, eval |
| C: Product, Evidence & Demo | web app, demo store, PDF evidence packs, dashboard, onboarding, demo |

## Gallery

`docs/media/`: `queue.png`, `decision-panel.png`, `pdf-cover.png`, `pdf-listing-exhibit.png`, `dashboard.png`,
`eval.png`, `case-won.png`. Regenerate with `pnpm e2e:ui --screenshots`.

## Links

- Video: _unlisted link after Day 20_
- Repo: https://github.com/ShriVarshaan/paypal-rebuttal
- Deployed app: _URL after deploy (docs/deploy.md)_
