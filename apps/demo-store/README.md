# Rebuttal demo store

A deliberately synthetic indie shop used to exercise Rebuttal's seller-record connectors. The Day 2 shell exposes product, product-edit, and order-admin routes. The private seller-record API is database-backed and implements the existing read contract for orders, messages, access logs, refunds, subscriptions, and customers.

Run from the repository root:

```powershell
pnpm --filter @rebuttal/demo-store dev
```

Open <http://127.0.0.1:3002>. The development server binds to loopback only.

The private routes use `DATABASE_URL`. Set `STORE_API_TOKEN` to require `Authorization: Bearer <token>`; tokenless private access is permitted only outside production. See [`packages/connectors/STORE_API.md`](../../packages/connectors/STORE_API.md) for routes and response shapes.

Historical listing rendering and immutable publication/edit flows are still pending the approved shared listing-snapshot contract. Until the coordinated schema migration is approved and applied, the static shell pages boot but database-backed routes are available only in the isolated integration tests.
