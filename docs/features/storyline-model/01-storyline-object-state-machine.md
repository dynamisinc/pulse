# Story: Storyline object + state machine

**Feature:** Storyline model  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** ADP-010 (state)  ·  **Design decisions:** none  ·  **Issue:** #152

## Context
The storyline is the engine's tracked unit of public concern (epic §2.1). This story defines the
object and its lifecycle. Fields (architecture §1.1): `intensity` (0–100 canonical), `sentiment`
(−1…+1), `phase`, `expectation` (+ `expectedActionRef`, null in v1 — the Phase-4 Cadence hook),
`participatingPersonas`, `hashtags`, `curve`, `targetIntensity`, `responseWindowMin` (scenario
minutes), and a reserved `rumorRefs` slot for v1.1. State machine:
`DORMANT → SEEDED → ESCALATING → PEAK → ADDRESSED → DECAYING → RESOLVED`, with re-open on a new
unaddressed trigger. Storylines are **planner-created (pre-seeded) or controller-created (ad hoc)**;
automatic detection from participant activity is **deferred post-v1** (open question 1).

## Acceptance Criteria
- [ ] Given a planner or controller, when they create a storyline, then it persists with all fields
      (architecture §1.1), scoped to one exercise (COR-001), and starts in `DORMANT`/`SEEDED`.
- [ ] Given a storyline, when the engine advances it, then phase transitions follow the defined
      machine (SEEDED→ESCALATING on window/activity; →ADDRESSED on a matched response; →DECAYING→
      RESOLVED on decay; re-open to ESCALATING on a new unaddressed trigger).
- [ ] Given intensity, when it is stored, then it is on the **0–100** canonical scale (the dial reads
      it as actual-fill; the planner's coarse "0–10" maps ×10).
- [ ] Given the v1 object, when it is defined, then `expectedActionRef` and `rumorRefs` exist as
      **reserved/null** slots so Phase-4 Cadence binding and v1.1 rumor lineage need no migration.
- [ ] **Telemetry (XC-004):** each state transition emits a `storyline.state_changed` event
      (from→to, cause, scenario time) — logged by engine-telemetry-tuning.
- [ ] The storyline and all its state are **staff-only** (XC-002) and exercise-scoped (COR-001) — no
      participant surface exposes storylines.

## Out of Scope
Intensity/sentiment *computation* (story 02); curve *definitions* (story 03); rate caps (story 04);
the dial-follow loop (story 05); auto-detection (deferred post-v1); the console UI (world-steering).

## Technical Notes
Staff/backend. The object + state machine is the schema the rest of E8 reads. Reserve `rumorRefs` +
`expectedActionRef` now (architecture §14 schema-now note). See implementation.md (story 01) and
architecture §1.1/§6.1.

## Dependencies
E1 exercise-context layer (scoping); persona-management (participatingPersonas); engine-telemetry-tuning
(state-change events). Foundation for the rest of the feature and for reaction-loop.

## Tests
- Unit: CRUD + all fields; intensity constrained to 0–100; reserved slots present and nullable.
- Unit: each valid phase transition succeeds and emits `storyline.state_changed`; invalid transitions
  are rejected.
