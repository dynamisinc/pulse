# Story: Storyline escalation dial — actual + target, engine follows

**Feature:** World steering  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-022 (ADP-010)  ·  **Design decisions:** D5-014/2.2  ·  **Issue:** #25

## Context
The controller's intensity control for automated public reaction. The D5 review **amended** it from a
single value to **one track showing actual fill + a controller-set target tick**: the controller
clicks the track to set a target ("78 → 60"), and the **engine drives actual toward the target**.
This ships in **Phase 1** as an engine cockpit foundation (CTL-022) so the E8 engine (Phase 2) lands
into a ready control.

> **Amendment (D5-014/2.2).** Before: intensity shown as a single value. After: one track = actual
> fill + a target tick; click to set target; the engine drives actual toward target.

## Acceptance Criteria
- [ ] Given a storyline, when the console renders its escalation control, then it shows **one track**
      with the **actual** intensity fill and a distinct **target** tick.
- [ ] When the controller clicks/drags the track to set a target, then the target updates and is
      recorded; the displayed relationship (e.g. "78 → 60") is clear.
- [ ] Once the E8 engine is present (Phase 2), the engine drives actual intensity **toward the
      target** per the storyline's escalation profile (ADP-010); in Phase 1 the target is captured and
      the loop is stubbed/mockable.
- [ ] Per-exercise and per-storyline scope is respected (CTL-022); target changes are logged as
      steering actions (XC-004) and are staff-only (XC-002).
- [ ] Actual vs target is distinguishable without color alone (NFR-001) and the control is
      keyboard-settable.

## Out of Scope
The engine's generation behavior (E8 ADP-001/002/004); escalation-profile definitions (E8 ADP-010);
the review queue (engine-review-cockpit).

## Technical Notes
Staff world (COBRA). Owns the dial control + target state; exposes the target to the engine loop
(mock in Phase 1). One-track actual+target is the canonical widget. See implementation.md (story 02).

## Dependencies
E8 storyline model + escalation profiles (ADP-010, Phase 2 for the follow loop); console-shell.
Ticks STORY-UPDATES.md §A **CTL-022**.

## Tests
- Component (RTL): the track renders actual fill + a target tick; setting a target updates it.
- Unit: a target change is recorded and logged; scoped per storyline.
