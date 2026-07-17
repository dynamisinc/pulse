# Story: Persona templates (create / edit / clone / archive)

**Feature:** Persona management & cast libraries  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** In Progress
**Requirements:** COR-020 (SOC-054)  ·  **Design decisions:** none  ·  **Issue:** #53

## Context
Planners create, edit, clone, and archive **persona templates** with: name, handle, avatar, bio,
persona type, verification flag, audience magnitude band (SOC-054), voice/personality notes (drives E8
and controller ghost-writing), and optional backstory. Voice-profile quality is Phase-1-critical — the
Phase-2 engine is only as believable as these notes (COR-020).

**Seed delivered (Social E2 prerequisite):** `features/personas/{types.ts,personaTemplates.ts}` landed
as a minimal mock seed so the Social (E2) build (`posts/02`, `posts/03`) has believable authors to
render/attribute — it is **not** a build of this story's full ACs. Delivered: the `PersonaTemplate`
model, type-driven verification defaults, and the Fairhaven organization's template library, including
the SOC-052 verified/lookalike-impersonator pair used by the PostCard tests. Tests:
`features/personas/types.test.ts`. Remaining before this story can flip to Complete: the
`PersonaTemplateEditor` staff CRUD UI (create/edit/clone/archive), and the .NET backend — neither
exists yet; there is no way for a planner to actually author a template today.

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
