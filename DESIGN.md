# Rebuttal design system

## Product character

Rebuttal is a calm operations desk for small PayPal sellers. It should feel precise, trustworthy, and quiet under pressure: closer to a well-designed editorial workspace than a generic analytics dashboard. The interface prioritizes deadlines, evidence quality, and the next safe action without inventing metrics or dramatizing risk.

## Foundations

- Light-first with a complete dark theme.
- Geist Sans for interface text. Geist Mono for dispute IDs, transaction references, timestamps, money metadata, and other compact identifiers.
- Warm neutral canvas; white or near-white working surfaces; charcoal text; restrained teal as the only product accent.
- Semantic red, amber, and green always pair color with a label or icon.
- No gradients, neon, glassmorphism, decorative charts, marketing hero sections, or large colored panels.
- No heavy shadows. Depth comes from spacing, borders, and a very diffuse shadow below 5% opacity where necessary.
- No emojis. Use consistent Radix icons or small custom SVG primitives.

## Color tokens

### Light

- Canvas: `#f5f4ef`
- Surface: `#ffffff`
- Surface subdued: `#faf9f6`
- Text strong: `#202522`
- Text: `#3f4742`
- Text muted: `#707873`
- Border: `#e3e2dc`
- Border strong: `#cecec6`
- Accent: `#1f766b`
- Accent soft: `#e2f0ed`
- Danger: `#a33d36`; soft `#f8e9e7`
- Warning: `#90651b`; soft `#f7efd9`
- Success: `#3f6f46`; soft `#e7f0e7`

### Dark

- Canvas: `#171a18`
- Surface: `#1e221f`
- Surface subdued: `#232824`
- Text strong: `#f0f1ed`
- Text: `#d3d7d2`
- Text muted: `#9ca49e`
- Border: `#343a35`
- Border strong: `#484f49`
- Accent: `#72b6aa`
- Accent soft: `#203c37`
- Danger: `#e09a93`; soft `#3c2624`
- Warning: `#dfbd78`; soft `#3a3121`
- Success: `#97c59c`; soft `#26382a`

## Type scale

- Page title: 28/34, weight 620, tracking -0.025em.
- Section title: 18/24, weight 620, tracking -0.015em.
- Card title: 15/21, weight 600.
- Body: 14/22, weight 400.
- Compact table text: 13/18, weight 450.
- Label: 11/16, weight 620, uppercase, tracking 0.055em.
- Metadata: 12/18 Geist Mono, weight 450.

## Spacing and shape

- Base spacing unit: 4px.
- Page padding: 32px desktop, 24px tablet, 16px mobile.
- Major section gap: 28–32px.
- Card padding: 20–24px desktop, 16px mobile.
- Desktop sidebar: 224px fixed width.
- Borders: 1px solid the border token.
- Surface radius: 8px. Controls: 6px. Status tags may use a full pill radius.
- Interactive targets are at least 44px where applicable.

## Layout

- Desktop shell uses a 224px sidebar and flexible content area.
- Top bar shows merchant identity, notification state, and theme control without dominating the page.
- At widths below 768px, replace the sidebar with a modal drawer and render queue rows as accessible case cards.
- Case detail uses three columns at 1280px and above; it stacks below that breakpoint.
- Empty, loading, stale, and error states occupy the same structural region as successful content to avoid layout jumps.

## Components

### Navigation

- Current route uses a soft accent background, strong text, and a 3px inset accent marker.
- Future routes remain navigable but state their later-week status clearly.
- Mobile drawer traps focus, closes on Escape, and restores focus to its trigger.

### Queue

- AG Grid Community only. Header and rows use quiet separators rather than boxed cells.
- Due dates are the leading visual priority. Urgent and overdue states use text, icon, and color together.
- Recommendation and state badges are compact labels, not large pills.
- Evidence completeness uses a thin determinate bar with a text percentage.
- Background refresh preserves visible rows and controls; stale/error information appears in a compact status strip.

### Case cards

- On mobile, each case card presents due state, reason, amount, workflow state, recommendation, evidence, and buyer in the same information hierarchy as the desktop grid.
- Cards have a 1px border, 8px radius, no heavy shadow, and a clear keyboard focus ring.

### Status and feedback

- Focus ring: 2px accent with 2px canvas offset.
- Loading uses skeleton blocks or a compact progress indicator. Do not restart entrance animation on polling.
- Empty states explain why the region is empty and suggest a valid next step.
- Errors say what failed and whether existing data is stale; never substitute sample data.

## Motion and accessibility

- Use opacity and transform only, 160–220ms for interactions.
- Honor `prefers-reduced-motion`; content must be immediately available without animation.
- Never pulse terminal cases. Urgent non-terminal countdowns may use a restrained opacity pulse only below six hours.
- Meet WCAG AA contrast, keep logical heading order, and provide keyboard access for rows, cards, drawer, theme, and notifications.

## Screen references

Stitch references should cover:

1. Desktop queue: real application shell, eight operational columns, filters, urgent case, no decorative analytics.
2. Desktop case detail: dispute context, chronological timeline, evidence checklist and preview, Week 2 decision placeholder.
3. Mobile queue/detail: 390px presentation with drawer navigation and equivalent case information.
4. Store listing: Fern & Field Goods product and immutable historical snapshot treatment using the same restrained visual system.

## Implementation boundary

Week 1 implements queue and case detail plus explicit future-feature pages. Decision editing, approvals, PDF packs, filing controls, policy settings, analytics, and onboarding remain labeled later-week work.
