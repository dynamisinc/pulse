# Story: Intensity + sentiment tracking

**Feature:** Storyline model  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Done
**Requirements:** ADP-012  ·  **Design decisions:** none  ·  **Issue:** #153

## Context
Intensity and sentiment are tracked continuously (ADP-012). **Intensity** is advanced each loop tick
by the escalation curve + time-since-response, bent **down** by a matched official response and **up**
by amplification velocity + audience magnitude (SOC-054), bounded [floor, ceiling]. **Sentiment**
(−1…+1) is computed from engine state + reaction signals (SOC-031) + light content analysis, tracked
per-storyline and exercise-wide, and exposed to controllers (E7), evaluators (E10 — with EVL-014
dial-input overlays), and back to the engine as its own feedback input.

## Acceptance Criteria
- [x] Given a storyline tick, when intensity is updated, then it moves per the curve + time-since-
      response, is bent down by a matched response and up by amplification/audience (SOC-054), and
      stays within [floor, ceiling].
- [x] Given reaction signals (SOC-031) and generated content, when sentiment is computed, then a
      continuous −1…+1 value is maintained per-storyline and aggregated exercise-wide.
- [x] Given the controller/evaluator surfaces, when intensity/sentiment are exposed, then E10 renders
      them with **dial-input overlays** (EVL-014) so designed pressure is distinguishable from
      participant-driven pressure (no sentiment circularity in the AAR).
- [x] Given the engine's next decision, when it runs, then current sentiment/intensity feed back into
      it (the engine's own feedback input).
- [x] **Telemetry (XC-004):** intensity/sentiment deltas emit `engine.measured` events with the cause
      (curve / matched response / amplification), wall + scenario time.
- [x] Intensity/sentiment are **staff/evaluator-facing** (XC-002); the sentiment reaction set stays,
      to participants, an ordinary reaction picker (SOC-031).

## Out of Scope
The curve math (story 03); rate caps (story 04); the dial target (story 05); the SOC-031 reaction
picker UI (E2 reactions); E10's chart rendering (E10 — this story emits the signal).

## Technical Notes
Staff/backend. Sentiment blends engine state + SOC-031 reaction aggregates + a light content pass;
keep it explainable (it must be defensible in a hotwash). Amplification velocity comes from
amplification-engine / E2. See implementation.md (story 02) and architecture §6.2.

## Dependencies
Story 01 (object); story 03 (curve); E2 reactions (SOC-031) + amplification (SOC-054); reaction-loop
(ticks it); engine-telemetry-tuning (events); E10/EVL-014 (overlays).

## Tests
- Unit: intensity responds to curve, time-since-response, matched response (down), amplification (up),
  clamped to bounds.
- Unit: sentiment computed and aggregated; `engine.measured` emitted with cause.
