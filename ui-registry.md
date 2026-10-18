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
