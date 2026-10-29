# Story: Channel conformance kit (isolation, stored-XSS, a11y / Section 508)

**Feature:** Channels foundation  ·  **Epic:** cross-cutting  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** XC-001, XC-002, NFR-001, NFR-004, NFR-008, PDF-12 (#680 Section 508)  ·  **Design decisions:** D0 §4  ·  **Issue:** —
**Stack:** testing  ·  **World:** both  ·  **Wave:** 5  ·  **Effort:** M

## Context
The channel stories each owe the same proofs. Rather than four copies, this story builds a reusable kit and applies it to the foundation, so E4/E5/E6/E3 each add **one line** to be
covered: the standing isolation suite, the stored-XSS corpus, and the axe sweep that feeds PDF-12's ACR/VPAT evidence (PDF-12 itself, the manual AT audit and the Playwright gate are #680's).

## Acceptance Criteria
- [ ] **Isolation helper.** Given `channelConformance.isolation({ channel, createPublished, createDraft, route })`, then it asserts against the real host that: another exercise's id/slug ≡ unknown (404), a draft/scheduled/retracted-deleted item is the same 404, a disabled channel is 404, no response contains an exercise id or admin field, and the realtime frame for exercise A is not received on B. The foundation's own routes are registered in the standing suite with it.
- [ ] **Stored-XSS corpus.** Given `channelConformance.xss({ author, read, render })`, then a corpus (script tags, event handlers, `javascript:`/`data:` URLs, SVG/MathML, CSS expressions, mutation XSS, oversized/invalid media types) authored as `bodyHtml`, headline, dek, byline, outlet name, tagline and alert headline never executes in a **second** session's rendered DOM and is neutralized server-side at write (NFR-004).
- [ ] **A11y sweep (Vitest).** Given `expectNoAxeViolations(page)`, then every foundation primitive and the shell integration (alert bar over two channels) have no serious/critical axe violations, severity is conveyed by text + icon, live regions are `role=status`/`aria-live` as specified, and the sweep is runnable by channels with their own pages.
- [ ] **A11y sweep (Playwright, `e2e/channels/`).** Given the existing `@playwright/test` setup (#606), then one flow per content channel (permalink on a 390px viewport, keyboard-only navigation, 200% zoom, reduced motion) passes axe and a keyboard-trap check; results are emitted as artifacts PDF-12 can cite in the ACR.
- [ ] **Scenario-time guard.** A static check fails the build on `Date.now`, `new Date()` display formatting, `toLocale*` or relative-time libraries in participant channel code (COR-053); a fixture asserts no wall-clock string appears in participant DTOs.
- [ ] **Watermark and no-enterprise-look guards.** A test fails if a high-risk kind renders without `WatermarkSlot`, if chrome and watermark are both off, or if a participant channel module imports `@/theme`/`styledComponents` (two-worlds).
- [ ] **Telemetry conformance.** `channelConformance.telemetry` asserts a publish emits exactly one server event of the FC-6 type with wall + scenario time, actor incl. acting human, and a view emits exactly one `article_view` with a session/participant id.
- [ ] **Migration-ledger test.** Given the migration history, then the five ledger migrations (M1 F01, M2 portal 01, M3 weather 02, M4 F16, M5 press 06) appear in that order once present, each carries its `Channels_M<n>` token, no other migration touches their tables, and the model snapshot matches `Up` on a clean database; features not yet merged are skipped, not failed.
- [ ] **Docs.** A short `README` lists how a channel opts in (three calls) and which PDF-12 evidence each check feeds.

## Out of Scope
The ACR/VPAT document, manual NVDA/JAWS/VoiceOver audit and the CI gate wiring (PDF-12 #680); load testing of channels (PDF-03 slice); visual regression.

## Technical Notes
Files: `src/Pulse.WebApi.Tests/Channels/Conformance/**`, `src/frontend/src/features/channels/testing/**`, `e2e/channels/**`. Reuse the existing isolation test suite scaffolding (`exercise-isolation/07`), `RequiresDockerFact`, vitest-axe if already present (else the existing axe setup the shell tests use).

## Dependencies
All stories 01–19 (Wave 5, runs last). Coordinate with PDF-12 so the helpers are the same ones its gate calls.
