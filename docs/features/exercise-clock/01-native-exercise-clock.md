# Story: Native exercise clock (provider interface)

**Feature:** Exercise clock & scenario-time model  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-050  ·  **Design decisions:** none  ·  **Issue:** #77

## Context
A per-exercise scenario clock with StartEx, pause/resume, and a current scenario datetime (supporting
`ScenarioDay` semantics compatible with Cadence's 1–99 model). All subsystems consume the clock through
**one interface**; providers (native / Cadence-linked) are swappable (COR-050). Pulse owns this from
Phase 1 — it never waits on E9.

## Acceptance Criteria
- [ ] A per-exercise scenario clock exposes the current scenario datetime, StartEx, and pause/resume,
      with `ScenarioDay` semantics compatible with Cadence's 1–99 model.
- [ ] All subsystems read the clock through **one interface**; the provider (native now, Cadence-linked
      in Phase 4) is swappable without changing consumers.
- [ ] The clock is exercise-scoped and consumes the exercise time zone (exercise-configuration COR-030).
- [ ] StartEx (from go-live, exercise-build-golive COR-043) starts the clock; pause/resume aligns with
      the tiered pause (E7 CTL-023 — clock stops on Freeze).

## Out of Scope
Discrete jumps (story 02); suspension/module advancement (story 03); participant-visible rendering
(story 04); the Cadence provider implementation (E9, Phase 4).

## Technical Notes
Foundation. The clock interface is a core contract many features depend on — get it right early (this
is a Wave-0 primitive). See implementation.md (story 01).

## Dependencies
exercise-configuration (TZ, lifecycle); consumed by nearly everything. Provider interface enables E9.

## Tests
- Unit: clock exposes scenario datetime + StartEx + pause/resume; a mock provider swaps in without
  consumer changes.
