# Person C implementation log

## 2026-10-19 — Checkpoint C0: baseline setup

- Status: **passed**.
- Branch: `c/web-scaffold` (no milestone commit yet).
- Preserved pre-existing worktree changes: `.gitignore` and untracked `rebuttal_phase1.md`.
- Environment: Node `v24.19.0`, repository-pinned pnpm `12.14.0`, embedded PostgreSQL 17.5.
- Local mode: `SIMULATOR=1`, deterministic template agents, webhook verification skipped, scheduled polling disabled.

### Commands and results

- `pnpm install --frozen-lockfile` — passed with pnpm 12.14.0; Prisma client generated.
- `pnpm db:embedded` — passed; PostgreSQL listening on loopback port 5432.
- `pnpm db:migrate` — passed; both existing migrations applied to a fresh database.
- `pnpm typecheck` — passed (12 workspace typecheck tasks).
- `pnpm lint` — passed.
- `pnpm test` — passed (236 tests across 27 test files; packages with no tests exited successfully via `--passWithNoTests`).
- `pnpm dev` — passed; existing API and worker started in simulator mode.
- `GET http://127.0.0.1:3001/healthz` — `ok: true`; database, queue, and PayPal simulator checks healthy.

### Runtime evidence

- API: `http://127.0.0.1:3001` on loopback.
- Worker log reported `mode: simulator` and `agents: templates`.
- No browser surface exists yet, so C0 has no screenshot.

### Notes and pending approvals

- The Codex shell exposes a bundled pnpm 11 before the installed pnpm 12. Commands in this environment must resolve the repository-pinned pnpm 12 executable; one attempted pnpm 11 install failed before source edits and the dependency tree was repaired successfully with pnpm 12.
- No shared core-contract changes have been made. A+B+C approval will be required before those changes land.

### Next task

Implement Day 1: create the design specification and Stitch references, replace the web placeholder with the responsive application shell and temporary queue, verify themes/navigation/mobile behavior, and write the demo storyboard.

## 2026-10-19 — Checkpoint C1: application scaffold and storyboard

- Status: **passed**.
- Branch: `c/web-scaffold`.
- Implemented the Next.js App Router shell, warm light/dark themes, responsive navigation, temporary queue, case-detail shell, reusable status presenters, honest future-feature routes, and demo storyboard.
- Added `DESIGN.md` and generated private Stitch references for the desktop/mobile queue, case detail, and historical-listing direction. The implemented UI follows the repository design specification rather than treating generated copy as product truth.
- Added `ui-registry.md` after browser verification so later components reuse the same shell, queue, badge, money, deadline, evidence, breakpoint, and page-state patterns.

### Resolved frontend versions

- Next.js `16.4.2`; React and React DOM `19.3.1`.
- Tailwind CSS and `@tailwindcss/postcss` `4.3.3`.
- AG Grid Community and React `36.2.0`.
- TanStack Query `5.104.4`; next-themes `0.4.6`; Geist `1.8.1`.
- Radix Dialog `1.3.1`, Radix Icons `1.3.2`, and Radix Slot `1.5.0`.

### Commands and results

- `pnpm --filter @rebuttal/web typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm --filter @rebuttal/web build` — passed; seven routes generated, including the dynamic case route.
- `pnpm typecheck` — passed across the monorepo with the web workspace included.
- `pnpm test` — passed (236 tests across 27 test files; unchanged baseline count).
- Browser bundle scan for `node:fs`, `node:path`, `node:crypto`, and `node:child_process` under `.next/static/chunks` — no matches.

The first production build exposed that Turbopack did not resolve the shared package's NodeNext-style `.js` specifiers back to TypeScript workspace source. The web app now uses Next's webpack build plus a web-only `resolve.extensionAlias`; the core contract was not changed. The final production build passed.

### Browser evidence

- Verified `/queue` at 1440×900 in light and dark themes.
- Verified the 820px tablet layout: persistent 224px navigation and contained horizontal grid scrolling.
- Verified the 390px mobile layout: no document overflow, stacked case cards, and a labeled Radix navigation drawer.
- Quick filter `Due <24h` reduced the grid from five cases to one; the `All` filter restored all five.
- Grid-row and mobile-card activation both navigated to `/cases/demo-urgent`; the case shell linked back to the queue.
- The notification control exposed the honest empty state: `No new notifications. Deadline alerts will appear here.`
- Browser console check after navigation and theme/filter interaction: no errors, warnings, or hydration messages.
- Currency display verified a zero-decimal JPY case as `¥19,900`.

### Scope and data boundary

- The five `DEMO-CASE-*` rows are clearly labeled temporary synthetic data. They are not an API-error fallback and must be removed when Day 4 connects the queue.
- Dashboard, eval, and settings are explicitly marked `Later`; the case route states which Day 5 content is still pending.
- No API token, store token, PayPal secret, or database credential is referenced from browser code.
- No shared core-contract export was changed. A+B+C review remains required before Day 2 transport and listing-snapshot schemas land.

