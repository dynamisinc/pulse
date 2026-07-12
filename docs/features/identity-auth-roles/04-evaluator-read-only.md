# Story: Evaluator read-everything, write-nothing

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-013  ·  **Design decisions:** none  ·  **Issue:** #61

## Context
The Evaluator role can see all channels and all controller activity but **cannot post, react, or DM**
(COR-013). Evaluators observe the world (and later score it, E10) without perturbing it.

## Acceptance Criteria
- [ ] An Evaluator can view all channels and controller activity (read access across the exercise).
- [ ] An Evaluator **cannot** post, reply, react, repost, follow, or DM anywhere in the sim — write
      paths are denied for the role.
- [ ] The evaluator's read access is exercise-scoped (exercise-isolation story 01) and staff-world
      (never a participant surface).
- [ ] The console/monitoring surfaces expose evaluator variants with steering controls **absent, not
      disabled** (per D5 CTL-033 backlog; full variant is later).

## Out of Scope
The evaluator dashboard/analytics (E10/D6); the read-only console variant build (live-monitoring
CTL-033 backlog); DM observability plumbing (E2 SOC-062).

## Technical Notes
Staff world. Role-level write denial across sim actions; read access rides the same scoped queries.
See implementation.md (story 04).

## Dependencies
Story 01 (roles); exercise-isolation (scoped read). Relates to E10 evaluator surfaces.

## Tests
- Integration: every sim write path is denied for Evaluator; reads across channels succeed.
