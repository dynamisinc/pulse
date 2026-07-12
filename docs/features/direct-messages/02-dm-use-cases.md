# Story: DM use cases (tips / coordination / vectors)

**Feature:** Direct messages  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-061  ·  **Design decisions:** none  ·  **Issue:** #115

## Context
DMs support three use cases: citizen tips to official accounts, coordination between participants, and
targeted misinformation/social-engineering vectors (a persona DMs a participant) (SOC-061).

## Acceptance Criteria
- [ ] A citizen persona/participant can DM an official account (tip); an official can reply.
- [ ] Participants can coordinate via DM (participant-to-participant).
- [ ] A persona (controller/engine-operated) can DM a participant — supporting targeted misinfo/social-
      engineering scenarios; provenance captured, never participant-visible (SOC-003).
- [ ] All three flow through story 01's DM infra (no separate mechanism).

## Out of Scope
The controller DM-as-persona UI (E7 persona-operation); engine-driven DMs (E8); observability (story 03).

## Technical Notes
Participant world. These are scenario patterns over the same DM infra. See implementation.md (story 02).

## Dependencies
story 01 (DM infra); E7 (persona DMs), E8 (targeted vectors) produce them.

## Tests
- Integration: a persona-to-participant DM delivers with hidden origin; tip + coordination flows work.
