# Story: Measure stage — telemetry + storyline update

**Feature:** Reaction loop  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** ADP-041, XC-004  ·  **Design decisions:** none  ·  **Issue:** #160

## Context
The loop closes here: after publish, measure the effect and update state. Emit the engine-action
telemetry (ADP-041/XC-004), observe amplification/reaction on the published content, and update the
storyline's intensity/sentiment (storyline-model story 02) so the next loop tick reacts to the new
world state. This is what feeds E10 and post-exercise tuning.

## Acceptance Criteria
- [ ] Given a published burst, when the measure stage runs, then it observes downstream signals
      (amplification velocity, reactions SOC-031) and updates the storyline's intensity/sentiment via
      storyline-model.
- [ ] Given each loop pass, when it completes, then an `engine.measured` event is emitted with the
      intensity/sentiment delta and its cause (curve / matched response / amplification), wall +
      scenario time (XC-004/ADP-041).
- [ ] Given the updated storyline state, when the next tick observes, then it reflects the measured
      effect (the loop is closed — the world reacting changes what the engine does next).
- [ ] Given E10, when it consumes engine events, then the storyline arc is reconstructable with
      dial-input overlays (EVL-014) — the AAR can explain *why the world turned*.
- [ ] Measurement is **staff/backend**, exercise-scoped (COR-001, XC-002); wall-clock is
      telemetry-only, scenario time is the participant-facing time (COR-053).

## Out of Scope
The intensity/sentiment computation itself (storyline-model story 02 — this stage *invokes* it);
the telemetry schema definition (engine-telemetry-tuning story 01); E10's rendering (E10).

## Technical Notes
Staff/backend. Thin stage: subscribe to E2 amplification/reaction signals for the published posts,
call storyline-model's `tickIntensity`/`computeSentiment`, emit `engine.measured`. See
implementation.md (story 04) and architecture §1.2/§11.

## Dependencies
Story 03 (published content to measure); storyline-model story 02 (intensity/sentiment update); E2
amplification/reactions; engine-telemetry-tuning (event schema); E10 (consumer).

## Tests
- Unit: post-publish, the storyline intensity/sentiment updates from downstream signals and
  `engine.measured` is emitted with the cause.
- Unit: the next observe tick reflects the updated state (closed loop).
