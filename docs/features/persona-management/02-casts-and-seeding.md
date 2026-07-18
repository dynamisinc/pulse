# Story: Casts & one-action seeding with derived state

**Feature:** Persona management & cast libraries  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** In Progress
**Requirements:** COR-021  ·  **Design decisions:** none  ·  **Issue:** #54

## Context
Planners assemble templates into named **Casts** (e.g. "Mid-size US city baseline: 2 news outlets, 6
agencies, 40 citizens") and seed an exercise with a cast in one action; seeding instantiates personas
with believable **derived state** — varied follower counts, join dates predating the exercise
(COR-021).

**Seed delivered (Social E2 prerequisite):** `features/personas/{casts.ts,seedCast.ts,personaService.ts}`
landed as a minimal mock seed so the Social (E2) feed/post surfaces have exercise-instanced personas to
render — it is **not** a build of this story's full ACs. Delivered: a named `Cast` model, a one-action
`seedCast()` that instantiates a cast's templates into exercise-scoped personas with derived follower
counts (from audience-magnitude bands, SOC-054) and pre-exercise join dates (rendered in scenario time,
COR-053), and a `usePersonas()` hook for consumers. Tests: `features/personas/seedCast.test.ts`,
`features/personas/personaService.test.ts`. Remaining before this story can flip to Complete: the
`CastBuilder` staff UI (assemble/edit a cast's membership) and the actual staff-triggered backend
seeding action — neither exists yet; `seedCast()` today is a data function, not a reachable staff
action.

## Acceptance Criteria
- [ ] Planners can assemble persona templates into a named Cast and edit its membership.
- [ ] Seeding an exercise with a Cast is a **one action** that instantiates all its personas as
      exercise-scoped instances (exercise-isolation story 03).
- [ ] Seeded personas get believable derived state: varied follower counts (from audience-magnitude
      bands, SOC-054) and join dates predating the exercise (rendered in scenario time, COR-053).
- [ ] Seeding is a staff/planner action, exercise-scoped and staff-only.

## Out of Scope
Template authoring (story 01); backdated post history (story 04); the audience-magnitude formula itself
(defined with SOC-054 in E2).

## Technical Notes
Staff world. One-action seed = instantiate cast → personas with derived state. See implementation.md
(story 02).

## Dependencies
Story 01 (templates); exercise-isolation story 03 (instances); SOC-054 (magnitude). Makes setup fast.

## Tests
- Integration: seeding a cast instantiates all personas with varied followers + pre-exercise join
  dates.
