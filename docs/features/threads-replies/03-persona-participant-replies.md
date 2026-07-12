# Story: Persona/participant replies (both directions)

**Feature:** Threads & replies  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-012  ·  **Design decisions:** none  ·  **Issue:** #100

## Context
Personas (via controllers or the E8 engine) can reply to participant posts — the "agency responds to
citizen" pattern from Looking Glass — and its inverse: citizens piling onto official posts (SOC-012).

## Acceptance Criteria
- [ ] A persona (controller-operated or engine-generated) can reply to a participant's post; the reply
      appears in the flattened thread (story 01) authored by the persona.
- [ ] Participants can reply to persona/official posts (the pile-on direction).
- [ ] Replies carry provenance (posts SOC-003) — origin captured, never participant-visible.
- [ ] A verified official replying shows the seal-blue mark (posts/02); an impersonator does not
      (D1-008).

## Out of Scope
The controller reply UI (E7 persona-operation); engine reply generation (E8 ADP-002); the composer
itself (posts).

## Technical Notes
Participant world render of replies regardless of author type; provenance hidden. See implementation.md
(story 03).

## Dependencies
story 01 (thread), posts (composer/provenance); E7 (controller replies), E8 (engine replies) produce
them.

## Tests
- Component/integration: a persona reply and a participant reply both render in-thread; origin is not
  exposed.
