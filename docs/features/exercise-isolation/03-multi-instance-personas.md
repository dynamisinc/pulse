# Story: Same persona template, independent instances per exercise

**Feature:** Exercise isolation  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-003  ·  **Design decisions:** none  ·  **Issue:** #46

## Context
Persona *templates* are reusable across exercises (XC-005), but each instantiation carries
exercise-scoped state. The same template may be instantiated in multiple concurrent exercises without
collision — independent post history, follower counts, and relationships per instance (COR-003).

## Acceptance Criteria
- [ ] A `PersonaTemplate` can be instantiated as a `Persona` in two or more concurrent exercises
      simultaneously.
- [ ] Each `Persona` instance holds its own exercise-scoped state (posts, followers, relationships);
      changes in exercise A never appear in exercise B's instance.
- [ ] A persona instance belongs to exactly one exercise (XC-005) and is subject to the central
      scoping (story 01).

## Out of Scope
Persona template authoring/casts (persona-management feature COR-020/021); persona operation from the
console (E7 persona-operation).

## Technical Notes
Foundation. The template↔instance split is the data model that makes reuse cheap and isolation safe.
See implementation.md (story 03).

## Dependencies
Story 01; the PersonaTemplate/Persona model (persona-management). Enables cast reuse across exercises.

## Tests
- Unit: instantiating one template in two exercises yields independent state; a mutation in A is
  invisible in B.
