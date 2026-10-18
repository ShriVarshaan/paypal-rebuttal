# Rebuttal

AI dispute desk for PayPal sellers. It triages each dispute, builds the evidence pack from the seller's own records, and then fights, offers a partial refund, or accepts, whichever has the best expected value.

- **Plan:** [docs/plan.md](docs/plan.md): 3-week, day-by-day, per-person plan
- **Repo:** https://github.com/ShriVarshaan/paypal-rebuttal
- **Contributing:** [CONTRIBUTING.md](CONTRIBUTING.md) · **Deploy:** [docs/deploy.md](docs/deploy.md)

## Team & roles
| Role | Owns | Person |
|---|---|---|
| A: Platform & PayPal | PayPal clients, webhooks, queue, executor, SLA, deploy | _TBD_ |
| B: Intelligence & Decisions | core contracts, evidence matrix, win model, EV/offer/policy, agents, eval | _TBD_ |
| C: Product, Evidence & Demo | web UI, demo store, PDF evidence, dashboard, video | _TBD_ |

## Setup
Needs Node 22.12+ (24 recommended, see `.nvmrc`) and pnpm (`npm i -g pnpm`). Docker is optional.

```bash
git clone https://github.com/ShriVarshaan/paypal-rebuttal.git && cd paypal-rebuttal
pnpm install                 # also generates the Prisma client
cp .env.example .env         # fill in your own sandbox credentials

pnpm db:up                   # Postgres in Docker…
pnpm db:embedded             # …or without Docker (leave it running in its own terminal)
pnpm db:migrate

pnpm paypal:ping             # token + GET /v1/customer/disputes against the sandbox
pnpm dev                     # web on :3000 + api on :3001 + worker
pnpm test                    # everything; brings its own throwaway Postgres
```

### Simulator mode (no PayPal, no network)
```bash
SIMULATOR=1 pnpm dev                                   # PayPal served from fixtures/paypal
SIMULATOR=1 pnpm sim:dispute not-received              # opens a dispute + posts its webhook
SIMULATOR=1 pnpm sandbox:lifecycle PP-D-90002 buyer    # require-evidence → (you approve) → adjudicate
pnpm e2e:sim                                           # the whole pipeline as a test
```
The simulator implements the same `PayPalClient` interface as the real client and keeps its state in `.sim/state.json`, which the api and worker share. It honours `PayPal-Request-Id` (a repeated key replays the first response) and enforces dispute state rules such as "offers only in INQUIRY". `SIMULATOR=1` and `WEBHOOK_SKIP_VERIFY=1` are refused when `NODE_ENV=production`.

## Decisions, agents and evaluation
The EV engine decides; Claude reads, advises and drafts (see [docs/decision-engine.md](docs/decision-engine.md) and [docs/writeup.md](docs/writeup.md)).

```bash
pnpm eval                      # 60 labeled cases → docs/eval-report.md (held-out accuracy, Brier, $, regret, injection set)
pnpm eval --llm                # + Claude-only and hybrid rows (needs ANTHROPIC_API_KEY; spend-capped, cached)
pnpm eval:label <your-name>    # blind labeling; then pnpm eval:agreement
pnpm checkout                  # sandbox checkout for making real disputes (docs/sandbox-runbook.md)
```

Without `ANTHROPIC_API_KEY` every agent uses its deterministic template, so the whole pipeline runs offline. Merchant policy (autonomy limits, fees, labour) is `GET/PUT /policy`.

## Architecture
```
 PayPal sandbox ──webhooks──▶ apps/api ── verify-webhook-signature, dedupe on event id
     ▲                           │  enqueue dispute.sync
     │                           ▼
     │                    pg-boss (same Postgres)
     │                           │
     │   apps/worker ◀───────────┘
     │    dispute.poll (every 60s, update_time_after) ─▶ dispute.sync ─▶ Case + CaseEvents, SLA jobs
     │    case.enrich (capture → order → shipping, trackers) ─▶ case.gather (EasyPost, …)
     │    case.triage (B) ─▶ Decision ─▶ approve (api) ─▶ action.execute ◀─ pack.ready (C)
     └─── action.execute: Action row first, then provide-evidence / make-offer / accept-claim
          sla.fire: reminders at T-72/24/6h, policy safeDefault at T-2h

 apps/web :3000 ── server-side read routes (Day 4) ──▶ apps/api :3001
```

