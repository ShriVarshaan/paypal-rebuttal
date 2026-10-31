# Demo script v1

Exact clicks, narration and timings for the three-minute video. Storyboard: [demo-storyboard.md](demo-storyboard.md).
Timings are from `pnpm e2e:ui` runs (FIGHT path 13s, OFFER 9s, ACCEPT 3s of machine time) plus narration.

## Before recording (10 minutes)

```bash
pnpm db:embedded                 # leave running in its own terminal
pnpm db:migrate
SIMULATOR=1 pnpm dev             # web :3000, api, worker, demo store :3002
```

In a second terminal:

```bash
pnpm demo:seed --reset --history # seven curated disputes + 12 weeks of disclosed demo history
pnpm e2e:ui                      # all three paths must PASS; then reseed (it adds cases)
pnpm demo:seed --reset --history
```

- Browser: clean profile, 1440×900 window, zoom 110%, bookmarks bar hidden, light theme.
- Terminal beside the browser, font 16pt, in the repo root, with `pnpm sim:dispute not-received` and
  `pnpm sandbox:adjudicate <id> seller` ready to type.
- Policy: Settings → Balanced (auto-file under $50 with p(win) ≥ 80%).

## Shot list

| # | Time | Do | Say |
| --- | --- | --- | --- |
| 1 | 0:00 | Open `/queue`. Click **Due <24h**. Hover the pulsing row. | "This is a small shop's PayPal dispute queue. This one is due in under six hours. Miss it, and PayPal refunds the buyer — the seller loses the money and the item." |
| 2 | 0:12 | Click **All**. Point at the Lost row. | "Disputes are slow, manual and easy to lose." |
| 3 | 0:20 | Terminal: `pnpm sim:dispute not-received`. Toast appears: "New dispute: $89.00 Not received". New row appears. | "Rebuttal is a dispute desk. When a buyer opens a dispute, PayPal's webhook lands here, and Rebuttal starts gathering the seller's own records." |
| 4 | 0:35 | Click the toast (opens the case). | "Order, tracking, the listing as it was at purchase, the message thread." |
| 5 | 0:45 | Scroll to the evidence checklist: all **found**. Scroll back up. | "Each requirement PayPal looks for in a not-received case is checked off, with the exhibit that proves it." |
| 6 | 0:55 | Decision panel: **FIGHT**, p(win) 94%, EV bars. Hover the Fight bar. | "Then it does the math. Fighting is worth about $72; accepting loses a dollar. So: fight. Here's why — delivered to the address on file, signed for." |
| 7 | 1:08 | Click **Preview PDF**. Scroll the cover letter, then Exhibit EX-1 and EX-2. | "This is exactly what PayPal's reviewer receives: a cover letter whose every statement cites an exhibit, then the carrier scans and the listing as the buyer saw it." |
| 8 | 1:20 | Close. Click **Approve & file** → dialog → **Approve and file**. | "Over my $50 limit, so it asks me first." |
| 9 | 1:26 | Wait for **Filed with PayPal**. Terminal: `pnpm sandbox:adjudicate <id> seller`. Timeline shows **Resolved in your favour**. | "Filed through PayPal's provide-evidence API. In the sandbox I'll play PayPal… and we won." |
| 10 | 1:40 | Back to queue, open the **Not as described** jacket (OFFER). Point at the listing-diff exhibit and the EV bars. | "Not every dispute should be fought. This jacket's listing changed after the order. A partial refund is worth more than fighting, so Rebuttal offers one." |
| 11 | 1:55 | Open the **$8.50** digital case: **ACCEPT**, badge "Auto-filed by policy". | "And an $8.50 download? Fighting costs more than it recovers. Rebuttal accepted it on its own, because my policy allows that." |
| 12 | 2:10 | Open `/eval`. Hold on the four tiles, then the baselines bars. | "On 30 held-out labeled disputes: 90% of decisions correct, and it leaves $47 on the table versus $277 for always fighting. Prompt-injection attempts in buyer messages changed nothing." |
| 13 | 2:25 | Open `/dashboard`. Point at the demo-data note, then the paid-out chart. | "Over twelve weeks of demo history: paid out far less than refunding everything, and no deadline missed." |
| 14 | 2:40 | README architecture block, then the end card. | "PayPal's Disputes API end to end — webhooks, multipart evidence, offers, accepts, messages — with idempotent writes. Claude reads and drafts, bounded to a cited ±10% nudge; the math decides. Rebuttal." |

## Fallbacks

- **The new case does not appear within 5s:** check the sidebar says *Live*; refresh the queue (polling backstop is 30s).
- **PDF still building:** the pack card shows *Building*; it takes 3–5s. Keep narrating the EV bars.
- **Anything else:** cut to the seeded *FIGHT awaiting approval* case and continue from shot 6.

## Real sandbox variant

With sandbox credentials and `SIMULATOR` unset, follow `docs/sandbox-runbook.md` to create a payment and dispute with
the buyer account, then use `pnpm sandbox:require-evidence <id>` before approving and `pnpm sandbox:adjudicate <id> seller`
after filing. The UI steps are identical.
