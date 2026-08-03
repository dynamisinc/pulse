# Story: Exercise duplication

**Feature:** Exercise build & go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-045  ·  **Design decisions:** none  ·  **Issue:** #76

## Context
Exercises are duplicable: clone an exercise's world (cast, theming, filler, scheduled content, config)
as the starting point for the next exercise — **not** participant data or conduct history. The build
investment compounds (COR-045).

## Acceptance Criteria
- [ ] A planner can clone an exercise into a new exercise that copies the **world**: cast/personas,
      theming, filler/backdated content, scheduled content, and configuration.
- [ ] The clone **excludes** participant accounts/data and conduct history (posts fired during conduct,
      telemetry, AAR).
- [ ] The cloned exercise is a fresh, isolated instance (exercise-isolation) in Build state ready to
      adjust.
- [ ] Cloning is a staff/planner action, staff-only (XC-002).

## Out of Scope
AAR export of the source (E10); template/cast library management (persona-management); the lifecycle
of the new exercise (exercise-configuration).

## Technical Notes
Foundation. A deep-copy of world-definition entities, excluding conduct/participant data. See
implementation.md (story 06).

## Dependencies
Stories 01/04; exercise-configuration (new exercise in Build); persona-management (cast). Compounds
build investment. **`exercise-lifecycle-admin/01-exercise-creation.md` (COR-074) is a hard
prerequisite, filed 2026-08-01:** duplication has always presupposed a create path, and until that
story none existed as a requirement, a story, or a customer-facing endpoint — only the secret-gated
ops bootstrap seam could create an `Exercise` row. Duplication targets the same creation path
(hostname allocation, `Build` status, creator `StaffAssignment`, org ownership) that story
establishes; it does not invent a second one.

## Tests
- Integration: cloning copies world definition and config but not participant data or conduct history;
  the clone is isolated.
