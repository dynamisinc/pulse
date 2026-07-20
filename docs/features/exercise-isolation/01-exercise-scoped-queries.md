# Story: Every entity is exercise-scoped (central query filter)

**Feature:** Exercise isolation  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** COR-001  ·  **Design decisions:** none  ·  **Issue:** #44

## Context
The bedrock guarantee: every content and social-graph entity carries an `ExerciseId`, and all queries
on participant-facing paths filter by the session's exercise — enforced **centrally** (a query
filter/interceptor), not per-endpoint, so a new endpoint cannot accidentally omit the scope (COR-001).

## Acceptance Criteria
- [x] Every content/social-graph entity carries an `ExerciseId`; the schema makes it non-nullable on
      those entities.
- [x] Given a participant session in exercise A, when any participant-facing query runs, then it is
      automatically filtered to exercise A by a central filter/interceptor — no per-endpoint opt-in.
- [x] A query that attempts to omit the exercise scope on a participant-facing path fails closed (no
      results / error), not open (leaking all exercises).
- [x] The scoping is covered by the standing isolation suite (COR-007, story 07).

## Out of Scope
Media-URL access-checks (story 02); staff cross-exercise queries (story 05); the per-exercise hostname
(story 08). The specific ORM/EF-Core global-query-filter mechanism is a backend implementation detail.

## Technical Notes
Foundation (backend-first). Mirrors Cadence's multi-tenant query filtering. The frontend relies on a
scoped API — it does not re-implement scoping, but must never construct a cross-exercise request. See
implementation.md (story 01).

## Dependencies
Exercise entity + exercise-context resolution. Blocks essentially all participant-facing stories.

## Tests
- Unit/integration: a query in exercise A never returns exercise B rows; omitting the scope fails closed.
- Part of the standing isolation suite (story 07).
