# Story: Amplification counts (queryable)

**Feature:** Amplification (reposts & quotes)  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-021  ·  **Design decisions:** none  ·  **Issue:** #102

## Context
Repost/quote counts display on posts and are **queryable for spread analysis** — the input to E10's
misinformation-containment metrics (SOC-021).

## Acceptance Criteria
- [ ] Repost and quote counts render on the post card action row (posts/02) and update in near-real-time.
- [ ] Counts are queryable/aggregable for spread analysis (E10) — not just a display number.
- [ ] Counts are exercise-scoped (COR-001) and consistent across surfaces (feed, thread, profile).

## Out of Scope
The E10 metrics UI (E10); chain ordering (story 03).

## Technical Notes
Participant world display + queryable aggregate. See implementation.md (story 02).

## Dependencies
story 01 (the events counted); posts/02 (card).

## Tests
- Unit: repost/quote counts aggregate correctly and are exercise-scoped.
