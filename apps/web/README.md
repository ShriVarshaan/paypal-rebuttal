# Rebuttal web

The seller-facing dispute workspace. Week 1 provides the application shell, responsive case queue, and a navigable case-detail route. Queue data is intentionally synthetic until the Fastify read contract is connected on Day 4.

## Run locally

From the repository root:

```powershell
pnpm --filter @rebuttal/web dev
```

Open <http://127.0.0.1:3000/queue>. The server binds to loopback only.

The root `pnpm dev` command starts this app together with the API and worker. Start Postgres and apply migrations first as described in the root README.

## Verification

```powershell
pnpm --filter @rebuttal/web typecheck
pnpm --filter @rebuttal/web build
pnpm lint
```

The app uses webpack's extension aliases so the browser build can consume the shared `@rebuttal/core` package's NodeNext-style `.js` TypeScript specifiers. `next.config.ts` owns this boundary; do not change the core contract to accommodate the frontend bundler.
