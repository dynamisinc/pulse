# Story: Portal conformance

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** XC-001, XC-002, XC-004, COR-053, NFR-001 (+ PDF-12 #680, Section 508), NFR-002, NFR-004, NFR-008, PRT-010, PRT-041  ·  **Design decisions:** D0 §2/§4  ·  **Issue:** —
**Stack:** testing  ·  **World:** both  ·  **Wave:** 5  ·  **Effort:** M

## Context
Proves the portal's cross-cutting promises on the foundation's reusable kit (F20): isolation, two worlds, scenario time, accessibility/508, burst legibility, the watermark rule, the alert absorption and the kiosk's read-only guarantee. No product code; this story only adds tests and e2e paths.

## Acceptance Criteria
- [ ] **Isolation (extends the standing suite).** Given hosts A and B, then `GET /api/portal`, `/api/portal/resources*`, `/api/display/state` and every staff portal/display route return the same 404/403 for a cross-exercise attempt; a display token minted for A on host B is a bodyless 401 identical to an unknown token; a participant or staff session is `404` on `/api/display/state`; a display session is `403` on every mutating route (sampled from every feature's write routes).
- [ ] **Two worlds.** Given `features/portal/**` (excluding tests) and the kiosk, then a static scan finds no import of `@/theme/styledComponents`, `cobraTheme` or `@mui/icons-material` and no default-MUI-theme render; given `features/controller/{portalSetup,display,topStoriesBoard}`, then a scan finds no participant-skin import; the resources shelf renders outside the portal scope.
- [ ] **Scenario time.** Given a scan of participant code under `features/portal/`, then no `Date.now()`, `new Date()` for display or `toLocale*` exists; a clock-jump test moves the portal dateline and the kiosk dateline together.
- [ ] **Accessibility and 508 (#680).** Given the axe sweep over `/portal` (normal, advisory, emergency), the empty-subset matrix, `/portal/resources`, the kiosk slides and the three console surfaces, then no serious or critical violation remains, keyboard-only navigation reaches every control, severity is never color-only, and the evidence is recorded for the ACR; kiosk pinned mode is documented as the WCAG 2.2.2 alternative.
- [ ] **Mobile.** Given 320 px and 390 px, then the portal and the resources shelf have no horizontal scroll, targets ≥ 44 px on coarse pointers, and the module order matches the server's.
- [ ] **Burst bench (NFR-002).** Given 120 posts/min into the feed, then the Social Stream module and the kiosk feed slide stay within the update-rate bound (≤ 1 visual update per 4 s), show zero cumulative layout shift, and never move focus.
- [ ] **Subset matrix.** Given every enable/disable combination of news, press, weather and social, then the portal renders a complete page (no empty frames, no dead links), the nav, modules and routes agree, and a disabled channel's permalink is `ChannelNotFound`.
- [ ] **Alert absorption (SOC-072).** Given one alert raised through `IAlertRaiser`, then the same headline appears on the bar on `/portal`, `/news` and Social, in the Social notification, and as the entry count; clearing it removes them all.
- [ ] **Watermark and chrome (NFR-008).** Given the kiosk with chrome stripped, then the EXERCISE chip is present on every slide; given chrome on, the portal lead hero reserves the chip; a test fails if both are ever off.
- [ ] **Telemetry and no-person display.** Given a portal visit and a display exchange, then `portal_view` and `display_session_started` appear against the v0 schema, the display event has no person-level actor field, and no participant DTO contains a staff-only field or an absolute URL (the F19 tripwire covers portal producers and fixtures).
- [ ] **Content security.** Given a stored script in a resource body or a filler item, then it executes in no session.

## Out of Scope
Manual AT audit with NVDA/JAWS/VoiceOver (a #680 deliverable, scheduled outside this story), load testing beyond the burst bench.

## Technical Notes
Files: `Pulse.WebApi.Tests/Portal/**`, `features/portal/testing/**`, `e2e/portal/**`. Use F20's `channelConformance()` helpers and the existing Playwright setup (#606). Fixtures come from 02.

## Dependencies
All E3 stories, F20. Runs last (Wave 5).
