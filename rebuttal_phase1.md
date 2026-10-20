# Rebuttal — Week 1 Implementation Plan, v2
### Complete handoff for GPT-6 at Max effort


This replaces the previous plan in full. **No implementation or repository changes have been made.**

Your approval completes the checkpoint before **planning Day 7**, so this revision includes that section. It does not authorize this planning chat to begin implementation.

## 1. Objective, boundaries, and execution rules

### What to deliver

Complete Person C’s Week 1 work, October 19–25, 2026:

- Next.js application shell with light/dark themes.
- Persistent case queue with filtering, sorting, polling, and responsive presentation.
- Case detail with transaction context, timeline, and evidence checklist.
- Compatible database additions and repeatable synthetic seeds.
- A separate demo store with immutable historical listings.
- Storefront evidence collection and reproducible listing screenshots.
- A verified webhook → worker → store evidence → browser integration milestone.
- Storyboard, working setup documentation, and checkpoint records.

Use the [Person C brief](<C:/Users/sriha/Desktop/Srihari/Coding/Git repos/paypal-rebuttal/docs/roles/person-c-product.md>) and [project plan](<C:/Users/sriha/Desktop/Srihari/Coding/Git repos/paypal-rebuttal/docs/plan.md>) as scope references. Reconcile them with the code before editing: several tasks described as new work already exist.

### Existing work to preserve

The repository already contains the PayPal client, webhooks, simulator, worker pipeline, decision engine, evidence matrix, case API, approval endpoint, decision PATCH endpoint, policy endpoints, and several connectors.

Extend those implementations. Do not replace working endpoints with stubs or create competing versions of shared logic.

The runtime remains **single merchant**. Add compatible merchant structure without introducing authentication, tenant isolation, or per-merchant PayPal connections.

### Outside Week 1

Do not implement PDF evidence packs, decision editing/approval UI, filing through the UI, buyer-message composition, policy settings, dashboard analytics, eval charts, onboarding, deployment, or appeals UI.

Navigation placeholders and storyboard descriptions of those future capabilities are included. The existing backend functionality remains intact.

**Day 7 ends with evidence visible in the UI. It does not require filing or adjudicating a dispute.**

### Changes from v1

This revision:

1. Adds Day 7 after your planning confirmation.
2. Defines API behavior and checkpoint rules more precisely.
3. Tightens order matching so unresolved identifiers cannot silently attach another order.
4. Adds a shared listing renderer for HTTP and offline screenshot capture.
5. Separates synthetic seed data from integration data and prevents seed commands from triggering execution.
6. Makes database migration, browser authentication boundaries, and test isolation explicit.

### Rules

1. Reinspect repository state before starting; newer teammate changes take precedence over stale implementation assumptions.
2. Read the relevant repository instructions and plan section before each milestone.
3. Work sequentially on focused `c/*` branches. Preserve unrelated changes, including the currently modified `.gitignore`.
4. Do not create subagents, new chats, or change model settings unless the user requests it.
5. Use existing core types and helpers. Do not recreate the state machine, evidence scoring, money conversion, decision math, or exhibit numbering in the frontend.
6. A technical checkpoint passes only when its acceptance tests pass. Continue automatically after passing; ordinary daily checkpoints do not require another user confirmation.
7. Shared core-contract changes require A+B+C approval under repository instructions. Plan approval by one person does not establish all three approvals.
8. Complete the repository-required `/code-review` before PR creation. If that workflow is unavailable, report the unmet prerequisite and pause PR creation while continuing authorized local work.
9. Do not merge without required repository reviews. Do not message teammates unless the user explicitly authorizes it.
10. Stop after the Week 1 milestone. Do not begin Week 2.

After each milestone, update a new `docs/log/c.md` entry containing:

- Completed work and branch/commit, when applicable.
- Commands actually run and their results.
- Screenshots or evidence of browser validation.
- Remaining failures and pending approvals.
- The exact next task.

Never mark a blocked or partially tested milestone complete.

## 2. Architecture, tools, and setup

