# Rebuttal demo storyboard

Version 0 — Week 1 pacing guide. The final submission video must remain under three minutes, show the product working, and avoid claiming outcomes that are not backed by the evaluation report.

## Pacing references

The following winning demos were reviewed for structure, not copied visually:

- [Globot — Gemini 3 Grand Prize](https://devpost.com/software/globot-341w9q): opens on a concrete operational failure, moves quickly from an unstructured signal to a prioritized action, and keeps the human decision visible.
- [Aegis — Gemini 3 second place](https://devpost.com/software/aegis-autonomous-multi-agent-crisis-command): establishes urgency before explaining architecture, then reveals agent reasoning only where it helps the operator act.
- [CiviLink — World's Largest Hackathon Grand Prize](https://devpost.com/software/civilink): demonstrates the before-and-after workflow in one continuous task instead of touring unrelated features.

Applied lesson: tell one seller's dispute story from deadline risk to evidence-backed action. Product value comes before the stack. Every transition should advance that case.

## Three-minute cut

| Time | Beat | Voiceover intent | Required screens | Delivery status |
| --- | --- | --- | --- | --- |
| 0:00–0:20 | Seller problem and missed deadline | A small seller loses time and money when evidence is scattered and a PayPal response deadline is easy to miss. | Queue focused on one urgent case | **Week 1.** Queue and honest deadline state. |
| 0:20–0:40 | What Rebuttal does | Rebuttal turns each dispute into a prioritized case, gathers the seller's own records, and prepares the next safe action. | Application shell, queue filters, evidence progress | **Week 1.** Shell and queue; wording must not imply filing is already available in the UI. |
| 0:40–1:40 | Full lifecycle story | Follow one webhook-created case through purchase context, historical listing, shipment or access evidence, and the math-first recommendation. | Queue → case detail → transaction, timeline, checklist, historical listing screenshot; then decision/PDF/filing panel | **Week 1:** queue, detail, store evidence, screenshot. **Later week:** decision panel, PDF evidence pack, filing. **Dependency:** backend recommendation and PayPal write path. |
| 1:40–2:10 | Offer and accept examples | Briefly contrast when expected value recommends a partial offer or accepting the claim instead of fighting. | Decision comparison and policy guardrails | **Later week.** Do not mock this as working Week 1 functionality. **Dependency:** reviewed decision data and policy API. |
| 2:10–2:40 | Measured impact | Show recovery, time-to-response, calibration, and strategy comparison only after the checked evaluation run exists. | Dashboard and evaluation report | **Later week.** Outcome and evaluation numbers intentionally unfilled. **Dependency:** final eval report and supported metrics. |
| 2:40–3:00 | Technology and close | Rebuttal combines verified PayPal events, deterministic decision math, constrained AI drafting, and an auditable human-controlled workflow. | Architecture graphic → concise end card | **Dependency:** final architecture capture and submission branding. |

## Week 1 recording route

1. Start on `/queue` with a webhook-created case rather than seed fallback data.
2. Filter to the urgent case and open `/cases/[id]`.
3. Show transaction context, the purchase-time listing, timeline, and evidence checklist.
4. Open the stored historical listing and its inspected screenshot evidence.
5. Return to the queue and state plainly that decision approval, PDF generation, and filing are later-week work.

## Evidence and claim guardrails

- Leave all recovery, win-rate, time-saved, and calibration values blank until `docs/eval-report.md` supports them.
- Call simulator data synthetic whenever the real sandbox is unavailable.
- Never present navigation placeholders as completed features.
- Never suggest that Week 1 automatically filed, adjudicated, or changed a PayPal dispute.
- Record the final run against a clean integration environment and keep visible identifiers scrubbed.

## Final production checklist

- [ ] Public YouTube link and total duration under three minutes.
- [ ] Product visibly functions during the recording.
- [ ] One continuous dispute narrative; no disconnected feature tour.
- [ ] Week 1, later-week, and dependency shots match their real implementation status.
- [ ] Every stated number is traceable to the final evaluation report.
- [ ] No credentials, tokens, or real customer data appear on screen.
