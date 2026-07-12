# Story: Role set

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-010  ·  **Design decisions:** none  ·  **Issue:** #58

## Context
The role set that mirrors the exercise ecosystem and gates every surface: **Participant**, **PIO**
(participant flavor with monitoring defaults + Press Room authoring), **Controller**, **Evaluator**
(read-everything, write-nothing in the sim), **Planner/ExerciseAdmin**, **OrgAdmin** — aligned with
Cadence's ExerciseRole vocabulary where sensible (COR-010).

## Acceptance Criteria
- [ ] The six roles exist and gate access: participant/PIO surfaces vs staff (controller/evaluator/
      planner) surfaces vs org administration.
- [ ] Role determines surface reachability — a participant role cannot reach any staff surface (XC-002),
      and an Evaluator cannot write in the sim (COR-013, story 04).
- [ ] PIO is a participant flavor with monitoring defaults and Press Room authoring rights (the latter
      activates when E5 lands).
- [ ] Roles are exercise-scoped assignments (a person's role is per exercise).

## Out of Scope
Evaluator write-nothing enforcement detail (story 04); staff cross-exercise assignment (StaffAssignment,
exercise-isolation story 05); org-account grants (story 09).

## Technical Notes
Foundation. Role checks gate routes/APIs; align naming with Cadence ExerciseRole. See implementation.md
(story 01).

## Dependencies
Exercise-isolation (scoping). Underpins every gated surface.

## Tests
- Unit/integration: each role reaches its allowed surfaces and is denied the others.
