# Story: Tuning & observability surface

**Feature:** Engine telemetry & tuning  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** ADP-041  ·  **Design decisions:** none  ·  **Issue:** #174

## Context
The surface that exposes engine actions with their triggers and storylines for **post-exercise
tuning** and feeds E10 (ADP-041). It lets a tuner ask "why did the world escalate at 14:07?" and
answer it from the logged triggers, and it renders sentiment/intensity arcs with **dial-input
overlays** (EVL-014) so a hotwash distinguishes dialed-in mood from participant-driven mood — closing
the sentiment-circularity risk (adversarial review D3).

## Acceptance Criteria
- [ ] Given the engine event log (story 01), when a tuner reviews an exercise, then engine actions are
      queryable by trigger, storyline, persona, and scenario time — the "why did the world turn?"
      question is answerable from the record.
- [ ] Given sentiment/intensity over an exercise, when rendered for E10/evaluators, then engine/dial
      config events appear as **overlays** (EVL-014) so designed pressure is visually distinct from
      participant-driven pressure ("scenario design inputs" vs signal).
- [ ] Given post-exercise tuning, when a tuner adjusts curves/rate-caps/thresholds, then the change is
      informed by the logged engine behavior (the loop is observable end to end).
- [ ] Given the surface, when exposed, then it is **staff/evaluator-facing** (XC-002), exercise-scoped
      (COR-001), and never leaks engine state to participants (SOC-003).
- [ ] **Telemetry (XC-004):** the surface reads only the extended engine event log (story 01); it does
      not introduce a parallel taxonomy.

## Out of Scope
The event schema itself (story 01); E10's full timeline/replay UI (E10 — this surface feeds it); the
escalation-dial control (world-steering #25); the eval harness (engine-eval-harness).

## Technical Notes
Staff/backend. A read/query surface over the engine event log, plus the overlay data E10 renders.
Keep it a *view* over XC-004 events, not a second store. See implementation.md (story 02),
architecture §11, and EVL-014.

## Dependencies
Story 01 (event log); E10 (primary consumer, timeline/replay/metrics); EVL-014 (overlay semantics);
storyline-model (curve/rate-cap config the tuner adjusts).

## Tests
- Unit: engine actions are queryable by trigger/storyline/persona/scenario-time.
- Unit: sentiment/intensity render with dial-input overlays distinguishing designed vs participant-
  driven pressure.