### Application boundaries

```text
Browser
  → Next.js web :3000
  → allowlisted server-side API routes
  → existing Fastify API :3001
  → existing Postgres and worker pipeline

Worker storefront connector
  → fixture client OR demo-store HTTP API :3002
  → order + purchase-time listing snapshot
  → shared listing renderer / historical page
  → Playwright Chromium
  → local PNG evidence

Postgres
  public: Rebuttal application records
  store:  mock seller records
```

- Browser code never receives `API_TOKEN`, `STORE_API_TOKEN`, PayPal secrets, or database credentials.
- The web app communicates with Fastify through server-side routes. Week 1 routes allow only the required reads.
- Fastify remains responsible for case queries and evidence-file access.
- The demo store owns its seller records and implements the existing connector contract.
- Use the existing Prisma package and migration history for both database schemas. Keep existing models in `public`; put store models in `store`. [Prisma multi-schema documentation](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/multi-schema)
- Add a small shared package, `@rebuttal/storefront`, for the listing component, styles, and server rendering. It must not depend on either Next.js app, Prisma, or the connectors package.
- Put the shared listing-snapshot contract in core, subject to its approval requirement. Both connectors and the renderer consume it.
- Keep browser-safe exports separate from Node-only rendering and filesystem code.

### Design tools and visual specification

Use:

| Tool/skill | Required use |
|---|---|
| `architect` | Review substantial implementation choices against this plan |
| `minimalist-ui` | Define typography, surfaces, spacing, controls, and restrained motion |
| Google Stitch MCP | Create a dedicated Rebuttal project and screen references |
| `imprint` | Update `ui-registry.md` after reusable component families are implemented |
| `mcp__cua_repl` | Inspect and exercise the actual running UI |
| Playwright package | Browser tests and application screenshot generation |

Stitch is connected and has been verified. Do not modify unrelated Stitch projects.

Create `DESIGN.md` before main-screen implementation:

- Light-first, calm workspace; dark theme supported.
- Geist Sans for text; Geist Mono for IDs and numeric metadata.
- Warm neutral canvas, white surfaces, charcoal text, restrained teal accent.
- Semantic red/amber/green for status; labels and icons accompany color.
- Small corner radii, quiet borders, restrained shadows.
- Desktop sidebar: 224px. Mobile navigation: drawer.
- Interactive targets: at least 44px where applicable.
- Honor reduced motion; avoid animations that restart whenever data polls.
- No invented business metrics, decorative charts, or marketing hero inside the dispute application.

Stitch sequence:

1. Create the dedicated project.
2. Upload `DESIGN.md` and create the design system.
3. Generate desktop queue, desktop detail, mobile queue/detail, and store listing references.
4. Implement with actual shadcn components and AG Grid Community.
5. Compare rendered screenshots against the references and record deliberate differences.

