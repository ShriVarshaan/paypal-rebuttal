# Week 1 integration report

## Result

Checkpoint C7 passed in simulator mode on 2026-10-20. The harness used a throwaway
PostgreSQL database with the repository migrations, real pg-boss handlers, a real
Fastify HTTP listener, the database-backed demo-store Next app, and the web Next app.
No PayPal write endpoint was called and the target cases had zero `Action` rows.

The local desktop required a small `NODE_OPTIONS` preload for Node 24's Windows
`os.userInfo()` call while starting embedded Postgres. This is an environment workaround,
not an application dependency. On a normal checkout, use `pnpm e2e:week1` directly.

## Harness command

```powershell
pnpm browser:install
$env:NODE_OPTIONS='--require=./.tmp-node-os-userinfo.cjs'
node_modules/.bin/tsx scripts/e2e-week1.ts
```

The harness creates an isolated simulator state file, starts the store/API/web surfaces on
free loopback ports, and writes ignored artifacts under `storage/test-output/week1/`.

## Assertions

- Fresh webhook `WEEK1-CHANGED-LISTING` created exactly one case; replaying the same event ID
  left exactly one webhook row and did not enqueue another sync.
- The changed-listing case reached triage with seven evidence items, a purchase-time jacket
  snapshot, an HTTP historical page capture, and a separate diff naming `title` and
  `description` changes between revisions 1 and 2.
- The digital `WEEK1-DIGITAL` case received access-log evidence and reached triage.
- The web server-side queue proxy returned the fresh case, and Playwright loaded the queue
  and detail pages without a manual reload. Screenshots were captured for both screens.
- The authenticated Fastify evidence-file proxy returned the captured PNG with its media type;
  the browser never received the stored filesystem path.
- The target changed-listing case had `actionCount: 0`; the harness never approved or filed it.

The successful run summary was:

```json
{
  "webhookRowsForReplay": 1,
  "evidenceCount": 7,
  "actionCount": 0,
  "listingSnapshotId": "snapshot-product-legacy-jacket-r1",
  "diffChangedFields": ["title", "description"]
}
```

## Known non-blocking diagnostics

Next's development webpack cache reports dependency snapshot warnings in this environment,
and AG Grid emits its standard inferred-formatter warning. Neither changed the rendered
queue/detail assertions. The harness remains deliberately offline for PayPal, EasyPost, and
Anthropic.

## Remaining Week 2 work

PDF evidence packs, decision editing/approval UI, filing, buyer-message composition, policy
settings, dashboard/eval analytics, onboarding, and appeals UI remain outside Week 1.
