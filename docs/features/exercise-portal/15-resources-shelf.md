# Story: Resources shelf

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-022, PRT-021, NFR-001, NFR-004, XC-001, XC-004  ·  **Design decisions:** D2-007  ·  **Issue:** #779
**Stack:** frontend  ·  **World:** participant (the sanctioned out-of-fiction shelf)  ·  **Wave:** 3  ·  **Effort:** M

## Context
PRT-022: an optional area for exercise-supplied non-fiction materials (quick-start guide, ground rules), "the one sanctioned immersion-adjacent surface, kept visually separate from fictional content". D2-007: it drops the news costume (system-ui, exercise-green framing, "EXERCISE MATERIALS" badge); the entry is a quiet hairline link plus a footer link, never a module competing with the news. It is the one place the fourth wall officially thins.

## Acceptance Criteria
- [ ] **Entry points.** Given `hasResources: true`, then the portal shows a quiet hairline link and a footer link to `/portal/resources`; given `false` (no visible resources) or the portal disabled, then neither link renders and the route is `ChannelNotFound`.
- [ ] **Separate look (D2-007).** Given the shelf page, then it renders in system-ui with exercise-green framing and an "EXERCISE MATERIALS" badge, **outside** the portal skin scope (no masthead, no module styling), so it can never be mistaken for in-fiction content; it imports no COBRA and no default MUI look.
- [ ] **Content.** Given `GET /api/portal/resources`, then it lists resources in order with title and summary; a resource opens in place (or a sub-route) with its sanitized body through `SanitizedBody` and an optional image with authored `alt`; a hidden or unknown id shows participant-world not-found.
- [ ] **No platform time (COR-053 boundary, C-4).** Given the page, then the platform renders no date or time of its own; any real-world times are only inside the planner's authored body text.
- [ ] **Content security (NFR-004).** Given a body that contained script or an external link at write time, then nothing executes or links out here (defense in depth with 04); no `dangerouslySetInnerHTML` outside `SanitizedBody`.
- [ ] **Telemetry.** Given a resource is opened, then one `resource_view` is emitted (PC-6) per session per resource.
- [ ] **Compliance chrome and nav.** Given the shelf, then the shell's compliance chrome and alert bar still frame it (PRT-021) and the shelf is **not** a channel in the nav (it is reached from the portal only).
- [ ] **Mobile and a11y.** Given 320 px, then one column, 16 px minimum body, targets ≥ 44 px, correct heading order, axe clean; the badge is text, not color.

## Out of Scope
Authoring (16), the API (04), PDF viewing (until press 02), external links, kiosk display of resources (the kiosk never shows non-fiction).

## Technical Notes
Files: `features/portal/resources/**`. Reuse `SanitizedBody` (F14), `ChannelNotFound` (F12). System fonts only for the shelf.

## Dependencies
02, 04 (route; fixtures until live), F14. Can run with 09-14, 16.
