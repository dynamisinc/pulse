# Story: Follow / unfollow

**Feature:** Profiles & social graph  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-051  ·  **Design decisions:** none  ·  **Issue:** #110

## Context
Follow/unfollow with follower-count effects; participants can follow any account in their exercise
(SOC-051). Follow edges feed the Following feed (feeds-discovery SOC-081).

## Acceptance Criteria
- [ ] A participant can follow/unfollow any account in their exercise (COR-001); the follow button
      reflects state.
- [ ] Following affects the follower/following counts (real edges component of magnitude, story 05) and
      the Following feed (feeds-discovery SOC-081).
- [ ] Follow/unfollow emits telemetry (XC-004).
- [ ] Observer/read-only mode: the Follow control is **absent** (D1-011); counts remain visible.

## Out of Scope
Magnitude display (story 05); the Following feed itself (feeds-discovery); suggested follows (story 04).

## Technical Notes
Participant world. Follow edge write + optimistic count. See implementation.md (story 02).

## Dependencies
story 01 (profile); feeds-discovery (Following feed consumes edges); telemetry (XC-004).

## Tests
- Component (RTL): follow/unfollow toggles state + count; observer sees no Follow control.
