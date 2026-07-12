# Story: Suspension & module advancement (TTX)

**Feature:** Exercise clock & scenario-time model  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-052  ·  **Design decisions:** none  ·  **Issue:** #79

## Context
The clock supports **overnight suspension** for multi-day exercises (world freezes, optionally with a
planner-authored "overnight backfill" bundle firing at resume) and **module-based advancement for
TTX** — the facilitator steps through named modules, each jumping scenario time and releasing that
module's content (pairs with the TTX display mode, PRT-040) (COR-052).

## Acceptance Criteria
- [ ] The clock can be **suspended** (world freezes) and **resumed**, optionally firing a
      planner-authored overnight backfill bundle at resume.
- [ ] **Module-based advancement**: a facilitator steps through named modules; each module jumps
      scenario time (story 02) and releases that module's content.
- [ ] Suspension/resume and module steps are Director/facilitator actions, logged (XC-004).
- [ ] These integrate with the lifecycle (Paused/holding) and the tiered pause/freeze (E7 CTL-023).

## Out of Scope
The TTX kiosk/display mode (E3 PRT-040, Phase 3); the overnight-backfill authoring (build workspace);
the E7 pause UI (CTL-023).

## Technical Notes
Foundation. Built on the jump primitive (story 02) + a suspend/resume state. TTX module stepping is a
sequence of named jumps. See implementation.md (story 03).

## Dependencies
Stories 01/02; exercise-configuration lifecycle (Paused); E7 CTL-023 (freeze); E3 PRT-040 (Phase 3
display).

## Tests
- Unit: suspend/resume freezes and restores; a module step jumps time and releases its content.
