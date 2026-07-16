# Story: Observe stage — triggers + inaction timers (scenario time)

**Feature:** Reaction loop  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** F8.1, COR-050/051  ·  **Design decisions:** none  ·  **Issue:** #157

## Context
The loop's input stage: gather the signals that could trigger a reaction — participant actions
(posts, replies, official responses), **inaction timers** (a storyline's `responseWindowMin` elapsing
in **scenario time**), world events, and the dial target. This is where "the world reacts to what
participants do *and fail to do*" begins: the inaction timer is the "fail to do" half.

## Acceptance Criteria
- [ ] Given active storylines, when the loop observes, then it collects: recent participant/world
      actions relevant to each storyline, elapsed inaction timers, and the current dial target.
- [ ] Given a storyline's `responseWindowMin`, when it elapses in **scenario time** without a
      qualifying response, then an inaction trigger is raised for that storyline (the silence signal
      silence-escalation consumes).
- [ ] Given a scenario-time **freeze** (CTL-023) or **time-jump** (CTL-015), when it occurs, then
      inaction timers stop/advance accordingly — windows do not elapse while the world is frozen.
- [ ] Given an official response or off-platform marker (CTL-026), when observed, then it is surfaced
      to the decide stage as a candidate storyline-addressing event (matching happens in
      response-reaction).
- [ ] **Scenario time (COR-050/051):** all timers/windows are scenario minutes, driven by the E1
      clock provider; wall-clock is telemetry-only.
- [ ] Observation is **staff/backend** and exercise-scoped (COR-001, XC-002).

## Out of Scope
The decision of *what to generate* (story 02); the actual generation (story 03); the escalation
content (silence-escalation); response matching (response-reaction); auto-detecting *new* storylines
(deferred post-v1).

## Technical Notes
Staff/backend. Subscribes to the E1 clock (COR-050) and the pause/freeze state (world-steering
tiered-pause #26). Reads storyline state (storyline-model) and recent E2 activity. Emits
`engine.observed` events (engine-telemetry-tuning). See implementation.md (story 01) and
architecture §1.2.

## Dependencies
E1 exercise clock (COR-050/051) + pause state (#26); storyline-model (windows, state); E2 (activity);
off-platform marker (#29). Feeds story 02.

## Tests
- Unit: an elapsed `responseWindowMin` in scenario time raises an inaction trigger; a freeze halts
  the timer; a time-jump advances it.
- Unit: an official response / off-platform marker is surfaced to decide as an addressing candidate.
