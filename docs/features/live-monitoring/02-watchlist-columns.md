# Story: Watchlist columns (TweetDeck-style)

**Feature:** Live monitoring  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-031  ·  **Design decisions:** none  ·  **Issue:** #31

## Context
A controller tracks specific threads of the unfolding world as **columns** — a hashtag, a rumor
thread, a persona — TweetDeck-style, so the `#911` cluster and the county-EM account sit side by side
with the All-Posts firehose (CTL-031).

## Acceptance Criteria
- [ ] Given the monitoring surface, when the controller adds a watch (hashtag, thread, or persona),
      then a column appears streaming matching activity live, and columns can be reordered/removed.
- [ ] Each column updates in near-real-time and stays legible under burst (NFR-002 / SOC-071).
- [ ] Column config persists for the controller across a session; columns are scoped to the active
      exercise (COR-001) and staff-only (XC-002).
- [ ] Columns are keyboard-navigable with live-region semantics (NFR-001).

## Out of Scope
The base activity board (story 01); expected-action tracking (story 03); acting on watched items
(steering/takedown live in world-steering); rumor-object tracking (rumor-tracker, Phase 2).

## Technical Notes
Staff world (COBRA). Columns are saved queries over the same activity stream as story 01; reuse the
virtualized list. Mounts in console-shell. See implementation.md (story 02).

## Dependencies
Story 01 (activity stream + list); console-shell; E2 hashtags/threads/personas.

## Tests
- Component (RTL): adding a hashtag watch creates a column streaming matching posts.
- Unit: column config persists; each column is exercise-scoped.