### Next task

Begin Day 2 database reconciliation and demo-store scaffolding. Pause before landing shared core transport/listing contracts or coordinated schema changes until A+B+C approval is confirmed.

## 2026-10-19 — Checkpoint C2 and C3 store API slice

- Status: **C2 passed; C3 incomplete**.
- Branches: `c/db` (`1997449`) followed by `c/demo-store`.
- A+B+C approval for the additive core transport/listing-snapshot contracts and coordinated Prisma changes was confirmed before the shared contract and migration landed.
- Prepared an additive multi-schema Prisma design that keeps existing application models in `public`, adds the default merchant and Day 2 application records, and places seller records in `store`.
- Preserved the applied migration history, the `Action_one_success_per_case_kind` partial unique index, and the original `Case_state_idx` index. The draft upgrade changes the existing `Case` table in place rather than replacing it.
- Added an idempotent local-demo seed with five separate application cases, a validated default policy, deterministic decision-engine recommendations, stable timestamps, and no PayPal calls, queued jobs, or Action rows.
- Added the Fern & Field Goods catalog seed: ten featured products (seven physical, three digital), three legacy products, exact legacy order data, edited, unchanged, and missing listing-history cases.
- Added the responsive demo-store shell on port 3002 and database-backed private reads for the existing Store API contract. Private APIs use the existing bearer-token convention and refuse tokenless production access.

### Commands and results

- `pnpm --filter @rebuttal/db generate` — passed.
- `pnpm --filter @rebuttal/db typecheck` — passed.
- `pnpm --filter @rebuttal/db test` — passed in throwaway PostgreSQL databases (4 tests across 3 files): fresh migration, populated upgrade, idempotent application seed, and store catalog/history seed.
- `pnpm --filter @rebuttal/demo-store typecheck` — passed.
- `pnpm --filter @rebuttal/demo-store test` — passed in throwaway PostgreSQL databases (4 tests across 3 files): bearer authorization, database/fixture parity, and HTTP-route/fixture parity for every legacy purchase.
- `pnpm --filter @rebuttal/demo-store build` — passed without requiring `DATABASE_URL` during the build; six Store API routes and the product/admin pages compiled.
- `pnpm typecheck` — passed across all 14 workspace packages.
- `pnpm test` — passed (247 tests across 34 test files, including the new core-contract, database, and demo-store suites).
- `pnpm lint` — passed after replacing a type-only query helper with Prisma's generated payload type.
- `pnpm build` — passed; the web and demo-store production builds completed together.
- `git diff --check` — passed.
- `pnpm db:migrate` — passed against the persistent local database; `20261020010000_product_foundation` applied.
- First `pnpm db:seed` — added 5 cases, 11 evidence items, 4 decisions, 13 products, and 4 orders; created the validated policy.
- Second `pnpm db:seed` — added zero records and preserved the existing policy.
- Runtime checks — API health, web queue, demo product shell, and the database-backed `INV-1001` order lookup all returned HTTP 200.

### Browser evidence

- Verified the product shell, read-only product editor, and honest empty order-admin state at desktop width and 390px mobile width.
- Navigation between the product and admin routes worked without document overflow.
- Browser console contained no errors or warnings during the shell checks.
- The live database-backed order lookup returned the seeded legacy identifiers, amount, item, and checkout checks without exposing credentials.

### Remaining C3 work

- C3 remains incomplete: `@rebuttal/storefront`, the approved listing-snapshot schema, current/historical shared rendering, transactional publication/editing, product/snapshot/shipment reads, bundled assets, and screenshot evidence have not been implemented.

### Next task

Commit the verified demo-store scaffold/API slice, then create `c/store-snapshots` and implement the shared versioned listing renderer and remaining Day 3 routes.

## 2026-10-19 — Checkpoint C3: immutable storefront

- Status: **implementation complete; final full-suite and browser verification pending**.
- Branch: `c/store-snapshots`.
- Added `@rebuttal/storefront`, a Next/Prisma/connector-independent listing component with shared CSS, renderer version 1, and a Node-only static HTML entry point.
- Bundled the Geist variable font plus fourteen immutable `catalog/v1` WebP paths for twelve seeded listings and two later revisions. Source imagery was generated for the fictional catalog only.
- Connected current and historical product pages to the same renderer. Historical rendering receives only `ListingSnapshot`, preventing current product fields from entering archived output.
- Added serializable create/publish transactions, strict as-of lookup, product/snapshot/shipment reads, public historical pages, and a working seller editor that always publishes a new revision.
- Extended fixture and HTTP clients together for products, historical snapshots, and shipments. Contract tests compare equivalent fixture and database-backed route data.
- Verified in focused tests that timestamp ties choose the higher revision, a later edit does not alter an earlier snapshot, and an order item's pinned snapshot reference remains unchanged.