AG Grid remains Community-only. Do not install Enterprise modules. [AG Grid edition comparison](https://www.ag-grid.com/react-data-grid/community-vs-enterprise/)

### Accounts and access

| Timing | Account/access | Required action |
|---|---|---|
| Before the first PR | GitHub | Verify repository push and PR access |
| Day 1 | Google Stitch | No new account action currently needed |
| Prepare during Days 1–3 | PayPal Developer | Create/use a sandbox REST app, Business seller, and Personal buyer |
| When A connects webhooks | PayPal sandbox app | Configure its webhook and supply `PAYPAL_WEBHOOK_ID` locally |
| Day 6, optional | EasyPost | Supply a test key only if testing the real carrier API |
| Later weeks | Anthropic | Supply an API key only when live model calls are wanted |

PayPal sandbox setup is documented in its [REST getting-started guide](https://developer.paypal.com/api/get-started/). EasyPost’s [test trackers](https://docs.easypost.com/docs/trackers) provide controlled delivery states.

No hosted database, hosting platform, object storage, paid AG Grid, or Figma account is needed for Week 1. A Cloudflare Quick Tunnel can support webhook testing without a new account. [Cloudflare Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

Secrets belong in local `.env`, not the plan, source code, screenshots, or chat. Request missing access when its task becomes actionable; continue simulator work meanwhile.

### Baseline setup — checkpoint C0

1. Inspect branch, working tree, applicable instructions, and dependency versions.
2. Keep Node 24. Align pnpm with the repository pin, currently `12.14.0`; the inspected executable reports `11.25.0`.
3. Install dependencies. Do not broadly upgrade the existing backend toolchain.
4. Create local `.env` from its template. Dependencies and `.env` were absent during planning.
5. Start embedded Postgres by default, then apply existing migrations.
6. Run existing typecheck, lint, and tests once; record pre-existing failures separately.
7. Configure local simulator development with deterministic agents.
8. Ensure new Next.js processes load root environment configuration without exposing secrets. Explicitly set web/store ports so root `PORT=3001` does not redirect them to the API port.
9. Bind the new development apps to loopback. Public deployment and application login are outside this plan.

**C0 passes:** the existing API/worker run and baseline verification is recorded.

## 3. Implementation milestones

### Day 1 — Application scaffold and storyboard

**Branch:** `c/web-scaffold`

1. Replace the web placeholder with Next.js App Router, TypeScript, Tailwind, shadcn/ui, TanStack Query, and AG Grid Community.
2. Resolve compatible stable frontend dependencies once and record versions in the lockfile. Do not repeatedly upgrade them during implementation.
3. Use a Next.js-specific TypeScript configuration; preserve backend NodeNext configuration.
4. Complete the design workflow above.
5. Build routes:
   - `/` redirects to `/queue`.
   - `/queue` contains the grid.
   - `/dashboard`, `/eval`, and `/settings` contain explicit future-feature states.
   - `/cases/[id]` is initially a navigable shell.
6. Build sidebar, merchant header, notifications control, theme switch, and mobile drawer. The notifications control initially shows an honest empty state.
7. Build reusable reason labels, state badges, money display, deadline display, progress indicator, and loading/error/empty components.
8. Populate the scaffold with five clearly synthetic rows. This temporary data must be removed from the connected queue on Day 4; it must never become a fallback for failed API requests.
9. Add web on port 3000 to the root development command. Configure workspace transpilation and Turbo’s Next.js build outputs.
10. Smoke-test importing core schemas in the web app and verify that Node-only modules are absent from browser bundles.
11. Review 2–3 verified winning hackathon demos for pacing.
12. Write `docs/demo-storyboard.md`:

| Time | Beat | Required screens |
|---|---|---|
| 0:00–0:20 | Seller problem and missed deadline | Queue, urgent case |
| 0:20–0:40 | What Rebuttal does | Shell |
| 0:40–1:40 | Full lifecycle story | Queue/detail now; decisions/PDF/filing later |
| 1:40–2:10 | Offer and accept examples | Future decision panel |
| 2:10–2:40 | Measured impact | Future dashboard/eval |
| 2:40–3:00 | Technology and close | Architecture/end card |

Mark each screen as Week 1, later week, or dependency. Keep outcome and evaluation numbers unfilled until supported.

**Checkpoint C1:** shell, navigation, grid, themes, mobile menu, and storyboard work; no hydration errors or accidental secret exposure.

### Day 2 — Database additions and demo-store scaffold

**Branches:** `c/db`, then `c/demo-store`

#### Application database

1. Reconcile existing Prisma models with core and their callers. Preserve applied migrations and the Action partial unique index.
2. Add:
   - `Merchant`: fixed ID `default`, name, default currency, timestamps.
   - `Case.merchantId`: default `default`, relation, and merchant/state index.
   - `Policy.merchantId`: relation to the default merchant; retain `Policy.id = "default"`.
   - `Message`: case relation, source, deduplication key, sender, channel, text, nullable sent timestamp.
   - `EvalRun`: dataset/strategy/model identifiers, timestamps, and result JSON.
3. Keep existing case-message JSON authoritative this week. Do not introduce dual writes or replace worker message handling.
4. `EvalRun` is schema groundwork only; dashboard/eval ingestion remains later work.

#### Migration ordering

5. Use new migrations only:
   - Create the merchant table and insert the default merchant.
   - Add/backfill merchant columns.
   - Apply defaults, constraints, relations, and indexes.
   - Add remaining application and store tables.
6. Insert the default merchant in the migration itself. Existing workers and tests must be able to create a case without first running the demo seed.
7. Add schema annotations to existing Prisma models/enums while keeping their physical tables in `public`.
8. Inspect generated SQL. Reject any accidental drop/recreate of existing tables, enums, or indexes. Keep pg-boss’s schema outside Prisma ownership.

#### Store database

9. Add store models for products, listing snapshots, orders/items, shipments, message threads/messages, download events, customers, refunds, and subscriptions.
10. Use distinct Prisma model names where necessary, such as `StoreMessage`.
11. Orders retain invoice, capture, and PayPal order identifiers. Order items retain product and purchase-time snapshot references.
12. Snapshots contain immutable title, description, price/currency, attributes, asset references, capture time, revision, and renderer version.
13. Use integer minor units, currency codes, timestamptz fields, and JSON where appropriate.

#### Shared contracts and seed

14. Prepare additive core schemas for merchant summary, queue/detail transport data, serializable checklist data, and listing snapshots. Reuse existing `DecisionRecord`, `CaseEventRecord`, money, state, and evidence definitions.
15. Obtain the required A+B+C review before landing shared contracts and the coordinated schema changes.
16. Add a new root `db:seed` command. It must:
   - Be idempotent and local-demo-only.
   - Create one merchant, a validated default policy, and five synthetic cases.
   - Use clearly separate demo IDs, never the simulator’s existing dispute IDs.
   - Cover gathering, approval, urgency, won, and lost.
   - Compute recommendations through pure decision-engine functions.
   - Call no PayPal client, enqueue no jobs, and create no successful Action rows.
   - Preserve non-seed records and an existing user-edited policy.
   - Keep timestamps stable on rerun; tests use an injected clock.
17. Scaffold the demo-store app on port 3002, including product, product-edit, and order-admin shells.
18. Add the store to `pnpm dev`.

**Checkpoint C2:** fresh and upgrade migrations pass; original worker create paths still work; the default merchant exists without seeding; repeat seeding creates no duplicates; both apps boot. Record any outstanding contract approval explicitly.

### Day 3 — Historical listings, store API, and seed catalog

**Branch:** `c/store-snapshots`

1. Use the fictional shop **Fern & Field Goods**.
2. Build `@rebuttal/storefront` with:
   - Shared listing component and CSS.
   - A versioned renderer, initially version 1.
   - A Node-only HTML-rendering entry point for offline screenshots.
   - Bundled, immutable assets and fonts.
3. Both current and historical store pages use that renderer. Current product fields must never leak into historical rendering.
4. Implement transactional product creation/editing. Each publication/edit creates a new immutable snapshot; editing never rewrites an earlier snapshot.
5. Order items retain their original snapshot reference. A later product edit cannot change order history.
6. Implement these additional store reads:

| Route | Result |
|---|---|
| `GET /api/products/:id` | Product with current snapshot |
| `GET /api/orders/:id/shipments` | Shipment records |
| `GET /api/products/:id/snapshots?at=<iso>` | Snapshot effective at that instant |
| `GET /snapshots/:productId?at=<iso>` | Compatibility route using the same lookup |
| `/p/:productId/snapshot/:snapshotId` | Historical HTML page |

7. As-of lookup chooses the greatest snapshot timestamp at or before the requested instant; revision breaks timestamp ties. Invalid time returns 400; no historical version returns 404. Never fall back to the current listing.
8. Implement all existing reads in the [Store API contract](<C:/Users/sriha/Desktop/Srihari/Coding/Git repos/paypal-rebuttal/packages/connectors/STORE_API.md>): order lookup, messages, access logs, refunds, subscription, and customer.
9. Use the existing bearer-token convention for private store APIs. Keep tokens server-side. Product listing pages contain only fictional public catalog content.
10. Extend the fixture client and HTTP client together. Contract tests must exercise both against equivalent data.
11. Seed ten featured products:
    - Seven physical products spanning ceramics, prints, and apparel/accessories.
    - Three digital products: pattern PDF, preset pack, course.
12. Preserve the existing headphones, jacket, and e-book fixture orders with their exact names, amounts, IDs, and checkout data. Keep their legacy catalog records outside the ten featured products.
13. Seed at least two purchase histories with edits after ordering, plus unchanged and missing-history cases.
14. Map B’s real sandbox purchases only from supplied payment identifiers and actual amounts. Do not invent completed payments or assume the runbook’s sample values match fixtures.
15. Join the matrix review with seller-facing examples of found, weak, and missing evidence. Record wording decisions; do not adjust weights or thresholds.

**Checkpoint C3:** current/historical pages share rendering; old snapshots survive edits; HTTP and fixture clients agree; all existing connector endpoint shapes remain valid.

### Day 4 — Case API and connected queue

**Branch:** `c/queue`

#### API behavior

1. Extend the existing `GET /cases`, preserving its array response for MCP compatibility.
2. Support:

| Parameter | Rule |
|---|---|
| `state` | Existing CaseState value |
| `reason` | Exact reason string |
| `q` | Trimmed search over case/dispute IDs, invoice numbers, and transaction references |
| `sort` | `dueAt:asc`, `dueAt:desc`, `amount:asc`, `amount:desc`, `createdAt:asc`, `createdAt:desc` |
| `take` | Integer 1–200; preserve existing default 100 |
| `skip` | Nonnegative integer; default 0 |
| `needsApproval` | Boolean filter |
| `dueWithinHours` | Positive bounded integer; quick filter uses 24 |

3. Return `X-Total-Count` for the complete filtered result before pagination.
4. Default ordering: deadline ascending, null deadlines last, creation time descending, ID ascending.
5. When sorting amounts across currencies, group by currency before comparing minor-unit values. Do not imply exchange-rate conversion.
6. Invalid query values return 400, not an internal server error.
7. “Needs approval” means the case awaits approval and its latest non-rejected decision is PROPOSED.
8. “Due within 24h” includes overdue active cases and excludes terminal cases.
9. Add `GET /merchant` for default merchant display data.
10. Add each row’s latest non-rejected decision summary, buyer pseudonym, and current completeness. Use batched relation reads.

#### Web behavior

11. Add explicit server-side proxy routes under `/api/rebuttal`. Forward only allowed read endpoints, relevant query parameters, status codes, and pagination metadata.
12. Validate responses using shared schemas. Browser projections exclude raw payloads, filesystem paths, credentials, and unnecessary action request/response bodies.
13. Replace scaffold rows with TanStack Query results.
14. Poll every ten seconds while visible. Preserve rows during background refresh; show stale/error status when refresh fails.
15. Implement the eight columns: Due in, Reason, Amount, Stage, State, Recommendation/pWin, Evidence, Buyer.
16. Use core money helpers, including `minorUnitDigits`; never universally divide amounts by 100. Preserve the distinction between zero and missing pWin.
17. Use one shared clock for countdowns. Show no-deadline and overdue states. Terminal cases do not pulse.
18. Add server-backed filters, search, sorting, and 50-row pages. Preserve controls in the URL. Disable sorting for columns without server support.
19. Add Needs approval, Due <24h, Won, and Lost quick filters.
20. Support row click and keyboard navigation. Below 768px, render equivalent case cards.
21. Preserve the existing approve and PATCH routes. Add deterministic 501 compatibility stubs for the brief’s reject/override POST routes; they must not mutate anything. Do not expose these actions in the Week 1 UI.

**Checkpoint C4:** filters operate across all records; counts and pagination agree; polling preserves UI state; the existing MCP client still parses the response; no sample-data fallback conceals an error.

### Day 5 — Case detail and evidence checklist

**Branch:** `c/case-detail`

1. Extend the existing detail response additively; preserve its decision array for existing consumers.
2. At widths of at least 1280px, render three columns; below that, stack:
   - Dispute and transaction context.
   - Timeline.
   - Evidence checklist and preview.
3. Include reason, stage, internal state, PayPal status, amount, dates, claim, order/items, shipping, and tracking.
4. Merge case events and messages into a stable chronological timeline. Use the existing message-merging helper; distinguish undated messages and avoid showing the same message twice.
5. Show action outcomes using a safe summary, including a debug ID when available.
6. Compute checklist data using `matrixContext`/existing classification helpers and `assessCompleteness`.
7. Presentation states:
   - **Found:** the requirement predicate is satisfied.
   - **Weak:** relevant evidence exists but fails the predicate.
   - **Missing:** no relevant evidence exists.
8. Respect alternative evidence kinds accepted by a requirement. Do not duplicate scoring logic or award partial credit for “weak.”
9. Show required/strong/nice tiers, collection hints, and linked evidence.
10. Use `assignExhibits` for current checklist labels. If displaying a stored decision’s citations, use its stored exhibit mapping rather than renumbering that historical analysis.
11. Add `GET /cases/:caseId/evidence/:evidenceId/file`:
    - Apply existing API-token authentication.
    - Verify the evidence belongs to the requested case.
    - Resolve the stored path server-side.
    - Confirm it is inside the configured evidence directory.
    - Serve supported media or return an explicit unavailable/not-found response.
12. Proxy that file route through the web server without revealing the path.
13. Render untrusted claims and messages as text. Show missing context and unavailable screenshots explicitly.
14. Keep the decision panel as a clearly labeled Week 2 placeholder.

**Checkpoint C5:** physical, digital, partially enriched, and missing-evidence cases render; score/checklist agree with core; links open the correct exhibit; keyboard/mobile behavior works.

### Day 6 — Storefront connector and screenshot capture

**Branch:** `c/storefront-evidence`

#### Matching and evidence

1. Implement and register the storefront `EvidenceSource`.
2. Resolve exact invoice, capture, or PayPal order identifiers first:
   - All identifiers that resolve must point to the same order.
   - Conflicting identifiers produce an explicit unresolved result.
   - If identifiers were supplied but no exact match exists, do not silently use an approximate match.
3. Amount/time fallback is permitted only when exact identifiers are absent:
   - Same merchant, currency, and total.
   - Order placed within five minutes of a valid payment/order timestamp.
   - Any available item/SKU information agrees.
   - Exactly one candidate.
   - Never use dispute creation time as purchase time.
4. Missing or ambiguous matches produce no attached order evidence and an observable diagnostic.
5. Respect the existing primary-transaction model. Do not silently combine unrelated orders from a multi-transaction dispute.
6. Produce:
   - `order` evidence with `ORDER_DETAILS`.
   - One purchase-time `listing_snapshot` item per matched order item with `ITEM_DESCRIPTION`.
   - Shipment facts within the order evidence; verified carrier status remains EasyPost’s responsibility.
7. Prefer the order item’s pinned snapshot; verify its time is not after purchase. For legacy records without a pin, use as-of lookup.
8. Reject missing/invalid historical dates rather than relying on the matrix’s permissive fallback.
9. Compare original and current title/description. Emit a separate `OTHER` item with both snapshot references and a factual diff. Do not disguise the diff as another qualifying listing snapshot or introduce a new core evidence-kind enum casually.

#### Source selection

10. Add and document:

| Variable | Behavior |
|---|---|
| `STORE_SOURCE=auto` | Preserve current selection: simulator uses fixtures; otherwise configured HTTP store |
| `STORE_SOURCE=fixtures` | Force fixtures |
| `STORE_SOURCE=http` | Require HTTP store configuration, even with PayPal simulation |
| `STORE_WEB_URL` | Trusted origin for historical pages; default local store |
| `EVIDENCE_STORAGE_DIR` | Evidence directory, resolved consistently from repository root |

HTTP failures must remain failures. Do not fall back silently to unrelated fixture records.

#### Screenshots

11. Use an injectable capture service with two adapters:
    - HTTP mode: screenshot the immutable historical store page.
    - Fixture mode: render the same versioned component and CSS to standalone HTML, embed bundled assets, then capture with Playwright.
12. Fixture capture must work without a running Next.js store or external network.
13. Capture PNG at 1280px viewport width, device scale factor 1, full page, fixed light theme and locale, reduced motion, and loaded fonts/images. [Playwright screenshots](https://playwright.dev/docs/screenshots)
14. Construct URLs from trusted configuration and validated IDs. Reject redirects or asset loads outside the permitted origins/assets.
15. Store under `storage/evidence/<caseId>/` with snapshot- and renderer-based filenames.
16. Use stable deduplication keys, atomic writes, and bounded concurrency. Close browser resources on failure/shutdown.
17. Reuse a valid existing capture on retry.
18. Record snapshot publication time and screenshot capture time separately.
19. If capture fails or exceeds the permitted file size, retain valid structured evidence, attach no invalid file, and expose capture status/error metadata.
20. Add Playwright Chromium installation instructions and CI support. Existing unit tests inject a fake capture service; real browser tests are explicit.
21. Preserve existing `.gitignore` edits while adding generated evidence/test-output exclusions.

**Checkpoint C6:** historical content, screenshot, and diff agree; HTTP and fully offline capture work; repeated gather does not duplicate evidence; failures remain visible without discarding valid structured data.

### Day 7 — Integration and Week 1 handoff

**Branch:** `c/week1-integration`

**Planning permission:** confirmed by the user. Implementation begins only in the later implementation session.

1. Reconcile the reviewed A/B/C changes on the integration branch. Resolve conflicts without altering decision rules or replacing teammate work.
2. Confirm C0–C6 results and required shared-contract approvals. Document anything still blocked.
3. Build a dedicated automated Week 1 integration harness:
   - Temporary Postgres database with real migrations.
   - Real pg-boss and worker handlers.
   - Real HTTP Fastify API.
   - Real demo-store HTTP API and Next.js web app.
   - Isolated simulator state file.
   - Seeded store records, but **no precreated case for the dispute being tested**.
   - Deterministic agents and offline carrier tracking.
4. Configure the harness policy to disable ordinary autonomy, with test deadlines at least 72 hours away. Do not change repository policy defaults.
5. Disable scheduled polling for the webhook-specific assertion. The existing fixed-date fixture disputes must not enter the test through background polling.
6. Inject a fresh simulated CREATED webhook for a matching purchase. Verify:
   - Exactly one Case is created.
   - Enrichment attaches payment/order context.
   - HTTP store lookup succeeds.
   - Tracking and purchase-time listing evidence are stored.
   - Screenshot capture succeeds.
   - Triage produces a proposal.
   - The queue shows the case without manual reload.
   - Case detail exposes the correct evidence and historical content.
7. Verify a changed-listing case: the historical screenshot differs from the current listing in the expected fields; the diff names the correct versions.
8. Verify a digital case uses access evidence and the digital checklist.
9. Replay the identical webhook event ID. Confirm no duplicate case/evidence and no extra execution.
10. Assert the target Week 1 case has no PayPal write Action. Do not approve, require evidence, adjudicate, or create a fake PDF to make this milestone pass.
11. Keep the existing `e2e:sim` regression intact. Its stub pack verifies backend behavior; it does not prove C’s future PDF implementation exists.
12. Run the manual storyboard through the screens built this week. Mark future-week beats as pending rather than simulating completed functionality.
13. If sandbox access and a suitable fresh dispute are available, repeat the read/gather/UI milestone with A/B’s case using verified webhooks. Use an isolated database, disabled background polling, and a future deadline.
14. If the real sandbox run is unavailable, record the simulator result honestly and list the missing access or sandbox condition. The original Week 1 milestone permits simulation.
15. Write `docs/week1-integration.md`: environment, versions, fixture/case identifiers, assertions, screenshots, failures, and remaining Week 2 work.
16. Complete required review and CI before merging. Finish with the Week 1 report; do not start Week 2.

**Checkpoint C7:** webhook-driven data appears in the browser with order, tracking/access, historical listing, and screenshot evidence; duplicate delivery is safe; no filing is required.

## 4. Verification and command requirements

### Commands to add during implementation

These are **planned commands**, not claims that they already work:

| Command | Purpose |
|---|---|
| `pnpm db:seed` | Idempotent synthetic application/store seed |
| `pnpm browser:install` | Install the pinned Chromium browser |
| `pnpm test:ui` | Web/store browser tests |
| `pnpm e2e:week1` | Isolated full Week 1 integration harness |

Update existing `pnpm dev` to start web :3000, API :3001, worker, and store :3002. Add build/typecheck scripts for the new packages and apps.

Ensure migration and seed commands load the intended root environment. Do not let Prisma silently use a default database when another `DATABASE_URL` was intended.

Use PowerShell-compatible environment instructions on this machine; do not copy Bash-only `NAME=value command` examples into its runbook.

### Required scenarios

| Area | Required checks |
|---|---|
| Database | Fresh install; upgrade; default merchant without seed; uniqueness preserved; seed rerun |
| Snapshots | Initial version; multiple edits; exact-time boundary; immutable assets; wrong product ID; no historical record |
| Store clients | Fixture/HTTP parity; 404 behavior; invalid JSON; unauthorized access; network failure |
| Matching | Exact IDs; conflicting IDs; unresolved supplied IDs; unique fallback; ambiguous fallback; currency/time mismatch |
| Queue | Invalid inputs; combined filters; stable sorting; pagination totals; null/overdue deadlines; MCP compatibility |
| Detail | Physical/digital parity; weak versus missing; alternative evidence; nullable pWin; duplicate messages; unavailable preview |
| Capture | HTTP and offline render; loaded assets; retry; timeout; missing Chromium; oversized file; storage/origin validation |
| Browser | Desktop, tablet, 390px mobile; both themes; keyboard; reduced motion; loading/empty/error; polling |
| Integration | Real queues and HTTP; new webhook; changed listing; digital case; duplicate delivery; no unintended Action |

### Test execution policy

- Run focused tests after each meaningful subsystem change.
- Run typecheck and lint for affected code.
- Format changed files only.
- Before final delivery, run the complete existing suite, new browser/integration suites, and production builds.
- Add appropriate build and browser steps to CI; install Chromium explicitly.
- Use isolated databases and simulator state. Never reset a developer database or shared simulator file as test cleanup.
- Use existing embedded-Postgres helpers and worker dependency injection.
- Test doubles are appropriate for unit tests. The Day 7 acceptance harness must exercise real HTTP and worker behavior.
- No automated test calls live PayPal, EasyPost, or Anthropic services.
- Do not weaken assertions, skip failures, disable type checking, or insert fabricated success records to obtain a passing result.

## 5. Completion record and final handoff

The final report must contain:

1. A C0–C7 status table: passed, blocked, or incomplete.
2. Features implemented and their local URLs.
3. Exact verification commands and outcomes.
4. Review/approval status for shared contracts and PRs.
5. Whether Day 7 ran in simulator mode, real sandbox mode, or both.
6. Known defects and the next Week 2 tasks.
7. Links to storyboard, design registry, integration report, and changed artifacts.

Keep README commands/layout, environment documentation, Store API documentation, and Person C’s log current. Document commands only after verifying them.

**Completion means:** a clean local setup can reproduce the Week 1 evidence-gathering experience, with genuine pipeline data in the queue and detail screens, preserved historical listings, and inspected screenshot evidence.

**Current status:** planning complete; implementation not started. Runtime verification remains pending because dependencies are not installed in the inspected checkout.
