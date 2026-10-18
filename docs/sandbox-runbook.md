# Sandbox runbook: real PayPal sandbox disputes

How to get real disputes into the PayPal sandbox so the pipeline can run end to end (plan Day 1, owner B). If any step fails, keep going in simulator mode (`SIMULATOR=1`, see README) and come back to this.

> **Status:** the steps and tooling are written; the timings below have **not been measured yet**. Whoever does the first run: fill in the "Took" column and the "Observed" notes, and post the dispute ids in the team chat.

## 0. One-time setup

1. **Sandbox accounts** — developer.paypal.com → Testing Tools → Sandbox Accounts. You need one **Business** account (the seller) and one **Personal** account (the buyer). The defaults PayPal creates are fine. Note the buyer's email and password (View/Edit account).
2. **App** — Apps & Credentials → Sandbox → Create App, type *Merchant*, linked to the Business account. Under the app's features make sure **Disputes** (Customer Disputes) is enabled.
3. **`.env`** — copy `.env.example` to `.env` and set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`. Leave `PAYPAL_BASE_URL` on the sandbox URL; the client refuses live hosts.
4. **Smoke test** — `pnpm paypal:ping` should print `token ok` and a disputes list (an empty `items` array is fine). A 403 / `PERMISSION_DENIED` means the Disputes feature isn't on for this app.
5. **Webhooks (optional on day 1)** — in the app, add a webhook URL (a cloudflared/ngrok tunnel to `http://localhost:3001/webhooks/paypal`) for `CUSTOMER.DISPUTE.CREATED`, `.UPDATED`, `.RESOLVED`, and put its id in `PAYPAL_WEBHOOK_ID`. Without it, the 60-second polling sync picks disputes up anyway.

## 1. Make payments

```bash
pnpm checkout        # http://localhost:3005
```

The page uses the PayPal JS SDK with your sandbox client id; the server creates the order (`POST /v2/checkout/orders`, intent CAPTURE) and captures it (`POST /v2/checkout/orders/{id}/capture`). Item name and amount are editable; the presets are the five payments we want, so the decision engine gets variety:

| # | Preset | Amount | Kind | Order id | Capture id | Took |
|---|---|---|---|---|---|---|
| 1 | Phone case | $12.00 | physical | | | |
| 2 | Digital recipe e-book | $49.00 | digital | | | |
| 3 | Wireless headphones | $85.00 | physical | | | |
| 4 | Waxed canvas jacket | $150.00 | physical | | | |
| 5 | Walnut side table | $400.00 | physical | | | |

Pay each one logged in as the **Personal** sandbox account. The page prints the order and capture ids; the server logs them too.

For physical orders, attach tracking so not-received disputes have something to fight with (EasyPost test code `EZ4000000004` always reports *delivered*):

```bash
pnpm sandbox:add-tracking <orderId> <captureId> EZ4000000004
```

## 2. Open disputes as the buyer

1. Log in at https://www.sandbox.paypal.com as the **buyer**.
2. Activity → pick the transaction → **Report a problem** (or Resolution Center → Report a Problem).
3. Open, at minimum:
   - **Dispute 1:** "I didn't receive an item I paid for" → `MERCHANDISE_OR_SERVICE_NOT_RECEIVED` (use the $85 headphones)
   - **Dispute 2:** "Item is significantly not as described" → `MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED` (the $150 jacket)
   - **Dispute 3, if offered:** unauthorised transaction → `UNAUTHORISED` (the $49 e-book)
4. Write a buyer message in each; the triage agent reads it.

| Dispute | Reason | Dispute id | Visible in `GET /v1/customer/disputes` after | Webhook after | Took |
|---|---|---|---|---|---|
| 1 | not received | | | | |
| 2 | not as described | | | | |
| 3 | unauthorised | | | | |

Check they arrive: `pnpm paypal:ping` lists them; with `pnpm dev` running, the poll sync creates Cases and the worker triages them (watch for `case triaged` in the worker log).

## 3. Drive the lifecycle

Sandbox-only endpoints move a dispute through stages without waiting for a real buyer or PayPal agent:

```bash
pnpm sandbox:require-evidence <disputeId>          # → WAITING_FOR_SELLER_RESPONSE with evidence required
# approve the proposed decision (POST /decisions/:id/approve) and let the executor file it
pnpm sandbox:adjudicate <disputeId> seller         # or: buyer
pnpm sandbox:lifecycle <disputeId> [seller|buyer]  # all of the above in one go
```

Record a scrubbed copy of each interesting payload so others can work offline:

```bash
pnpm record:fixture dispute <disputeId> not-received-real
```

## 4. Observed (fill in)

- Time from capture to the transaction being disputable:
- Time from opening a dispute to it showing in the API:
- Time from opening a dispute to the webhook:
- Which reasons the sandbox Resolution Center offered:
- Anything odd (errors, required waits, account limits):

## 5. Decision point

- **Works:** keep making disputes until there's a stock of about 10 in different stages for the demo.
- **Doesn't (or too slow):** simulator mode is the main path (`SIMULATOR=1 pnpm dev`, `pnpm sim:dispute <fixture>`); keep retrying in the background with different accounts, amounts, or a longer wait after capture.
