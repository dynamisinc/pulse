# Story: Fast persona switching (searchable picker, ≤3s)

**Feature:** Persona operation  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-002  ·  **Design decisions:** none  ·  **Issue:** #15

## Context
Speed of persona-switching is the console's core UX metric (CTL-002, CTL-034). A controller needs to
go from "I need to answer as Fulton County EM" to composing in **≤3 seconds**: a searchable persona
picker with type filters, recents, and pinned favorites, reachable from the command palette (Ctrl+K)
so the hands never leave the keyboard.

## Acceptance Criteria
- [ ] Given the console, when the controller opens the persona picker (button or Ctrl+K), then they
      can search personas by name/handle and filter by persona type, and selecting one sets it as
      the active persona for the composer.
- [ ] The picker surfaces **recents** and **pinned favorites**; a controller can pin/unpin a persona.
- [ ] Given a keyboard-only controller, when they invoke the palette and type a name, then they can
      select and activate a persona without a pointer (NFR-001 keyboard-operable).
- [ ] The picker lists only personas in the controller's **active exercise** (COR-001); switching
      the active exercise re-scopes the list.
- [ ] Selecting a persona updates the composer and the persona-context panel (story 03) to that
      persona.

## Out of Scope
The compose/publish action (story 01); the context panel contents (story 03); creating a new persona
(story 05); presence indicators (story 04).

## Technical Notes
Staff world (COBRA). Owns the picker + `useActivePersona` store; registers as a command-palette tool
in `console-shell`. Recents/pins persisted per controller. See implementation.md (story 02).

## Dependencies
E1 persona model (name/handle/type); console-shell command palette. Feeds stories 01/03.

## Tests
- Unit: search + type-filter selects the expected persona set; recents/pins ordering.
- Component (RTL): activating a persona via the palette (keyboard only) sets the active persona.
- Unit: the picker list is scoped to the active exercise.
