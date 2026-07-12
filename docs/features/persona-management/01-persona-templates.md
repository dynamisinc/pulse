# Story: Persona templates (create / edit / clone / archive)

**Feature:** Persona management & cast libraries  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-020 (SOC-054)  ·  **Design decisions:** none  ·  **Issue:** #53

## Context
Planners create, edit, clone, and archive **persona templates** with: name, handle, avatar, bio,
persona type, verification flag, audience magnitude band (SOC-054), voice/personality notes (drives E8
and controller ghost-writing), and optional backstory. Voice-profile quality is Phase-1-critical — the
Phase-2 engine is only as believable as these notes (COR-020).

## Acceptance Criteria
- [ ] Planners can create/edit/clone/archive a `PersonaTemplate` in the org library with all fields:
      name, handle, avatar, bio, type, verification flag, audience-magnitude band, voice notes,
      optional backstory.
- [ ] Persona **type** (news outlet / agency / weather-scientific / citizen / influencer / business /
      bad actor) drives default profile styling, verification defaults, and (later) E8 behavior profile.
- [ ] Templates are org-scoped and reusable across exercises (they are not exercise-scoped; instances
      are — exercise-isolation story 03).
- [ ] Voice/personality notes are a first-class, prominent field (Phase-1-critical for E8).

## Out of Scope
Cast assembly/seeding (story 02); mid-exercise quick-create (story 03); the engine that consumes voice
notes (E8); avatar library internals (story 05).

## Technical Notes
Staff world (COBRA). Template lives in the Organization library. Audience magnitude band per SOC-054.
See implementation.md (story 01).

## Dependencies
Organization/library; exercise-isolation story 03 (instances). Feeds E7 persona-operation + E8.

## Tests
- Integration: CRUD + clone/archive on a template with all fields; type drives verification defaults.
