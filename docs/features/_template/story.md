# Story: <title>

**Feature:** <parent feature>  ·  **Epic:** <E#>  ·  **Phase:** <1-4>  ·  **Status:** Not Started
**Requirements:** <CTL-002, ...>  ·  **Design decisions:** <D5-xxx, or none>  ·  **Issue:** <#n, or —>

## Context
<Why this story exists; the requirement(s) it satisfies; which world (participant/staff) the
surface lives in. Link to the epic section and the feature.md.>

## Acceptance Criteria
- [ ] <observable, testable outcome — Given/When/Then preferred>
- [ ] <...>
<!-- Attach the cross-cutting ACs the story warrants (see story-agent):
- [ ] Isolation (XC-001/COR-001): data is exercise-scoped; a cross-exercise access attempt returns 403/404.
- [ ] Telemetry (XC-004): the action emits an event (wall + scenario time, actor, channel) per the v0 schema.
- [ ] Scenario time (COR-053): participant-visible times render in scenario time in the exercise TZ.
- [ ] Accessibility (NFR-001): WCAG 2.1 AA; severity/alert never color-only; live-region on feeds.
- [ ] Content security (NFR-004): free-text/upload paths sanitized; a stored script can't execute elsewhere.
- [ ] No-enterprise-look (D0 §2): participant surface uses the brand skin; no COBRA, no default MUI look.
-->

## Out of Scope
<What this story deliberately does NOT do — guards against scope creep and later-phase leakage.>

## Technical Notes
<Relevant paths (src/frontend/src/features/...); participant skin vs COBRA; MUI 9 sx-only;
libraries; gotchas. Cross-reference the feature's implementation.md (reuse map + wave).>

## Dependencies
<Stories/requirements that must land first, or "none".>

## Tests
<Cited test files (src/frontend/src/**/*.test.tsx) or a documented manual check while the harness
is thin. Each done AC should link to a check here.>
