# Rebuttal UI registry

Verified patterns for the product workspace. Keep this file aligned with `DESIGN.md`; add or revise entries after a component has been implemented and inspected in the browser.

## Foundations

- **Typeface:** Geist Sans for product copy; Geist Mono for IDs, money, deadlines, probabilities, and other machine-derived values.
- **Surfaces:** warm off-white canvas with white panels in light mode; near-black canvas with charcoal panels in dark mode. Borders carry hierarchy instead of shadows.
- **Accent:** restrained sage/teal for selection, progress, and positive evidence. Amber is reserved for deadline or approval attention; red is reserved for loss/error states.
- **Shape:** 6px controls, 8px panels. Avoid pills except compact state badges.
- **Motion:** 120–180ms color/opacity transitions. Disable nonessential motion under `prefers-reduced-motion`.

## App shell

- **Desktop/tablet:** persistent 224px sidebar, merchant header, content canvas. The active nav row has a pale accent fill and a 3px left marker.
- **Mobile:** sidebar becomes a left Radix dialog drawer below 768px. The trigger and close control have explicit accessible names.
- **Navigation status:** unfinished destinations stay reachable but carry a `Later` label and an honest placeholder page.
- **Environment:** simulator/local status stays at the bottom of navigation so recorded demos cannot be mistaken for production.
- **Header controls:** 44px notification and theme controls. Notifications use a short, honest empty state until event data exists.

## Queue controls

- **Quick filters:** bordered rectangular toggles; selected state uses the accent-subtle token and `aria-pressed`.
- **Search:** one full-width labeled search field with a separate reset button. Keyboard focus uses a 2px accent ring.
- **Status note:** temporary/synthetic data is named in the page heading area and must disappear when the Day 4 API connection lands.

## Queue data presentation

- **Desktop/tablet:** AG Grid Community with uppercase 11px headers, 72px rows, quiet row borders, and no decorative shadow.
- **Mobile:** stacked case cards replace the grid below 768px. The entire card is a 44px-minimum button and preserves the same information hierarchy as a row.
- **Order of attention:** deadline → reason/ID → amount → stage/state → recommendation/pWin → evidence completeness → masked buyer.
- **Interaction:** rows and cards open the case detail route. Grid rows also respond to Enter and Space.
- **Money:** always formatted from integer minor units through the core currency rules; zero-decimal currencies must remain zero-decimal.

## Badges and indicators

- **Case state:** compact uppercase badge with semantic neutral/accent/attention/success/danger treatments.
- **Recommendation:** `Fight` uses accent, `Offer` attention, `Accept` neutral. Pending triage is plain muted text.
- **Deadline:** mono value with clock icon. Under 24 hours uses amber and a reduced-motion-safe pulse; terminal cases say `Resolved`; missing dates say `No deadline`.
- **Evidence:** numeric percentage and a thin 4px progress track with an accessible label.

## Page states

- **Loading:** bordered surface with concise status copy; avoid full-page spinners.
- **Empty:** state what is absent and the next useful action.
- **Error:** explain the failed read and expose retry when retry is actually wired. Never substitute demo rows for a failed API request.

## Verified breakpoints

- **1440px desktop:** full grid columns and persistent navigation.
- **820px tablet:** persistent navigation and horizontally scrollable grid without page overflow.
- **390px mobile:** drawer navigation, scrollable filter row, stacked case cards, and no document-level horizontal overflow.

## Demo store

- **Identity:** fictional `Fern & Field Goods` storefront, clearly marked as synthetic in the utility bar and footer. Warm canvas, white paper surfaces, clay attention, and sage metadata distinguish it from the operations workspace without creating a second visual language.
- **Store header:** brand and context on the left; three 44px bordered route controls on the right. Controls wrap on narrow screens and retain their text labels.
- **Listing renderer:** `@rebuttal/storefront` owns one responsive composition for current and historical pages: square immutable media, serif display title, compact price, restrained metadata, and a visible renderer/capture stamp. It collapses to one column below 760px and has a print layout for later evidence capture.
- **Catalog assets:** synthetic product photography and Geist are bundled under versioned `catalog/v1` paths. Published snapshots keep their exact asset paths; replacing an image requires a new filename and listing revision.
- **Historical state:** archived pages use a clay-outlined revision badge and a brief evidence note. They receive a `ListingSnapshot` only; never pass current product metadata into the renderer.
- **Admin editor:** active controls use the same 6px border language and 44px minimum height. Saving publishes a new immutable revision, returns to the editor, and shows a factual success notice.
- **Empty orders:** bordered record surface with table headings on desktop and a centered explanation. Never insert fallback orders after a database or API failure.
- **Historical evidence:** storefront and snapshot routes must share the same renderer; evidence-specific metadata sits outside the listing itself so screenshots remain faithful to what the buyer saw.
- **Verified:** Day 2 product, product-editor, and order-admin navigation at 1440px and 390px. Day 3 renderer breakpoints, assets, publishing feedback, and browser behavior require a fresh visual pass after runtime verification.

## Case detail and evidence

- **Desktop detail:** three equal-purpose columns at `xl`: dispute/transaction context, a stable chronological timeline, and the matrix-backed checklist/preview. Below `xl`, columns stack without hiding evidence.
- **Timeline:** case events and store/PayPal messages share one mono timestamp treatment; undated messages are explicitly labeled and rendered after dated entries. Duplicate message text is shown once.
- **Checklist:** found, weak, and missing are semantic badges with text labels; score is the core `assessCompleteness` result, never a frontend approximation. Required/strong/nice tiers and collection hints remain visible beside each item.
- **Evidence links:** exhibit labels are the current `assignExhibits` mapping. A linked file goes through the server proxy; structured-only evidence says so explicitly instead of presenting a broken preview.
- **Verified:** C7 browser harness loaded the queue and detail pages from fresh webhook-created data, including the historical listing evidence state.