**Safety rails.** Every PayPal write sends `PayPal-Request-Id` = `caseId:decisionId:ACTION` and reuses it on retries. An `Action` row is written before the call. A partial unique index allows only one `SUCCEEDED` action per case and kind. Retries use backoff with jitter and honour `Retry-After` (at most 4 attempts). A 401 refreshes the token once. Evidence must be PDF/PNG/JPG, ≤10MB per file and ≤50MB per submission, checked before upload. The client refuses live PayPal hosts.

## PayPal endpoints used
| Endpoint | Where |
|---|---|
| `POST /v1/oauth2/token` | [packages/paypal/src/auth.ts](packages/paypal/src/auth.ts) |
| `GET /v1/customer/disputes` (Agent Toolkit `list_disputes`, REST for time windows/pages) | [packages/paypal/src/disputes.ts](packages/paypal/src/disputes.ts), [toolkit.ts](packages/paypal/src/toolkit.ts) |
| `GET /v1/customer/disputes/{id}` (Agent Toolkit `get_dispute`, REST fallback) | same |
| `POST …/{id}/provide-evidence` (multipart) | `disputes.provideEvidence`, called by [apps/worker/src/jobs/execute.ts](apps/worker/src/jobs/execute.ts) |
| `POST …/{id}/make-offer` | `disputes.makeOffer`, executor |
| `POST …/{id}/accept-claim` | `disputes.acceptClaim`, executor |
| `POST …/{id}/send-message` | `disputes.sendMessage` |
| `POST …/{id}/acknowledge-return-item` | `disputes.acknowledgeReturnItem` |
| `POST …/{id}/appeal` (multipart) | `disputes.appeal` |
| `POST …/{id}/provide-supporting-info` (multipart) | `disputes.provideSupportingInfo` |
| `POST …/{id}/require-evidence` (sandbox) | `disputes.requireEvidence`, [scripts/sandbox/require-evidence.ts](scripts/sandbox/require-evidence.ts) |
| `POST …/{id}/adjudicate` (sandbox) | `disputes.adjudicate`, [scripts/sandbox/adjudicate.ts](scripts/sandbox/adjudicate.ts) |
| `GET /v2/payments/captures/{id}` | [packages/paypal/src/orders.ts](packages/paypal/src/orders.ts), [apps/worker/src/jobs/enrich.ts](apps/worker/src/jobs/enrich.ts) |
| `POST /v2/payments/captures/{id}/refund` | `payments.refund` |
| `GET /v2/checkout/orders/{id}` | `orders.get`, enrich job |
| `POST /v2/checkout/orders/{id}/track` | `orders.addTracking`, [scripts/sandbox/add-tracking.ts](scripts/sandbox/add-tracking.ts) |
| `POST /v1/notifications/verify-webhook-signature` | [packages/paypal/src/webhooks.ts](packages/paypal/src/webhooks.ts), [apps/api/src/routes/webhooks.ts](apps/api/src/routes/webhooks.ts) |
| Webhooks `CUSTOMER.DISPUTE.CREATED / UPDATED / RESOLVED` | [apps/api/src/routes/webhooks.ts](apps/api/src/routes/webhooks.ts) |

## Status
Platform (A) and intelligence (B) are built and tested (`pnpm test`: core, decision, connectors, agent, eval, MCP, worker, api, including a simulator end-to-end run with real triage). C's Week 1 web shell and temporary responsive queue are available at `http://127.0.0.1:3000/queue`; API-backed queue/detail data, the demo store, and evidence screenshots are still in progress. PDF evidence packs remain later work. The repository is also waiting on team sign-off for shared `packages/core` and Prisma changes, the blind labeling round, and live sandbox credentials. See `CLAUDE.md`.
