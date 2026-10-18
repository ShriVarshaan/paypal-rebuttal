# Fixtures

Payloads for offline development, tests and simulator mode (`SIMULATOR=1`).

| Path | What |
|---|---|
| `paypal/dispute-*.json` | `GET /v1/customer/disputes/{id}` responses. The simulator loads every one at startup. |
| `paypal/capture-*.json` | `GET /v2/payments/captures/{id}`; `supplementary_data.related_ids.order_id` links to the order. |
| `paypal/order-*.json` | `GET /v2/checkout/orders/{id}`, including `shipping.trackers` (`{capture_id}-{tracking_number}`). |
| `paypal/disputes-list.json` | `GET /v1/customer/disputes` |
| `webhooks/*.json` | `CUSTOMER.DISPUTE.CREATED/UPDATED/RESOLVED` deliveries |

**Status:** the current files are *synthetic*. They were written by hand to match the field names in PayPal's OpenAPI specs (`paypal/paypal-rest-api-specifications`). Replace them with recorded sandbox payloads as they come in:

```bash
pnpm tsx scripts/record-fixture.ts dispute PP-D-12345 not-received   # writes fixtures/paypal/dispute-not-received.json, scrubbed
```

Always scrub before committing: `record-fixture.ts` runs `scrubPayload()` from `@rebuttal/paypal`, which swaps emails, buyer/payer names and street lines for fakes. Anything that must not be shared goes in `fixtures/private/` (git-ignored).

The three disputes cover the Day 14 milestone paths:

| Fixture | Reason | Stage | Intended path |
|---|---|---|---|
| `PP-D-90001` | not received, tracking `EZ4000000004` (EasyPost test code for delivered) | CHARGEBACK | FIGHT → WON |
| `PP-D-90002` | not as described | INQUIRY | OFFER |
| `PP-D-90003` | unauthorised, $8.50 digital item | CHARGEBACK | ACCEPT |
