# Story: Fast persona switching (searchable picker, ≤3s)

**Feature:** Persona operation  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-002  ·  **Design decisions:** D5-004, D5-015, D5-017, D5-018  ·  **Issue:** #15

## Context
Speed of persona-switching is the console's core UX metric (CTL-002, CTL-034). A controller needs to
go from "I need to answer as Fulton County EM" to composing in **≤3 seconds**: a searchable persona
picker with type filters, recents, and pinned favorites, reachable from the **⌘K command palette**
(`console-shell/01`) so the hands never leave the keyboard. Per D5-017/018, "Personas" is a single
toolstrip tool that opens the ⌘K picker directly — there is no separate roster/"Cast" surface.

## Acceptance Criteria
- [ ] Given the console, when the controller opens the persona picker (the "Personas" toolstrip tool,
      or ⌘K), then they can search personas by name/handle and filter by persona type, and selecting
      one sets it as the active persona (`useActivePersona()`) for the composer.
- [ ] The picker surfaces **recents** and **pinned favorites**; a controller can pin/unpin a persona.
- [ ] Given a keyboard-only controller, when they invoke the palette and type a name, then they can
      select and activate a persona without a pointer (NFR-001 keyboard-operable) — the full
      `<10s reply flow` per D5 (⌘K → type name → Enter → composer).
- [ ] The picker lists only personas in the controller's **active exercise** (COR-001) — read via
      `usePersonas()` (`@/features/personas`), **never** `SEEDED_PERSONAS`/`personaById` (those are
      mock-fixture-only exports, fail-open on a shipped path); switching the active exercise re-scopes
      the list.
- [ ] Selecting a persona updates the composer (`persona-operation/01`) and the persona-context panel
      (`persona-operation/03`) to that persona.

## Out of Scope
The compose/publish action (`persona-operation/01`); the context panel contents
(`persona-operation/03`); creating a new persona (`persona-operation/05`); presence indicators
(`persona-operation/04`); the ⌘K palette shell/persona-dock host itself (`console-shell/01`) — this
story mounts its picker content INTO that host at the Wave-1 integration step, it does not build the
palette or the host.

## Technical Notes
Staff world (COBRA). Owns the picker + `useActivePersona` store. Files this story owns (disjoint from
every other Wave-1 story): `features/controller/components/PersonaPicker.tsx`,
`features/controller/hooks/useActivePersona.ts`. Recents/pins persisted per controller (local state
for Wave 1 — no backend yet).

**Wave-1 parallel-build contract.** This story builds in parallel with `console-shell/01` (which owns
the ⌘K palette shell + the persona-dock host flyout slot) — it does **not** import
`CommandPalette.tsx`/`personaDockHost.*`, and `console-shell/01` does not import `PersonaPicker`. The
serial Wave-1 integration step mounts `<PersonaPicker>` inside the persona-dock host's PERSONAS
section. Exercise-scoped read: `usePersonas()` (`@/features/personas`) — the shipped read seam, no
new resolver.

See `implementation.md` (story 02) for the file-ownership map + cross-feature wave plan.

## Dependencies
E1 persona model (`@/features/personas`'s `Persona` type, `usePersonas()`); `console-shell/01`'s
⌘K palette/persona-dock host (as an INPUT contract — this story's picker mounts into it, wired at
integration). Feeds `persona-operation/01`/`03` (active persona).

## Tests
- Unit: search + type-filter selects the expected persona set; recents/pins ordering.
- Component (RTL): activating a persona via the palette (keyboard only) sets the active persona.
- Unit: the picker list is scoped to the active exercise (via `usePersonas()`, not
  `SEEDED_PERSONAS`/`personaById`).
