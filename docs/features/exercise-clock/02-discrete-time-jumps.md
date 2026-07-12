# Story: Discrete Director time-jumps

**Feature:** Exercise clock & scenario-time model  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-051  ·  **Design decisions:** none  ·  **Issue:** #78

## Context
A Director-level action advances scenario time ("it is now D+3, 0800"). On a jump, each subsystem has
defined behavior: scheduled content in the skipped span is offered to the controller as a batch
disposition; E8 storyline timers re-evaluate in scenario time (jump-induced expiries queue as
controller-confirmable, not auto-firing en masse); the weather timeline snaps to the new time; feeds
render backfilled content in correct scenario order. **Continuous clock compression is explicitly out
of scope** (COR-051, Master decision 12).

## Acceptance Criteria
- [ ] A Director can advance scenario time to a target ("D+3, 0800"); the clock jumps discretely (no
      continuous 2× compression — out of scope).
- [ ] On a jump, the clock notifies subsystems so each applies its defined behavior: queue batch
      disposition (E7 CTL-015), E8 timer re-evaluation (queued, not mass-auto-fire), weather snap,
      feed backfill in scenario order.
- [ ] Jump-induced engine expiries are surfaced as controller-confirmable rather than auto-firing en
      masse.
- [ ] The jump is a Director action, logged (XC-004). (Per D5, the E7 jump UI requires pause first —
      E7 CTL-015.)

## Out of Scope
The E7 jump UI + batch-disposition dialog (inject-queue CTL-015); E8 timer logic (E8 ADP-001); the
weather timeline (E6 WX-002); continuous compression (out of scope).

## Technical Notes
Foundation. The clock emits a jump event with old/new scenario time; subsystems subscribe. See
implementation.md (story 02).

## Dependencies
Story 01 (clock); consumed by E7 CTL-015, E8, E6. Roles (Director).

## Tests
- Unit: a jump advances scenario time discretely and emits a jump event with the skipped span;
  compression is not offered.
