# Story: Portal conformance

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** XC-001, XC-002, XC-004, COR-053, NFR-001 (+ PDF-12 #680, Section 508), NFR-002, NFR-004, NFR-008, PRT-010, PRT-041  ·  **Design decisions:** D0 §2/§4  ·  **Issue:** #786
**Stack:** testing  ·  **World:** both  ·  **Wave:** 5  ·  **Effort:** M

## Context
Proves the portal's cross-cutting promises on the foundation's reusable kit (F20): isolation, two worlds, scenario time, accessibility/508, burst legibility, the watermark rule, the alert absorption and kiosk-lite's read-only guarantee. No product code; this story only adds tests and e2e paths.

## Acceptance Criteria
- [ ] **Isolation (extends the standing suite).** Given hosts A and B, then `GET /api/portal`, `/api/portal/resources*` and every staff portal route return the same 404/403 for a cross-exercise attempt; the shared view-only password of exercise A presented on host B is checked against B's credential and never A's (the existing shared-login scope rule, re-asserted for the kiosk entry); a read-only (view-only) session is `403` on every mutating route (sampled from every feature's write routes). *(The display-token, `/api/display/state` and `display` session cases are Deferred with stories 05/08.)*
- [ ] **Two worlds.** Given `features/portal/**` (excluding tests) and the kiosk, then a static scan finds no import of `@/theme/styledComponents`, `cobraTheme` or `@mui/icons-material` and no default-MUI-theme render; given `features/controller/{portalSetup,topStoriesBoard}`, then a scan finds no participant-skin import; the resources shelf renders outside the portal scope.
- [ ] **Scenario time.** Given a scan of participant code under `features/portal/`, then no `Date.now()`, `new Date()` for display or `toLocale*` exists; a clock-jump test moves the portal dateline and the kiosk-lite dateline together.
- [ ] **Accessibility and 508 (#680).** Given the axe sweep over `/portal` (normal, advisory, emergency), the empty-subset matrix, `/portal/resources`, the kiosk-lite board and the two console surfaces, then no serious or critical violation remains, keyboard-only navigation reaches every control, severity is never color-only, and the evidence is recorded for the ACR; the kiosk-lite board is a single non-moving composition, documented as the WCAG 2.2.2 alternative.
- [ ] **Mobile.** Given 320 px and 390 px, then the portal and the resources shelf have no horizontal scroll, targets ≥ 44 px on coarse pointers, and the module order matches the server's.
- [ ] **Burst bench (NFR-002).** Given 120 posts/min into the feed, then the Social Stream module and the kiosk-lite board's social excerpt stay within the update-rate bound (≤ 1 visual update per 4 s), show zero cumulative layout shift, and never move focus.
- [ ] **Subset matrix.** Given every enable/disable combination of news, press, weather and social, then the portal renders a complete page (no empty frames, no dead links), the nav, modules and routes agree, and a disabled channel's permalink is `ChannelNotFound`.
- [ ] **Alert absorption (SOC-072).** Given one alert raised through `IAlertRaiser`, then the same headline appears on the bar on `/portal`, `/news` and Social, in the Social notification, and as the entry count; clearing it removes them all.
- [ ] **Watermark and chrome (NFR-008).** Given kiosk-lite (`/portal?display=1` on a view-only session) with chrome stripped, then the EXERCISE chip is present on every render, and a participant session with `display=1` keeps normal chrome; given chrome on, the portal lead hero reserves the chip; a test fails if both are ever off.
- [ ] **Telemetry and no-person display.** Given a portal visit and a kiosk-lite sign-in, then `portal_view` and the existing view-only `login` event appear against the v0 schema (the login's actor is the ephemeral `system` identity, no person-level field; `display_session_started` is Deferred), and no participant DTO contains a staff-only field or an absolute URL (the F19 tripwire covers portal producers and fixtures).
- [ ] **Content security.** Given a stored script in a resource body or a filler item, then it executes in no session.

## Out of Scope
Manual AT audit with NVDA/JAWS/VoiceOver (a #680 deliverable, scheduled outside this story), load testing beyond the burst bench.

## Technical Notes
Files: `Pulse.WebApi.Tests/Portal/**`, `features/portal/testing/**`, `e2e/portal/**`. Use F20's `channelConformance()` helpers and the existing Playwright setup (#606). Fixtures come from 02.

## Dependencies
All E3 stories, F20. Runs last (Wave 5).
