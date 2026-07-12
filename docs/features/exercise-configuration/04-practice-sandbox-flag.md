# Story: Practice/sandbox flag

**Feature:** Exercise configuration  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-033  ·  **Design decisions:** none  ·  **Issue:** #70

## Context
A practice/sandbox flag lets staff run rehearsals whose data is **excluded from evaluation exports**
(COR-033) — so a load rehearsal or a controller dry-run doesn't pollute the AAR.

## Acceptance Criteria
- [ ] An exercise (or run) can be flagged practice/sandbox.
- [ ] Data produced under the flag is **excluded from evaluation exports** (E10) while remaining
      otherwise functional for the rehearsal.
- [ ] The flag is staff-only (XC-002) and clearly indicated in staff surfaces so a rehearsal is never
      mistaken for real conduct.

## Out of Scope
The evaluation export itself (E10); the readiness-dashboard load rehearsal (exercise-build-golive
COR-042 / NFR-002).

## Technical Notes
Foundation flag read by E10 export filtering. See implementation.md (story 04).

## Dependencies
Story 01; E10 export (consumes the flag). Supports the load rehearsal (COR-042).

## Tests
- Integration: data under the practice flag is excluded from evaluation export.
