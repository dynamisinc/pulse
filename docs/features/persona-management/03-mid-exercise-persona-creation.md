# Story: Mid-exercise persona creation (≤60s)

**Feature:** Persona management & cast libraries  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-022  ·  **Design decisions:** none  ·  **Issue:** #55

## Context
Personas can be created mid-exercise by controllers in **≤60 seconds** (name, handle, type, avatar
pick) — supporting E7's "spin up personas in response to unexpected participant behavior" (COR-022).
This is the E1 data/create capability behind the E7 console quick-create UI (persona-operation/05).

## Acceptance Criteria
- [ ] A controller can create a usable `Persona` in the active exercise in ≤60s with just name, handle,
      type, and avatar.
- [ ] The new persona is exercise-scoped (exercise-isolation), immediately usable, and enrichable later
      via template fields (story 01).
- [ ] Handle uniqueness is enforced per-exercise (open question 3 default).
- [ ] The create is a controller action, logged (XC-004), staff-only (XC-002).

## Out of Scope
The console quick-create UI (E7 persona-operation/05, which calls this); full template authoring
(story 01).

## Technical Notes
Provides the create capability the E7 console surfaces. Writes a Persona (not a template). See
implementation.md (story 03).

## Dependencies
Story 01 (persona fields); exercise-isolation. Consumed by E7 persona-operation/05.

## Tests
- Integration: quick-create yields a usable exercise-scoped persona; per-exercise handle uniqueness
  enforced.
