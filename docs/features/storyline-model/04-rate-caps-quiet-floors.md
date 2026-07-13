# Story: Rate caps + quiet floors

**Feature:** Storyline model  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** ADP-011  ·  **Design decisions:** none  ·  **Issue:** #155

## Context
Global rate caps and quiet floors per exercise (ADP-011) keep the engine from either firehosing or
flatlining the world: `maxEnginePostsPerMinute` (the ceiling — the engine can't dump) and
`minBelievableActivity` (the floor — the world stays alive during lulls, driving ambient chatter).
Defaults are sized against NFR-002. These are cost *and* believability controls.

## Acceptance Criteria
- [ ] Given an exercise, when it is configured, then `maxEnginePostsPerMinute` and
      `minBelievableActivity` are settable per exercise with defaults sized against NFR-002.
- [ ] Given the engine at peak, when generated volume would exceed `maxEnginePostsPerMinute`, then the
      engine throttles/queues rather than firehosing — the cap is enforced.
- [ ] Given a lull below `minBelievableActivity`, when the floor is unmet, then ambient chatter
      (ambient-chatter) is triggered to keep the world alive.
- [ ] Given a cap/floor change, when a controller sets it, then it takes effect live and is logged
      (XC-004).
- [ ] Caps/floors are **staff-only** (XC-002) and per-exercise scoped (COR-001).

## Out of Scope
The ambient chatter content itself (ambient-chatter feature — this story exposes the floor it reads);
model-tier cost (engine-generation-infra story 04); amplification velocity (amplification-engine).

## Technical Notes
Staff/backend. The cap is enforced at the reaction-loop's publish stage; the floor is a signal
ambient-chatter subscribes to. Defaults derive from NFR-002 (sustained 60/min feed, but *generated*
rate is lower — see architecture §4). See implementation.md (story 04) and architecture §6.2.

## Dependencies
Story 01 (object/exercise config); reaction-loop (enforces the cap); ambient-chatter (reads the
floor); engine-telemetry-tuning.

## Tests
- Unit: generation above the cap is throttled; below the floor triggers ambient chatter.
- Unit: a cap/floor change takes effect live and logs.
