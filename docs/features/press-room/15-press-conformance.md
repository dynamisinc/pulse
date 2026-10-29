# Story: Press conformance and the compose-to-publish bench

**Feature:** Press Room  ·  **Epic:** E5  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** XC-001, XC-002, XC-004, NFR-001 (+ PDF-12 #680), NFR-004, NFR-008, D4-001 (<60s bench)  ·  **Design decisions:** D4-001, D4-002, D4-003  ·  **Issue:** #751
**Stack:** testing  ·  **World:** both  ·  **Wave:** 6  ·  **Effort:** M

## Context
E5 is the one channel where participants write content other participants read, so isolation, injection and leak testing matter more than for any read-only channel. This story plugs E5 into the foundation's
`channelConformance()` kit (F20) and adds the E5-specific checks.

## Acceptance Criteria
- [ ] **Standing isolation suite (XC-001/002).** Given every E5 route (`/api/press/*`, press reads), then the suite proves a second-exercise session gets 404 for ids and listings, no `exerciseId` is accepted in any URL/body, and disabled-press returns the same 404 as unknown.
- [ ] **Authorization matrix.** Given roles (citizen, media, PIO with/without org grant, approver, controller, evaluator), then each route allows only the intended callers; no participant can retract, `correct`, `silent_rewrite`, read another org's drafts, or reach the staff routes.
- [ ] **Leak test (XC-002).** Given serialized participant and author JSON for every state, then none contains `origin`, `actingHumanId`, `injectId`, `featuredRank`, `background`, wall-clock fields, `crossPost`/`approval` internals (beyond the author's return note), or absolute URLs.
- [ ] **Hostile attachments and paste (NFR-004).** Given the story-02 corpus and a paste corpus (Word HTML with scripts, handlers, `javascript:`, data URIs, CSS expressions), then hostile uploads are rejected, bodies are sanitized, and in a browser test a stored payload never executes in another session and an attachment link always downloads (`Content-Disposition: attachment`) and never renders or navigates the page.
- [ ] **Accessibility sweep (NFR-001, PDF-12 #680).** Given composer (all states: empty, attachment added, embargoed, pending, returned), wire, newsroom, release page, tombstone, approval inbox/review, then axe finds no serious violations; keyboard-only walkthrough of type/paste → headline → embargo → confirm passes; live-region announcements asserted; severity/state chips are icon + text.
- [ ] **Mobile and two worlds.** Given 360px viewports, then composer and release page have no horizontal scroll; a lint/import test proves `features/press/**` imports no COBRA theme/styledComponents and no `@mui/icons-material`; the console editors import no participant skin.
- [ ] **Scenario time (COR-053).** Given an exercise whose scenario time differs from wall clock, then every timestamp in composer, wire, release page and approval UI shows scenario time; a tripwire scans `features/press/**` for `Date.now`/`toLocale*`.
- [ ] **Compose-to-publish bench (D4-001, rewritten for rich text first).** Given a scripted PIO (Playwright) with a prepared headline and a pasted Word body (and, in a second run, a clean PDF attachment), then paste body → type headline → release now → confirm → visible on the wire completes in **< 60s** wall time on the CI profile, recorded as a trend, not a flaky hard fail (hard fail at 3×).
- [ ] **Embargo and approval e2e.** Given a scheduled release, then it is invisible to a citizen session, visible to the author org with the SCHEDULED chip, and appears at the scenario time including after a forward clock jump (F05 rule); with the gate on, submit → return with note → resubmit → approve → publish passes end to end and emits the expected PC-5 events.
- [ ] **Portal-row invariants (R-P1).** Given releases in every state, then the press list endpoint and `/api/channels/press/content` never include a scheduled/embargoed or draft release, every published summary has a non-empty `dek` and `outlet.name` equal to the publishing org, and a headline-only release's dek is the `News release from {org}` fallback.
- [ ] **Telemetry completeness.** The story-12 completeness test runs in CI against the e2e flow.
- [ ] **Watermark (NFR-008).** The release page shows the watermark slot when required and never has chrome and watermark both off.

## Out of Scope
Load/burst testing of the wire (the foundation's NFR-002 coverage); weather/news pages; visual regression baselines beyond the sweep.

## Technical Notes
Files: `Pulse.WebApi.Tests/Press/**`, `features/press/testing/**`, `e2e/press/**`. Uses F20 helpers (`channelConformance()`), corpora from stories 02/04. Bench threshold documented in the test, not a magic number.

## Dependencies
All in-scope E5 stories (01–02, 04–14; 03 is Deferred) and foundation F20. Last in the DAG.

## Tests
This story is the tests.
