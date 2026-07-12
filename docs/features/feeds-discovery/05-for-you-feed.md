# Story: Engagement-weighted "For You" mode (stretch)

**Feature:** Feeds & discovery  ·  **Epic:** E2  ·  **Phase:** 1 (stretch)  ·  **Status:** Not Started
**Requirements:** SOC-084  ·  **Design decisions:** none  ·  **Issue:** #124

## Context
A *stretch* engagement-weighted "For You" feed mode (per-exercise toggle) that amplifies sensational
content — the feed-algorithm-as-teaching-mechanic from the vision doc. **Chronological remains the
launch default** (SOC-084).

## Acceptance Criteria
- [ ] When enabled per exercise, a "For You" feed ranks by engagement (amplifying sensational/high-
      velocity content) as an alternative to chronological.
- [ ] Chronological is the **default**; "For You" is opt-in per exercise config (D1-002, not a
      participant-visible platform toggle beyond the tab).
- [ ] The ranking is exercise-scoped (COR-001) and does not break burst legibility (NFR-002) or the pill
      behavior (story 04).

## Out of Scope
Being on by default (it is stretch/opt-in); the chronological feeds (stories 01/02).

## Technical Notes
Participant world. An alternate ranking over the same feed infra; gated by exercise config. Lower
priority than 01–04/06. See implementation.md (story 05).

## Dependencies
stories 01/04; exercise-configuration (enablement). Marked stretch — build after the core feeds.

## Tests
- Unit: with "For You" enabled, ranking weights engagement; default remains chronological.