### Matrix wording review

- **Found:** “Ready — a seller record directly supports this requirement.” Use for purchase-time listing copy, matching delivery events, or verified access records.
- **Weak:** “Needs context — a related record exists, but it does not fully prove the requirement.” State the limitation beside the record; do not upgrade it to found.
- **Missing:** “Not found — no seller record currently supports this requirement.” Pair with the next concrete seller action when one exists.
- These are presentation labels only. No evidence weights, win-model inputs, thresholds, or decision policy were changed.

## 2026-10-20 — Checkpoint C4: connected queue and case API

- Status: **passed**.
- Added additive queue/detail serializers, server-side filters and sorting, pagination totals,
  merchant metadata, deterministic reject/override compatibility stubs, safe evidence-file
  access, and web proxy routes. The queue now uses TanStack Query against the API, polls every
  ten seconds, preserves stale rows on refresh errors, and renders equivalent mobile cards.
- Added the shared clock/deadline behavior, eight server-backed columns, quick filters, URL state,
  keyboard row activation, and no-sample-data fallback behavior.

### Commands and results

- Direct TypeScript checks for core, connectors, API, web, and demo-store — passed.
- API and web route/type contracts were verified through the later C7 HTTP harness.
- Existing approve/PATCH paths remain registered; Week 1 reject/override stubs return 501 and
  do not mutate records.

### Next task

Complete the three-column case detail and evidence checklist, then verify safe exhibit links.

## 2026-10-20 — Checkpoint C5: case detail and evidence access

- Status: **passed**.
- Added the additive `CaseDetail` transport projection with transaction context, stable merged
  timeline, matrix-backed found/weak/missing checklist states, exhibit labels, safe action
  summaries, structured-only preview messaging, and a labeled Week 2 decision placeholder.
- Added token-protected, case-scoped evidence-file serving with storage-root containment and a
  server-side web proxy that never exposes filesystem paths.
- The C7 browser run exercised the detail route and opened its evidence-backed view.

### Next task

Register the storefront evidence source and finish deterministic screenshot capture.

## 2026-10-20 — Checkpoint C6: storefront evidence and capture

- Status: **passed**.
- Registered the storefront source with exact identifier resolution, conflict diagnostics,
  constrained amount/time fallback, pinned/as-of purchase snapshots, shipment facts, immutable
  listing diffs, stable dedupe keys, and visible capture failure metadata.
- Added fixture/HTTP source selection (`STORE_SOURCE`), trusted historical-page/assets settings,
  Playwright capture with atomic writes, bounded file size, retry reuse, light/reduced-motion
  capture settings, and explicit browser-install/test commands.
- Unit coverage passed for conflict handling, historical/diff evidence, dedupe stability, capture
  reuse, and a real Chromium offline PNG capture.

### Next task

Run the isolated real HTTP/worker/browser Week 1 harness and record the handoff.

## 2026-10-20 — Checkpoint C7: Week 1 integration

- Status: **passed in simulator mode**.
- Harness: `scripts/e2e-week1.ts`; report: `docs/week1-integration.md`.
- The run used real migrations, pg-boss, Fastify HTTP, demo-store HTTP/Next, web Next, fresh
  changed-listing and digital simulator webhooks, and Playwright queue/detail checks.
- Replay produced one webhook row, the changed listing stored seven evidence items including the
  revision-1 screenshot and revision-1→revision-2 diff, the digital case stored access evidence,
  and the target case had zero PayPal `Action` rows.
- Captured ignored artifacts: `storage/test-output/week1/queue.png`,
  `storage/test-output/week1/case-detail.png`, and `summary.json`.

### Remaining failures and approvals

- No sandbox run was attempted; the simulator run is the permitted Week 1 fallback. Shared core
  contract approval was recorded before the additive transport/listing/schema changes.
- Next development webpack cache and AG Grid inferred-formatter warnings were non-blocking.

### Next task

Stop at the Week 1 milestone. Week 2 begins with PDF evidence packs and the decision/filing UI.

## 2026-10-20 — Final Week 1 verification

- Status: **passed with one environment-limited command**.
- Fixed the Next production prerender boundary for URL-backed queue filters; direct production
  builds for `apps/web` and `apps/demo-store` now pass.
- Direct typechecks for the root, core, connectors, API, web, and demo-store — passed.
- `node_modules/.bin/eslint .` and `git diff --check` — passed.
- Storefront unit tests, connector/capture tests, and the real Chromium UI test runner — passed.
- A final `pnpm test` attempt was stopped by pnpm's non-interactive workspace module-removal guard
  before tests ran; the focused suites and the real C7 harness remain the authoritative results for
  this desktop environment. No generated store, evidence, or preload files were left behind.

### Next task

Hand off the completed Week 1 milestone; do not start Week 2 implementation.
