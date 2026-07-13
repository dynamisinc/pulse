# Story: Escalation curves (Slow burn / Standard / Flash panic)

**Feature:** Storyline model  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** ADP-010  ·  **Design decisions:** none  ·  **Issue:** #154

## Context
Named escalation profiles define how intensity grows while unaddressed and decays once addressed
(ADP-010): **Slow burn** (low rise, slow decay), **Standard**, **Flash panic** (steep rise, fast
decay). Each is parameterized as `(riseRateUnaddressed, decayRateAddressed, ceiling, floor)`.
Planner-assignable per storyline, controller-overridable live via the E7 dial (CTL-022, story 05).

## Acceptance Criteria
- [ ] Given the named profiles, when they are defined, then each carries `(riseRateUnaddressed,
      decayRateAddressed, ceiling, floor)` and at least Slow burn / Standard / Flash panic ship as
      defaults.
- [ ] Given a storyline, when a planner assigns a curve, then the storyline's intensity trajectory
      follows that curve's parameters (consumed by story 02's intensity update).
- [ ] Given an active exercise, when a controller changes the curve or overrides via the dial, then
      the new profile takes effect live (CTL-022) and the change is logged as a steering action
      (XC-004).
- [ ] Given a Flash panic curve, when a storyline goes unaddressed, then intensity rises steeply and
      decays fast once addressed — distinguishably faster than Standard/Slow burn (a behavioral test,
      not just config).
- [ ] Curves are **staff-only** (XC-002) and per-exercise/per-storyline scoped (COR-001).

## Out of Scope
The intensity update loop that *applies* the curve (story 02); the dial UI (world-steering #25); the
dial-follow loop (story 05 — curve is the *natural* trajectory, target is the override).

## Technical Notes
Staff/backend. Curves are named, reusable profiles referenced by `storyline.curve`. Keep the
parameterization small and legible (four numbers) so planners can reason about them. See
implementation.md (story 03) and architecture §6.1.

## Dependencies
Story 01 (object references the curve); story 02 (applies it); world-steering dial (#25) overrides it.

## Tests
- Unit: each profile's parameters produce the expected rise/decay shape over ticks.
- Unit: a live curve change takes effect and logs a steering action.
