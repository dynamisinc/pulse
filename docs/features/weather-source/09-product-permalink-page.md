# Story: Product and forecast permalink page

**Feature:** Weather source  ·  **Epic:** E6  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** WX-010, WX-013, WX-022, XC-010, COR-053  ·  **Design decisions:** D4-009, D4-010, D4-012  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 5  ·  **Effort:** M

## Context
The canonical product page at `/weather/:outletSlug/:contentSlug` — the destination of the alert bar's "Details", the `@WeatherDesk` link card and the widget. It is the highest-risk leak class in the product,
so the EXERCISE watermark slot on imagery is covered first. Reads the foundation permalink API (F06); a forecast permalink renders the same way with forecast furniture.

## Acceptance Criteria
- [ ] **Product page anatomy.** Given a `weather_product`, then it renders `SeverityChip`, the headline verbatim, `ProductTimes`, `IbwGrid` (when present), `ProductText` (NWS furniture), affected zone names (resolved from the zones list, soft-deleted names retained), imagery via `ProductImagery`, and the state banner; same headline string as the alert and post (D4-010).
- [ ] **Forecast permalink.** Given a `forecast`, then it renders the issued-at forecast for its zone (conditions snapshot + periods + discussion + uncertainty note) with "Issued {scenario time}" and a "Current forecast" link to `/weather/zones/:zoneSlug`.
- [ ] **Supersession and revisions.** Given an update/upgrade/cancel chain, then the page shows "Replaced by / Upgrades / Cancels {headline}" links by permalink, and visible `update`/`correction` revisions in scenario time with their notes (FC-3); silent rewrites show nothing (platform adds no chrome, FC-9.5).
- [ ] **Watermark and imagery (NFR-008, D4-012).** Given imagery, then the bottom-right EXERCISE chip slot is reserved and rendered when required, `ExerciseBands` apply, alt text is required, and a page with no imagery still shows the exercise chrome (chrome and watermark never both off).
- [ ] **Tombstone (XC-010).** Given a retracted product, then the page renders the foundation tombstone shape in the Weather Desk skin ("This product has been withdrawn" + scenario time), never the headline/body; an unknown/draft/scheduled/cross-exercise permalink is the identical participant-world not-found.
- [ ] **Telemetry (XC-004, WX-022).** Given the page mounts, then `useContentViewTelemetry` emits one `article_view` per session+item with `payload.kind` of `weather_product|forecast` and `payload.productType` (passed as the allow-listed `extraPayload` of F15's `useContentViewTelemetry`, FC-6b), and a best-effort `content_dwell`; the client emits nothing for server-side issuance events (no double count).
- [ ] **Accessibility, mobile (NFR-001, #680).** WCAG 2.1 AA/508: one `h1`, landmarks, state/severity text not color-only, monospace text reflows at 320 px without horizontal scroll, axe clean; no COBRA, no default MUI look.

## Out of Scope
Sharing, comments (none in-fiction), print/PDF export, a participant "acknowledge" action, translations, related-products feeds beyond supersession links.

## Technical Notes
Files: `src/frontend/src/features/weather/pages/ProductPage.tsx`, `features/weather/hooks/useWeatherProduct.ts*` (thin wrapper over F15's `useContentItem` + payload guard from 01). Permalinks via `contentPermalink()`; all hrefs host-relative (FC-9.3).

## Dependencies
06, 07, 01 (guards), F15 (`useContentItem`, telemetry), F06 (API; mock until live). Can run with 08, 10, 11, 12, 13.
