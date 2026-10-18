# Deploying Rebuttal

Target: **Railway** for Postgres + api + worker, **Vercel** for `apps/web`. Fly.io works the same way with the same two Dockerfiles.

## Services

| Service | Build | Notes |
|---|---|---|
| Postgres | Railway Postgres plugin | Copy its `DATABASE_URL` into api and worker |
| api | `apps/api/Dockerfile`, context = repo root | Runs `prisma migrate deploy` on start, then listens on `$PORT` |
| worker | `apps/worker/Dockerfile`, context = repo root | Playwright base image (Chromium for C's PDFs); no public port |
| web | Vercel, root `apps/web` | `NEXT_PUBLIC_API_URL` = api URL |

Build locally to check:
```bash
docker build -f apps/api/Dockerfile -t rebuttal-api .
docker build -f apps/worker/Dockerfile -t rebuttal-worker .   # --build-arg PLAYWRIGHT_VERSION=… to match packages/evidence
```

## Environment (set in the host's dashboard, never in files)

| Var | api | worker |
|---|---|---|
| `NODE_ENV=production` | ✓ | ✓ |
| `DATABASE_URL` | ✓ | ✓ |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | ✓ | ✓ |
| `PAYPAL_WEBHOOK_ID` (from the webhook registered for the *deployed* URL) | ✓ (required) | |
| `API_TOKEN` (shared demo secret for the REST routes) | ✓ (required) | |
| `WEB_ORIGIN` (the Vercel URL; CORS is locked to it) | ✓ | |
| `EASYPOST_API_KEY` (test key) | | ✓ |
| `ANTHROPIC_API_KEY` | | ✓ (B's agents) |

In production the api refuses to start if `SIMULATOR=1` or `WEBHOOK_SKIP_VERIFY=1` is set, or if `API_TOKEN` or `PAYPAL_WEBHOOK_ID` is missing.

## Steps (Day 16)
1. Create the Railway project and add Postgres.
2. Add the api and worker services from the GitHub repo, each with its Dockerfile path, and set the variables above.
3. Deploy the api first: it applies migrations and creates the pg-boss queues. Then deploy the worker.
4. In developer.paypal.com → your app → Webhooks, add `https://<api-host>/webhooks/paypal` with `CUSTOMER.DISPUTE.CREATED`, `.UPDATED` and `.RESOLVED`. Put its id in `PAYPAL_WEBHOOK_ID` and redeploy the api.
5. Smoke test:
   - `curl https://<api-host>/healthz` shows db, queue and paypal all `ok`
   - open a sandbox dispute and check that it appears in `GET /cases` (with `Authorization: Bearer $API_TOKEN`) within a minute
6. Deploy web on Vercel with the api URL and token.

## Day 17 security checklist
- [ ] Webhook verification can't be bypassed in production (enforced in `apps/api/src/config.ts` and `assertSafeForProduction`)
- [ ] No secrets in git history: `git log -p | grep -iE "secret|client_id|EZAK|sk-ant"` or `gitleaks detect`
- [ ] Rate limits: 300/min per IP globally, 1200/min on the webhook (`apps/api/src/app.ts`)
- [ ] Auth on REST routes (`API_TOKEN` bearer); web app behind a shared demo password
- [ ] Logs carry no tokens or PII: PayPal client logs method/path/status/debug id only; Fastify redacts `authorization` and the transmission signature
- [ ] CORS locked to `WEB_ORIGIN`
- [ ] Run `/security-review` on `main`
