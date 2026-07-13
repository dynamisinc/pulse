# Story: Inaction timer → escalation trigger (scenario time)

**Feature:** Silence escalation  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** ADP-001, COR-050/051  ·  **Design decisions:** none  ·  **Issue:** #161

## Context
The trigger half of silence escalation: if no qualifying official response addresses a storyline
within its configured `responseWindowMin` (**scenario time**), raise an escalation trigger. In pilot
mode the qualifying responses are official **social** posts and off-platform markers (CTL-026);
unmatched official content is **not** silence (response-reaction handles that). This is the ADP-001
timer that makes inaction visible.

## Acceptance Criteria
- [ ] Given a storyline with a `responseWindowMin`, when that many **scenario minutes** pass with no
      qualifying official response, then an escalation trigger is raised for the storyline.
- [ ] Given an official social post matched to the storyline, or an off-platform marker (CTL-026),
      when it lands before the window elapses, then the timer is satisfied and no escalation trigger
      fires (it counts as a response).
- [ ] Given **unmatched** official content, when it lands, then it does **not** satisfy the timer
      (it is never treated as silence — response-reaction slows escalation and prompts the controller
      instead).
- [ ] Given a scenario-time freeze (CTL-023) or time-jump (CTL-015), when it occurs, then the window
      timer stops/advances with scenario time — it never elapses while the world is frozen.
- [ ] **Scenario time (COR-050/051):** the window is measured in scenario minutes via the E1 clock;
      **Telemetry (XC-004):** the trigger emits an `engine.observed` event (trigger: inaction-timer,
      storyline, scenario time). Staff-only (XC-002).

## Out of Scope
The escalating content itself (story 02); response matching (response-reaction); the observe-stage
plumbing (reaction-loop story 01 provides the timer substrate — this story defines the ADP-001
silence semantics on top).

## Technical Notes
Staff/backend. Builds on reaction-loop's observe stage (story 01) and storyline-model's
`responseWindowMin`. "Qualifying response" in pilot mode = matched official social post OR
off-platform marker (#29). See implementation.md (story 01) and architecture §7.

## Dependencies
reaction-loop story 01 (observe); storyline-model (window, state); off-platform marker (#29);
response-reaction (defines "matched"). E1 clock (COR-050/051).

## Tests
- Unit: window elapses in scenario time with no qualifying response → escalation trigger raised.
- Unit: a matched social post / off-platform marker satisfies the timer; unmatched content does not.
- Unit: freeze halts the timer; time-jump advances it.
