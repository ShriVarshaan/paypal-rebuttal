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
