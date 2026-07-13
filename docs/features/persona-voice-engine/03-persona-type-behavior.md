# Story: Persona-type behavior + bad-actor gating

**Feature:** Persona voice engine  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** ADP-022  ·  **Design decisions:** none  ·  **Issue:** #150

## Context
Persona **type** governs behavior (ADP-022): outlets sensationalize within bounds, agencies stay
procedural, trolls antagonize, helpers correct rumors, businesses give practical updates. Crucially,
**bad-actor personas participate only when the storyline/scenario enables them** — a gate, not a
default — so a scenario without an antagonist doesn't spontaneously grow one.

## Acceptance Criteria
- [ ] Given a persona's type, when the engine generates for it, then the type shapes its behavior
      (outlet sensationalizes within bounds / agency procedural / troll antagonizes / helper corrects
      / business practical), consistent with the persona-management type taxonomy.
- [ ] Given a bad-actor (troll / antagonist) persona, when a burst is composed, then it participates
      **only** if the storyline or scenario has enabled bad-actor participation; otherwise it is
      excluded.
- [ ] Given a helper persona and an active rumor (v1.1) or misinformation, when it participates, then
      its behavior tends toward correction/clarification (the v1 behavior sets up the v1.1
      crowd-correction mechanic in rumor-model).
- [ ] Given any persona type, when it generates, then it still respects the fiction guard (ADP-023) —
      a troll antagonizes in-world but never breaks fiction, uses slurs, or threatens violence.
- [ ] **LLM governance (NFR-005):** type-driven behavior is expressed via the dossier/type in the
      trusted prompt context, never via untrusted world content.

## Out of Scope
Voice consistency (story 01); diversity thresholds (story 02); the rumor mechanics themselves
(rumor-model, v1.1 — this story only sets up helper/troll behavior); the fiction-guard patterns
(engine-generation-infra story 03 / content-guard).

## Technical Notes
Staff/backend. Persona type comes from the persona-management taxonomy (news outlet / agency /
weather-scientific / citizen / influencer / business / bad actor). The bad-actor enablement flag is a
storyline/scenario setting read at burst-composition time (which personas are eligible). See
implementation.md (story 03) and architecture §5.2.

## Dependencies
persona-management (persona type); storyline-model (scenario/storyline bad-actor enablement flag +
participatingPersonas); engine-generation-infra (prompt); the fiction guard (story 03 of
generation-infra).

## Tests
- Unit: each persona type produces type-consistent behavior in generation context.
- Unit: a bad-actor persona is excluded from a burst when bad-actor participation is not enabled, and
  included when it is.
