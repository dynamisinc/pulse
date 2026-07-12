# Story: Trending recompute (scoped, ≤60s)

**Feature:** Hashtags & trending  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-042  ·  **Design decisions:** none  ·  **Issue:** #108

## Context
Trending is exercise-scoped and recomputed at near-real-time cadence (**≤60s staleness**) (SOC-042).

## Acceptance Criteria
- [ ] The trending list recomputes at ≤60s staleness from live activity.
- [ ] Trending is strictly exercise-scoped (COR-001) — one exercise's activity never influences
      another's trends.
- [ ] Recompute stays performant under burst load (NFR-002) without degrading feed delivery.

## Out of Scope
The ranking formula (story 02); the display (story 02).

## Technical Notes
Backend/compute. A scoped, windowed recompute job. See implementation.md (story 03).

## Dependencies
story 02 (ranking); E1 isolation. Performance ties to NFR-002.

## Tests
- Unit/integration: recompute reflects new activity within 60s and is exercise-scoped.
