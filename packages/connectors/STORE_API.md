# Store API contract

The `messages`, `download-log` and `account` connectors (B) read the seller's own records
through `StoreClient` (`src/store/client.ts`). In production that's the demo store's REST API
(`apps/demo-store`, owned by C); offline it's `fixtures/store/store.json`. C's storefront
connector (orders, listing snapshots) can reuse the same client.

Set `STORE_API_URL` (and optionally `STORE_API_TOKEN`, sent as a bearer token) to use the API.
`STORE_SOURCE=auto` preserves the simulator/fixture default; `STORE_SOURCE=fixtures` forces
fixtures and `STORE_SOURCE=http` requires the configured API. `STORE_WEB_URL` is the trusted
historical-page origin used by screenshot capture, while `EVIDENCE_STORAGE_DIR` is the resolved
root for captured files.

`apps/demo-store` implements this contract against the `store` database schema. Its route tests run against a freshly migrated, seeded throwaway database and compare the HTTP client with the fixture client. When `STORE_API_TOKEN` is unset, tokenless access is allowed only outside production.

Private endpoints require the configured bearer token, return JSON, and return **404 when the record doesn't exist** (the
connector treats that as "no evidence", not as a failure). Response shapes are the zod
schemas in `src/store/schema.ts`; extra fields are allowed and preserved.

| Endpoint | Returns |
|---|---|
| `/api/orders/lookup?invoice=&capture=&paypalOrder=` | `StoreOrder` matching any given key (invoice number, PayPal capture id, PayPal order id) |
| `/api/orders/:id/messages` | `StoreMessage[]` — `{ at, from: "buyer" \| "seller", channel, text }` |
| `/api/orders/:id/access-log` | `AccessEvent[]` — `{ at, ip, action }`, digital orders only |
| `/api/orders/:id/refunds` | `StoreRefund[]` — `{ id, amountCents, refundedAt }` |
| `/api/orders/:id/subscription` | `StoreSubscription` — `{ id, status, chargedAt, cancelledAt, termsUrl }` |
| `/api/orders/:id/shipments` | `StoreShipment[]` — carrier, tracking, status, address, history, and shipment times |
| `/api/orders/search?totalCents=&currency=&placedAt=&sku=` | Exact-one-candidate fallback order search (five-minute placement window) |
| `/api/customers/:id` | `StoreCustomer` — `{ id, createdAt, priorOrders, priorDisputes, knownIps, knownDevices }` |
| `/api/products/:id` | `StoreProductListing` with the current immutable `ListingSnapshot` |
| `/api/products/:id/snapshots?at=<iso>` | Greatest snapshot at or before `at`, with revision as the timestamp tie-breaker |
| `/api/products/:id/snapshots/:snapshotId` | Exact immutable snapshot by ID |
| `/snapshots/:productId?at=<iso>` | Compatibility form of the same as-of lookup |

Product creation (`POST /api/products`) and publication (`PATCH /api/products/:id`) are private demo-admin writes. Each succeeds in one serializable database transaction and creates a new immutable snapshot. Public `/p/:slug` and `/p/:productId/snapshot/:snapshotId` pages expose only fictional catalog content and share renderer version 1.

`StoreOrder.checkout` carries `{ ip, deviceId, avs, cvv }` — the AVS and CVV result codes from
checkout (AVS `Y/X/D/M/F` count as an address match, CVV `M` as a match).

## Evidence produced

| Connector | `data.kind` | PayPal `evidence_type` |
|---|---|---|
| `messages` | `message_thread` (store + PayPal dispute messages, merged) | `OTHER` |
| `download-log` | `access_log` | `PROOF_FOR_SOFTWARE_OR_SERVICE_DELIVERED` |
| `account` | `buyer_history`, `checkout_risk`, `refund`, `subscription` | `OTHER`, `ORDER_DETAILS`, `PROOF_OF_REFUND`, `BILLING_AGREEMENT` |

The `data` fields per kind are documented in `packages/core/src/evidence-kinds.ts`.
