# Story: Pre-exercise backdated post history

**Feature:** Persona management & cast libraries  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-023 (COR-053)  ·  **Design decisions:** none  ·  **Issue:** #56

## Context
So profiles don't look born yesterday, planners can author or generate "background noise" posts
**backdated before StartEx**. Backdated content renders under the scenario-time rule (COR-023,
COR-053) — a persona's timeline reads as an ongoing life, not an empty account created for the
exercise.

## Acceptance Criteria
- [ ] Planners can author (or generate) backdated posts for a persona with scenario timestamps before
      StartEx.
- [ ] Backdated content renders in **scenario time** in the exercise time zone (COR-053), in correct
      order within the persona's timeline.
- [ ] Backdated content is exercise-scoped and available in the world from platform-open (Staged),
      consistent with the lifecycle (COR-043 Staged shows backdated history).
- [ ] Optional generation of background noise is supported (author-or-generate).

## Out of Scope
The engine's live generation (E8 ambient chatter ADP-005); the feed rendering itself (E2); the
lifecycle mechanics (exercise-configuration COR-032).

## Technical Notes
Staff world. Backdated posts are normal posts with pre-StartEx scenario timestamps; rendering obeys
COR-053. See implementation.md (story 04).

## Dependencies
Story 01 (personas); E2 post model + scenario-time rendering (COR-053); lifecycle Staged (COR-043).

## Tests
- Integration: backdated posts render in scenario time in correct order and appear from platform-open.
