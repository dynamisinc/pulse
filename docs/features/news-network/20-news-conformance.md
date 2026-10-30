# Story: News conformance (skin matrix, CANNOT-list invariance, isolation, a11y/508)

**Feature:** News network  ·  **Epic:** E4  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-002, NWS-011, NWS-030, NWS-031, NWS-032, XC-001, NFR-001 (PDF-12 #680), NFR-004, NFR-008, COR-053  ·  **Design decisions:** D3-P1, D3-P2  ·  **Issue:** #737
**Stack:** testing  ·  **World:** participant  ·  **Wave:** E4-5  ·  **Effort:** M

## Context
The foundation conformance kit (foundation 20) provides `channelConformance()` helpers for isolation, XSS and an axe sweep. This story **plugs E4 into the kit** and adds the news-specific
invariants that make D3's guarantees executable: the CANNOT list is the same in every skin, and a fifth outlet needs no layout code.

## Acceptance Criteria
- [ ] **Skin matrix.** Given the four skins plus a fake fifth, then one parameterized suite renders article (normal, breaking, corrected, silent-rewritten, retracted, video-lead), home (every lead mode) and section pages and asserts the **CANNOT list** per skin: identical slot order, scenario-time source (a fixture time appears verbatim in every skin), Pulse embed markup, watermark chip position and presence, share action, absence of comments, a11y floor, and absence of reader-visible telemetry.
- [ ] **Hostile overrides.** Given `skinOverrides` attempting to reorder slots, hide the watermark, add `clutter` to a non-Scoop outlet, or inject markup/URLs, then the server (foundation 03) rejects it or the client ignores it; the rendered page is unchanged (CANNOT list is structural, not conventional).
- [ ] **Isolation (XC-001/002).** The news read routes, article permalink, section filter, link preview and embedded-post lookup are registered in the standing isolation suite: a session for exercise B gets the same 404 for exercise A's outlet slug, article, draft, scheduled item and post embed; participant DTOs never contain `origin`, `actingHumanId`, wall clock, `background`, `featuredRank`, `version`, `injectId`, draft/scheduled state.
- [ ] **XSS (NFR-004).** The payload corpus posted through `POST /api/content-items` (kind `article`) never executes on any participant page; stored cross-session script is inert in every skin; the editor preview (17) is also inert.
- [ ] **A11y / 508 (NFR-001, #680).** An axe sweep at 360px and 1280px across article/home/section in all four skins reports no serious/critical violations; keyboard-only e2e reaches share, discussion link, section nav, player controls and correction note; severity cues (breaking, correction, tombstone) have non-color text; reduced-motion respected; the a11y floor (≥ 16px body at mobile, AA) is asserted by computed styles.
- [ ] **Mobile e2e.** A Playwright run at phone width opens a shared permalink cold, logs in, lands on the article under the right skin, plays the hero video, shares to Pulse, and sees the link card in the Social feed; no horizontal scroll at 320px.
- [ ] **Two worlds + scenario time.** Static tests: no `@/theme/*` or `@mui/icons-material` import in `features/news/**`; no `Date.now`/`toLocale*` in participant news code; a staff-world test asserts the editor (17) imports no participant skin and the preview mounts participant tokens only in its subtree.

## Out of Scope
Load/perf beyond the 30-publish burst check (15); visual-regression baselines for final art (full-mockup deliverable); E10 telemetry correctness.

## Technical Notes
Files: `src/Pulse.WebApi.Tests/News/**`, `src/frontend/src/features/news/testing/**`, `e2e/news/**`. Builds on foundation `channelConformance()`; does not edit it.

## Dependencies
All other E4 stories; foundation 20 (kit), 06, 07, 15. Wave E4-5.
