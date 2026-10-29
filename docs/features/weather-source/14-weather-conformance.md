# Story: Weather conformance — isolation, watermark, a11y/508, fictional-NWS guard

**Feature:** Weather source  ·  **Epic:** E6  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** XC-001, XC-002, NFR-001, NFR-004, NFR-008, PDF-12 (#680), WX-001, WX-011  ·  **Design decisions:** D4-009, D4-010, D4-012  ·  **Issue:** —
**Stack:** testing  ·  **World:** both  ·  **Wave:** 6  ·  **Effort:** M

## Context
Plugs E6 into the foundation's conformance kit (F20) and adds the weather-specific guards that no single story owns: the cross-surface headline-equality check, the severity-never-color-only sweep, the watermark
check and the "never the real NWS" scan.

## Acceptance Criteria
- [ ] **Isolation suite.** Given exercises A and B, then every E6 participant route (`/api/weather/zones`, `/site`, `/summary`, and weather permalinks/lists through F06) returns A's data to A and 404 for B's ids; the staff routes (`/timeline`, `/zones`, `issue-update`) are scoped to the staff session's exercise; a disabled weather channel 404s all participant routes.
- [ ] **One headline, four surfaces (D4-010).** Given a published warning, then an integration test asserts the identical headline string on the alert (`GET /api/alerts`), the `@WeatherDesk` post text, the widget summary `top.headline`, and the product permalink DTO — including after a headline `correction` — and that a `delivery.post.text` override changes only the post.
- [ ] **Warning forces emergency (C-2).** Given every hazard as a `warning`, then the raised alert severity is `emergency`; watch is `advisory`; advisory is `info`; a test fails if any per-hazard mapping is introduced silently.
- [ ] **Severity and a11y/508 sweep (NFR-001, #680).** Given the site, product, forecast and widget pages at 320 px and 1280 px with the full severity matrix, then axe has no serious/critical violations, every severity chip has icon + text + colour (asserted by DOM), contrast of every token pair >= 4.5:1, keyboard-only traversal reaches the zone selector, alerts and permalinks, and live-region announcements are coalesced.
- [ ] **Watermark and scenario time (NFR-008, COR-053).** Given a product with imagery, then the bottom-right EXERCISE slot renders when required and chrome/watermark are never both off; a scan of `features/weather` participant code finds no `Date.now`, `toLocale*`, `new Date()` display or "scenario time" string; a scan of backend weather DTOs finds no wall-clock fields.
- [ ] **Fictional-NWS guard (WX-001).** Given the weather fixtures, seeds, strings and tokens, then a scan fails on `National Weather Service`, `NOAA`, `weather.gov`, real WFO identifiers, SAME/EAS codes, absolute URLs and real county FIPS; the masthead and `@WeatherDesk` identity are the only brand names.
- [ ] **Content security (NFR-004).** Given a script/`onerror` payload in headline, narrative, IBW and discussion, then neither the API response nor any rendered page executes it, and weather bodies are served plain text.

## Out of Scope
Re-testing foundation behaviour (F20 covers it), load testing the scheduler, visual regression of the skin.

## Technical Notes
Files: `Pulse.WebApi.Tests/Weather/Conformance/**`, `src/frontend/src/features/weather/testing/**`, `e2e/weather/**`. Use `channelConformance()` from `Pulse.WebApi.Tests/Channels/Conformance` and `features/channels/testing`. Read-only against other stories' files.

## Dependencies
Everything in E6 (01–13) and F20. Last wave.
