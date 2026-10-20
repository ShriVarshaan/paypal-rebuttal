# Rebuttal demo store

A deliberately synthetic indie shop used to exercise Rebuttal's seller-record connectors. It exposes current and historical product pages, an immutable product editor, an order-admin route, and a database-backed private API for products, historical snapshots, orders, shipments, messages, access logs, refunds, subscriptions, and customers.

Run from the repository root:

```powershell
pnpm --filter @rebuttal/demo-store dev
```

Open <http://127.0.0.1:3002>. The development server binds to loopback only.

The private routes use `DATABASE_URL`. Set `STORE_API_TOKEN` to require `Authorization: Bearer <token>`; tokenless private access is permitted only outside production. See [`packages/connectors/STORE_API.md`](../../packages/connectors/STORE_API.md) for routes and response shapes.

Current and historical pages share `@rebuttal/storefront` renderer version 1. The historical page receives only its snapshot record; product edits publish new snapshots transactionally and never rewrite earlier versions. Seeded catalog images and the bundled Geist font live under `public/catalog/v1/` so screenshot evidence does not depend on remote assets.
