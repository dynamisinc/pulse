# Story: Content lock at go-live

**Feature:** Exercise build & go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-044  ·  **Design decisions:** none  ·  **Issue:** #75

## Context
Content created during Build is versioned/locked at go-live, consistent with any linked Cadence MSEL
approval state (INT-003, Phase 4). Post-lock changes during conduct are controller actions (E7),
audit-logged (COR-044).

## Acceptance Criteria
- [ ] At go-live, Build content is versioned/locked so the world entering conduct is a known, stable set.
- [ ] Post-lock changes during conduct are made as **controller actions** (E7), each audit-logged
      (XC-004) — not silent edits to the locked baseline.
- [ ] When linked to a Cadence MSEL (Phase 4, INT-003), the lock is consistent with the MSEL approval
      state; in standalone mode the lock is native.

## Out of Scope
Cadence MSEL integration itself (E9, Phase 4); the controller edit actions (E7 inject-queue
edit-then-fire); the lifecycle transition (story 04).

## Technical Notes
Foundation. A versioning/lock boundary at go-live; conduct edits are attributed controller actions.
See implementation.md (story 05).

## Dependencies
Story 04 (go-live); E7 (conduct edits); E9/INT-003 (Phase 4 MSEL consistency).

## Tests
- Integration: go-live locks/versions Build content; a conduct edit is recorded as an attributed
  controller action.
