# Story: Archived exercises fully separable

**Feature:** Exercise isolation  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-006  ·  **Design decisions:** none  ·  **Issue:** #49

## Context
Completed/archived exercises must be fully separable for AAR export and must never contaminate live
queries (COR-006). An archived world is history; it cannot appear in any running exercise's feeds,
search, or metrics.

## Acceptance Criteria
- [ ] A completed/archived exercise's data is cleanly separable for AAR export (E10) as a self-contained
      set.
- [ ] Archived-exercise content never appears in any live exercise's participant or staff queries.
- [ ] Archiving does not hard-delete (XC-010); the world remains available read-only for hotwash per
      lifecycle (COR-054).

## Out of Scope
The AAR export format/UI (E10); the lifecycle transition mechanics (exercise-configuration COR-032);
retention/purge policy (NFR-007).

## Technical Notes
Foundation. Archived state is a lifecycle status that the central scoping treats as excluded from live
queries. See implementation.md (story 06).

## Dependencies
Story 01; exercise lifecycle (exercise-configuration COR-032); EndEx (exercise-clock COR-054).

## Tests
- Integration: archived-exercise rows are excluded from live queries and exportable as a set.
