# Story: Dial-target follow loop

**Feature:** Storyline model  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Done
**Requirements:** CTL-022  ·  **Design decisions:** D5-014/2.2  ·  **Issue:** #156

## Context
The escalation dial (world-steering #25) was amended (D5-014/2.2) to show **actual fill + a
controller-set target tick**; the controller clicks to set a target ("78 → 60") and **the engine
drives actual toward the target**. This story is the engine half of that loop: the curve is the
*natural* trajectory, and when `targetIntensity` is set, the engine bends generation to move actual
toward target (raise = generate more/hotter content, lower = taper) rather than following the curve
blindly. The engine follows the controller; it never overrides the target.

## Acceptance Criteria
- [x] Given a storyline with `targetIntensity` set (via the #25 dial), when the engine ticks, then it
      drives `actual` toward `target` — increasing generation intensity/volume to raise, tapering to
      lower — within rate caps (story 04).
- [x] Given no target set, when the engine ticks, then intensity follows the escalation curve
      (story 03) as the natural trajectory (target is an optional override, not required).
- [x] Given actual has reached target, when the engine ticks, then it holds near target rather than
      overshooting per the raw curve.
- [x] Given a target change mid-exercise, when the controller sets it, then the follow loop retargets
      live and the target change is logged as a steering action (XC-004) — staff-only (XC-002).
- [x] The engine **never raises intensity past a controller-lowered target on its own** — controller
      authority over the target is absolute (consistent with the autonomy-safety invariant).

## Out of Scope
The dial UI + target-setting interaction (world-steering #25 owns it); the curve definitions
(story 03); rate-cap enforcement (story 04 — this loop operates within it); the generation itself
(reaction-loop + reactive-behavior features).

## Technical Notes
Staff/backend. The follow loop reads `targetIntensity` (set by #25) and modulates the reaction-loop's
decide-stage intent (how much/how hot to generate). In Phase 1 the dial captured the target and the
loop was stubbed; this story implements the actual follow. See implementation.md (story 05),
architecture §6.1, and world-steering `02-escalation-dial.md` (#25).

## Dependencies
Story 01–04 (object, intensity, curve, caps); world-steering escalation dial (#25, sets the target);
reaction-loop (the decide stage this modulates).

## Tests
- Unit: with a target set, actual is driven toward it (up and down) within caps; with none, it
  follows the curve.
- Unit: a lowered target is not overridden upward by the engine; target changes log.
