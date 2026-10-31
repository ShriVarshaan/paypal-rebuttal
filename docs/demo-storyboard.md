# Rebuttal demo storyboard

Version 1 (Week 3). Every beat below is built and runs in simulator mode; the exact clicks and narration are in
[demo-script.md](demo-script.md). The video stays under three minutes, shows the product working, and claims nothing the
eval report does not support.

## Pacing references

Winning demos were reviewed for structure, not copied visually:

- [Globot](https://devpost.com/software/globot-341w9q): opens on a concrete operational failure and moves quickly from a signal to a prioritized action, with the human decision visible.
- [Aegis](https://devpost.com/software/aegis-autonomous-multi-agent-crisis-command): urgency before architecture; agent reasoning shown only where it helps the operator act.
- [CiviLink](https://devpost.com/software/civilink): one continuous task rather than a feature tour.

Applied lesson: one seller's dispute, from deadline risk to an evidence-backed filing, then two contrasting decisions and the measured result.

## Three-minute cut

| Time | Beat | What the viewer sees | Screens | Status |
| --- | --- | --- | --- | --- |
| 0:00–0:20 | The problem | A small seller's queue: a dispute due in under six hours, a lost one, money on the line. "Miss the deadline and PayPal refunds the buyer automatically." | Queue (`Due <24h` filter), urgent row pulsing | Built |
| 0:20–0:40 | What Rebuttal is | "Rebuttal reads your own records, does the math on fight / offer / accept, and files with PayPal when you approve." A new dispute arrives live: toast + new row. | Queue live update, toast | Built (`pnpm sim:dispute`) |
| 0:40–1:40 | One lifecycle | Open the new not-received case → evidence checklist all found → **FIGHT, p(win) 94%**, EV bars → preview the PDF (cover letter with cited statement, carrier exhibit, listing snapshot) → Approve & file → Filed → sandbox adjudicate → **Resolved in your favour**. | Case detail, decision panel, PDF preview, timeline | Built |
| 1:40–2:10 | The smart part | Not-as-described jacket whose listing changed after the order → **OFFER $X** (listing diff exhibit). An $8.50 digital download → **ACCEPT**, auto-filed by policy, because fighting costs more than it recovers. | Two case pages, EV bars, auto-filed badge | Built |
| 2:10–2:40 | Impact | Eval page: 90% held-out decision accuracy, regret $47 vs $277 always-fight, 5/5 injection attempts unchanged. Dashboard: recovered vs refund-everything, 0 deadlines missed (demo data, disclosed on screen). | Eval, dashboard | Built; numbers from `docs/eval-report.md` |
| 2:40–3:00 | Tech and close | PayPal Disputes API end to end (webhooks, provide-evidence multipart, make-offer, accept-claim, send-message), idempotent writes, Claude bounded to ±0.10 with citations. End card. | README architecture, end card | Built |

## Evidence and claim guardrails

- Every number on screen traces to `docs/eval-report.md` or to the live dashboard; the dashboard labels synthetic demo cases.
- Say "simulator" or "sandbox" whenever PayPal is not the live service. Rebuttal never touches live PayPal.
- Show the human approval: nothing above the policy limit is filed without a click.
- No credentials, tokens or real customer data on screen; demo store and buyers are fictional.

## Final production checklist

- [ ] `pnpm demo:seed --reset --history` on a fresh run; `pnpm e2e:ui` passes right before recording.
- [ ] Unlisted upload under three minutes; plays logged out.
- [ ] One continuous dispute narrative; offer/accept contrast; impact; close.
- [ ] Every stated number checked against the final eval report.
- [ ] Gallery screenshots from `docs/media/` (queue, decision panel, PDF cover, dashboard, eval).
