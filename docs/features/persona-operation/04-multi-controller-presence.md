# Story: Multi-controller presence & safe co-operation

**Feature:** Persona operation  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-004  ·  **Design decisions:** none  ·  **Issue:** #17

## Context
On a multi-controller exercise, two operators might reach for the same persona. Simultaneous
operation is allowed but must be **visible** (CTL-004): presence indicators show who is operating
which persona, using the same SignalR presence pattern as Cadence review — so controllers don't
unknowingly step on each other's voice.

## Acceptance Criteria
- [ ] Given two controllers in the same exercise, when one has a persona active in the composer,
      then the other sees a presence indicator on that persona (in the picker and composer) naming
      the operating controller.
- [ ] Presence updates in near-real-time as controllers select/deselect personas (SignalR presence).
- [ ] Simultaneous operation is **not blocked** — presence informs, it does not lock; both may post
      (each post is attributed to its acting human per story 01 / COR-018).
- [ ] Presence is a staff-only signal — it is never surfaced on any participant surface (XC-002).
- [ ] Presence state degrades safely if the real-time channel drops (no false "in use" that can't
      clear; NFR-003).

## Out of Scope
Hard locking/checkout of personas (explicitly not wanted); the presence host connection itself if
provided by console-shell; approval chains / JIC shift handoff (Phase 3, COR-018).

## Technical Notes
Staff world. Uses the shared SignalR connection (once the real-time host lands) keyed by persona id
within the exercise. Until SignalR is wired, ship the presence UI against a mockable hook and flag
the dependency. See implementation.md (story 04).

## Dependencies
The SignalR real-time host (later in Phase 1); story 02 (active persona). Pairs with story 01
attribution.

## Tests
- Component (RTL): a presence badge appears for a persona another controller is operating.
- Unit: presence state clears on a simulated disconnect (no stuck "in use").
