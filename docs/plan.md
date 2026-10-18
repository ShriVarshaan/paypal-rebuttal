# Rebuttal: 3-Week Implementation Plan (3 people, built with Claude Code)

## Context
Rebuttal is an AI dispute desk for small PayPal sellers. It triages each dispute, pulls evidence from the seller's own records, decides whether to **fight, offer a partial refund, or accept**, and then files that response through the PayPal Disputes API. The repo (`C:\Users\varsh\Documents\paypal-hackathon`) is empty, so this is a greenfield build. The team asked for more ambition than the original pitch, a 3-week deadline, and a plan broken down by day and by person.

**Assumptions** (change them if they're wrong):
- Start Mon **Oct 19, 2026**, submit Sun **Nov 8, 2026** (Day 1 to Day 21). Feature freeze on **Day 17 (Wed Nov 4)**.
- People are called **A (Platform & PayPal)**, **B (Intelligence & Decisions)** and **C (Product, Evidence & Demo)**. Assign real names to these roles.
- Stack: TypeScript end to end, because AG Grid, the PayPal Agent Toolkit and the Anthropic SDK all have first-class TS support.

---

## 1. What "more complex" adds to the original pitch

| # | Upgrade | Why judges care |
|---|---|---|
| 1 | **Claude triage agent with tool use.** It reads the dispute, buyer messages and seller records, then proposes a structured decision with a rationale. The output is checked against a zod schema. | Best Use of PayPal + AI |
| 2 | **Expected-value decision engine.** A calibrated win-probability model feeds an EV comparison of fight, partial offer (the offer amount is optimized) and accept. It accounts for chargeback fees, labor cost and dispute-rate risk. | Measurable impact in dollars |
| 3 | **Offer optimizer.** It models the curve of buyer-acceptance probability and picks the partial-refund amount that maximizes EV. Calls `make-offer` with `REFUND`, `REFUND_WITH_RETURN` or `REFUND_WITH_REPLACEMENT`. | Uses more of the API in a smart way |
| 4 | **Evidence connectors** for the seller's own records: a mock storefront (orders, listings, versioned listing snapshots), carrier tracking through EasyPost test mode, the buyer message thread, and download/access logs for digital goods. | "Builds from the seller's own records" |
| 5 | **Evidence completeness score.** Each dispute reason has a set of required and optional evidence. The score shows what's missing before anything is filed. | Explains why the agent decided what it did |
| 6 | **Autonomy policy engine.** Per-merchant rules such as "auto-file when amount < $50 and p_win > 0.8; otherwise ask for approval". Includes human-in-the-loop approval and a full audit trail. | Responsible AI story |
| 7 | **SLA / deadline scheduler.** Tracks `seller_response_due_date`, sends escalating reminders, and forces a decision before the deadline. | Fixes the core problem of missed windows |
| 8 | **Buyer messaging agent.** Drafts de-escalation messages and sends them through `send-message` after approval. | Covers more of the lifecycle |
| 9 | **Full lifecycle across stages.** Inquiry, then chargeback/claim, then evidence, then adjudication. An **appeal** is drafted after a loss. Sandbox `require-evidence` and `adjudicate` let us show every stage on video. | Technological Implementation |
| 10 | **Evaluation harness.** 60+ labeled synthetic cases. Reports decision accuracy, Brier score, dollars recovered against three baselines, and an ablation (rules only vs. LLM vs. hybrid). | Hard evidence of impact |
| 11 | **Analytics dashboard.** Money recovered, win rate, dispute-rate trend, time-to-response and cost per case. | Visual impact |
| 12 | *(Stretch)* **Rebuttal MCP server.** Lets a seller ask "what's open and what should I do?" from Claude Desktop. | Extra AI wow factor |

---

## 2. Architecture

```
 PayPal Sandbox ──webhooks──▶ apps/api (Fastify)
   ▲  Disputes v1             ├─ /webhooks/paypal (verify-webhook-signature)
   │  Orders v2 / Payments    ├─ REST for web UI (cases, decisions, approvals)
   │  Tracking / Refunds      └─ enqueues jobs ─▶ pg-boss (Postgres queue)
   │                                                   │
   │                 apps/worker ◀─────────────────────┘
   │                  ├─ sync job (list/show via Agent Toolkit)
   │                  ├─ evidence-gather job (connectors)
   │                  ├─ triage job (packages/agent → Claude)
   │                  ├─ decision job (packages/decision)
   │                  ├─ pack job (packages/evidence → PDF)
   └──── executor ────┴─ action job (provide-evidence / make-offer / accept-claim / send-message / appeal)
                                                  │
 apps/web (Next.js + AG Grid + shadcn) ◀── Postgres (Prisma) ──▶ apps/demo-store (mock seller store)
```

**Monorepo (pnpm + turborepo):**
- `packages/core`: domain types (zod), the case state machine, the reason→evidence matrix. **This is the contract package, and it gets frozen on Day 2.**
- `packages/paypal`: OAuth token cache, a typed Disputes client (Agent Toolkit for list/show, REST for everything else), Orders, Payments, Tracking, Refunds, webhook verification, idempotency keys (`PayPal-Request-Id`), retries.
- `packages/connectors`: storefront, EasyPost, messages, download logs. Every connector implements one `EvidenceSource` interface.
- `packages/decision`: win-probability model, EV calculator, offer optimizer, policy engine.
- `packages/agent`: Claude triage, narrative writer, buyer-message and appeal agents. Uses `claude-opus-5-5` for reasoning and `claude-haiku-5-5` for classification and extraction.
- `packages/evidence`: React-to-HTML templates, Playwright HTML→PDF, pdf-lib merge, and size checks (≤10MB per file, ≤50MB per submission).
- `packages/eval`: synthetic case generator, labels, runner, metrics, report.
- `apps/api`, `apps/worker`, `apps/web`, `apps/demo-store`.
- `fixtures/`: recorded sandbox JSON for offline development and a "simulator mode".

**Core data model (Prisma):** `Merchant`, `Policy`, `Case` (paypal_dispute_id, reason, stage, status, amount, due_at, state), `CaseEvent` (audit log), `EvidenceItem` (type, source, file, required_by), `EvidencePack`, `Decision` (option, p_win, ev_fight/ev_offer/ev_accept, offer_amount, rationale, model_version, approved_by), `Action` (endpoint, idempotency_key, request, response, status), `Message`, `EvalRun`.

**Case state machine:** `NEW → GATHERING → TRIAGED → AWAITING_APPROVAL → FILING → FILED → WAITING_PAYPAL → WON | LOST | REFUNDED | OFFER_PENDING → (APPEAL_DRAFTED)`

**PayPal endpoints used:** `GET /v1/customer/disputes`, `GET /v1/customer/disputes/{id}`, `POST …/provide-evidence` (multipart), `…/make-offer`, `…/accept-claim`, `…/send-message`, `…/acknowledge-return-item`, `…/appeal`, `…/provide-supporting-info`; sandbox-only `…/require-evidence` and `…/adjudicate`; `GET /v2/checkout/orders/{id}`, `GET /v2/payments/captures/{id}`, `POST /v2/payments/captures/{id}/refund`, Shipment Tracking (`/v2/checkout/orders/{id}/track` or `/v1/shipping/trackers-batch`), `POST /v1/notifications/verify-webhook-signature`; webhooks `CUSTOMER.DISPUTE.CREATED`, `.UPDATED` and `.RESOLVED`.

---

## 3. Decision engine (B owns it; the team designs it together on Day 3)

- **Reason→evidence matrix** in `packages/core/evidence-matrix.ts`. Some examples:
  - `MERCHANDISE_OR_SERVICE_NOT_RECEIVED`: needs tracking showing delivery to the shipping address on file (PROOF_OF_FULFILLMENT); signature confirmation if amount > threshold. For digital goods: access/download logs.
  - `MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED`: listing snapshot as of order time (ITEM_DESCRIPTION), buyer messages, return policy, photos.
  - `UNAUTHORISED`: AVS/IP/device match, prior purchases from the same buyer, delivery to the verified address.
  - `CREDIT_NOT_PROCESSED`, `DUPLICATE_TRANSACTION`, `INCORRECT_AMOUNT`, `CANCELED_RECURRING_BILLING`: refund proof, the billing agreement, and so on.
- **p_win** = logistic(base rate for the reason and stage + weighted signals such as evidence completeness, delivery confirmation, a matching address, buyer dispute history, days since transaction). The LLM can move it by at most ±0.10, and only with a cited reason. Weights are hand-set first, then tuned on half the synthetic set and tested on the other half.
- **EV(fight)** = p_win·amount − (1−p_win)·chargeback_fee − labor_cost − risk_penalty(dispute ratio)
- **EV(offer x)** = P_accept(x)·(amount − x) + (1−P_accept(x))·EV(fight), where x is optimized over a grid. P_accept is an assumed curve that rises with x/amount; its parameters are a documented assumption.
- **EV(accept)** = −fees_avoided_adjustment + return_value (when it's a refund with return)
- **Policy engine** applies the merchant's autonomy rules and the deadline override (if due within 24h and no approval yet, take the safe default).

---

## 4. How the team uses Claude Code

- **Day 1:** run `/init` and write the root `CLAUDE.md`: stack, commands, conventions, and the rule that `packages/core` changes need a PR approved by all three. Each package gets its own `CLAUDE.md` describing what it owns.
- Each person works on their own branch or **git worktree** (`feat/a-*`, `feat/b-*`, `feat/c-*`) and merges to `main` daily through a PR. Run `/code-review` before every merge and `/security-review` on webhooks and auth in Week 3.
- Add the **PayPal MCP server** to Claude Code so it can query the sandbox directly while writing the client. Use **Claude in Chrome** to drive sandbox buyer accounts when creating disputes.
- Hooks: typecheck and lint run after edits. Contract-first: the zod schemas in `packages/core` are the source of truth, and Claude generates code against them.
- Even though Claude Code writes all the code, **humans own the judgment calls**: the evidence matrix, the decision weights and fee assumptions, and the ground-truth labels. Say this explicitly in the submission's "Claude Code split" section.
- Daily routine: a 15-minute standup and an end-of-day merge to `main`. Each person keeps `docs/log/<person>.md` noting what Claude did well and badly; this material goes into the writeup.

---

## 5. Day-by-day plan

### WEEK 1: Foundations and de-risking (goal: one real sandbox dispute visible in the UI by Day 7)

**Day 1 (Mon Oct 19): Setup and the day-1 risk**
- **A:** Create the PayPal developer app and the sandbox business (seller) and personal (buyer) accounts. Scaffold the monorepo (pnpm, turbo, TS, eslint, Prisma, docker-compose with Postgres). Get an OAuth token working and call `GET /v1/customer/disputes`.
- **B:** **Owns the day-1 risk.** Build a tiny checkout page (Orders v2 + JS SDK) so the buyer can pay the seller. Make 5 payments. Then open disputes from the buyer's Resolution Center (one not-received, one not-as-described). Write down every step and how long each took in `docs/sandbox-runbook.md`.
- **C:** Write the root `CLAUDE.md`. Scaffold `apps/web` (Next.js, Tailwind, shadcn) with a placeholder AG Grid table. Draft the demo storyboard (v0) so everyone knows what the video needs to show.
- **End of day:** decide whether sandbox dispute creation works. **If it doesn't**, commit to simulator mode (replay recorded fixtures plus synthetic webhooks) as the main dev path, and keep trying the real sandbox in the background.

**Day 2 (Tue Oct 20): Freeze the contracts**
- **A:** `packages/paypal` auth/token cache, a base HTTP client with retries, `PayPal-Request-Id` idempotency and error typing. Integrate the Agent Toolkit for `list_disputes` and `show_dispute`.
- **B:** Write the zod schemas in `packages/core` for Case, EvidenceItem, Decision, Action and Policy, plus the state machine (consider xstate). **The whole team reviews and freezes them by 5pm.**
- **C:** Prisma schema generated from the core types, a migration, and a seed script. Scaffold `apps/demo-store` with products, orders and a buyer messages table.

**Day 3 (Wed Oct 21): Webhooks and the decision design session**
- **A:** Fastify `apps/api` with `/webhooks/paypal`, signature verification, and a cloudflared/ngrok tunnel. Register the webhook in the dashboard and receive a real `CUSTOMER.DISPUTE.CREATED`. Store raw events.
- **B:** Run a 2-hour **team session** to agree the reason→evidence matrix and the EV formula. Then code `evidence-matrix.ts` and its unit tests.
- **C:** Demo store: product pages that keep versioned listing snapshots (title, description, photos, price, captured_at), plus order and shipment records. Seed data for 10 products.

**Day 4 (Thu Oct 22): Sync pipeline**
- **A:** pg-boss queue and `apps/worker`. Build the sync job: webhook or poll → show dispute → upsert Case → emit CaseEvent. Polling covers missed webhooks.
- **B:** Design the synthetic case schema in `packages/eval`. Write the first **20 hand-written cases** (dispute JSON, seller records and a ground-truth label with rationale).
- **C:** API routes for the case list and case detail. AG Grid queue with columns for reason, amount, stage, due-in countdown, status and recommended action, with sorting and filtering.

**Day 5 (Fri Oct 23): Transaction context**
- **A:** Orders v2 and Payments capture lookups linked to the Case. Shipment Tracking API calls to add tracking to sandbox orders.
- **B:** Win-probability model v0 (hand-set weights) and the EV calculator, with unit tests.
- **C:** Case detail page shell: timeline, dispute info, buyer messages, and an evidence checklist that reads from the matrix.

**Day 6 (Sat Oct 24): Connectors** *(lighter day)*
- **A:** `EvidenceSource` interface. EasyPost test-mode tracking connector (test codes `EZ1000000001` and up return different statuses).
- **B:** Messages connector and digital download-log connector, generated from demo-store data.
- **C:** Storefront connector (order, listing snapshot as of order time) and a Playwright screenshot of the snapshot page.

**Day 7 (Sun Oct 25): Week-1 integration**
- **Everyone:** merge to main. **Milestone check:** a real (or simulated) sandbox dispute arrives by webhook, shows in AG Grid, and has its order, tracking and listing attached. A writes fixtures for every recorded sandbox payload. Retro, then re-plan Week 2.

### WEEK 2: Intelligence and actions (goal: a full end-to-end auto-filed case by Day 14)

**Day 8 (Mon Oct 26)**
- **A:** `provide-evidence` multipart upload (input JSON with evidence_type and notes, plus PDF files) against a sandbox dispute in the evidence-required state. Use the sandbox `require-evidence` endpoint to get it there.
- **B:** `packages/agent` triage agent: Claude with tools (get_case, get_evidence, get_matrix_requirements, compute_ev). Its output is a zod-validated `TriageResult`.
- **C:** `packages/evidence` v0: an HTML cover-letter template (seller narrative, timeline, exhibit index) rendered to PDF with Playwright.

**Day 9 (Tue Oct 27)**
- **A:** Clients for `make-offer` (all offer types), `accept-claim` and `send-message`. Every call is logged as an `Action` row.
- **B:** Narrative writer agent. It turns the evidence into a persuasive, factual seller statement in which every claim cites an exhibit ID; claims without a citation are rejected.
- **C:** PDF exhibits: tracking proof, listing snapshot screenshot, message transcript, download logs. Merge with pdf-lib and enforce the size limits.

**Day 10 (Wed Oct 28)**
- **A:** Executor job: Decision → Action. Includes idempotency, retries, and a state transition on success or failure.
- **B:** Offer optimizer (P_accept curve, grid search over x) and the policy engine (autonomy rules, deadline override).
- **C:** Decision panel UI: p_win gauge, EV bars for fight/offer/accept, rationale, evidence completeness score, and Approve / Edit / Override buttons.

**Day 11 (Thu Oct 29)**
- **A:** SLA scheduler: reminder jobs at T-72h, T-24h and T-6h, and a forced decision at T-2h. Refunds API for accept paths that happen outside a dispute.
- **B:** Eval runner v1 over the 20 cases: accuracy, confusion matrix, Brier score, dollars recovered against always-fight, always-refund and rules-only baselines.
- **C:** Approval flow end to end (approve → executor), plus PDF preview in the browser and editing the narrative before filing.

**Day 12 (Fri Oct 30)**
- **A:** Lifecycle completion: handle `UPDATED` and `RESOLVED` webhooks, map outcomes to WON or LOST, handle `acknowledge-return-item`. Build a sandbox `adjudicate` helper script (seller-favor and buyer-favor).
- **B:** Expand to **60 cases**. Generate 40 more with Claude (balanced across reasons, amounts and evidence quality). **All three people label them independently**; measure inter-rater agreement and settle disagreements.
- **C:** Buyer message composer UI (drafts from the agent, sent after approval). Merchant settings page (policy thresholds, fees, labor cost).

**Day 13 (Sat Oct 31)** *(lighter day)*
- **A:** Fault injection: duplicate webhooks, a 429 or 5xx from PayPal, expired tokens. Make sure everything is idempotent.
- **B:** Calibrate weights on a 30/30 train/test split and add the ablation (rules only vs. LLM only vs. hybrid).
- **C:** Polish the UI states (loading, empty, error) and make the case queue update live (SSE or polling).

**Day 14 (Sun Nov 1): Week-2 integration**
- **Everyone:** **Milestone E2E run.** Buyer opens a dispute → webhook → gather → triage → decision → approve → provide-evidence → sandbox adjudicate → WON shown in the UI. Run it 3 times with different reasons (fight, offer and accept paths). List the bugs and triage them.

### WEEK 3: Depth, polish and the story (feature freeze Day 17)

**Day 15 (Mon Nov 2)**
- **A:** Appeal flow (`appeal` endpoint) and `provide-supporting-info`. Draft the deployment (Railway/Fly for api+worker+Postgres, Vercel for web).
- **B:** Appeal-drafting agent: on LOST, explain why and what new evidence would help. Track Claude cost and latency per case.
- **C:** Analytics dashboard: dollars recovered, win rate, dispute-rate trend, median time to respond, cost per case, plus the eval results page.

**Day 16 (Tue Nov 3)**
- **A:** Production deploy, environment secrets, webhook pointed at the deployed URL, and a smoke test against the sandbox.
- **B:** Eval report generator (markdown/HTML) with headline numbers for the pitch (e.g. "+$X recovered vs always-refund on 60 cases").
- **C:** Onboarding flow: connect PayPal (sandbox creds) → connect the store → set policy → first sync. *(Stretch: Log in with PayPal.)*

**Day 17 (Wed Nov 4): FEATURE FREEZE**
- **A:** `/security-review` and fixes. Pin rate limits and add logging/tracing.
- **B:** *(Stretch, only if green)* a Rebuttal MCP server exposing `list_cases`, `explain_decision` and `approve`. Otherwise harden the agent prompts against weird input (prompt injection in buyer messages).
- **C:** Prepare the demo data: a fresh merchant with about 8 curated live sandbox disputes in different stages. Write the video script v1.

**Day 18 (Thu Nov 5)**
- **Everyone:** bug bash. Each person runs the full demo script twice on the deployed app. A fixes infra bugs, B fixes decision and agent bugs, C fixes UI bugs.
- **C:** Record a rough video take and review it as a team.

**Day 19 (Fri Nov 6)**
- **A:** README, setup instructions, architecture diagram, and the list of API endpoints used.
- **B:** Writeup sections: AI design, the decision math, eval methodology and results, and the Claude Code split.
- **C:** Record the final video (lifecycle shown with sandbox require-evidence and adjudicate), plus slides or the submission page.

**Day 20 (Sat Nov 7)**
- **Everyone:** final edit of the video. Run fresh-clone setup on a teammate's machine. Fill in the submission form as a draft.

**Day 21 (Sun Nov 8): SUBMIT**
- Submit in the morning to leave buffer. A final check confirms the deployed URL works, the repo is public or shared, and the video link is live.

---

## 6. Ownership summary

| Area | Owner | Backup |
|---|---|---|
| PayPal clients, webhooks, queue, executor, SLA, deploy, security | A | B |
| Core contracts, evidence matrix, win model, EV/offer/policy, agents, eval | B | C |
| Web UI (AG Grid, case detail, decisions, dashboard), demo store, PDF, video | C | A |

## 7. Risks and fallbacks
- **Sandbox dispute creation is flaky or slow.** B tests this on Day 1. Simulator mode replays fixtures plus synthetic webhooks through the same code path, and the team keeps a stock of real sandbox disputes made in advance for the video.
- **Webhooks don't arrive in the sandbox.** A 60-second polling sync acts as a backstop.
- **LLM gives unstable decisions.** The math (EV) makes the decision; the LLM only adjusts p_win within limits and writes the explanation. Use temperature 0 and schema validation.
- **Scope creep.** Everything marked *(Stretch)* gets cut first. Freeze is on Day 17, no exceptions.

## 8. Verification
- Unit tests: evidence matrix, EV/offer optimizer, state machine, PayPal client (against recorded fixtures).
- Integration: `pnpm e2e:sim` runs the full pipeline in simulator mode in CI.
- Live: `scripts/sandbox-e2e.ts` creates or picks a sandbox dispute, calls `require-evidence`, lets the pipeline file, calls `adjudicate`, and asserts the Case ends up WON or LOST.
- Eval: `pnpm eval` prints accuracy, Brier score, dollars recovered against baselines, and the ablation. The pitch numbers come from this output.
