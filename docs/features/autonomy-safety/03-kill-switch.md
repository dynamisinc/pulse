# Story: Kill switch (drop to Suggest / stop)

**Feature:** Autonomy & safety  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** ADP-042  ·  **Design decisions:** none  ·  **Issue:** #171

## Context
One control **drops the entire engine to Suggest (or full stop) instantly** (ADP-042). It is the
**manual** sibling of the automatic degraded-mode fallback (engine-generation-infra story 05): both
move autonomy only *down*, never up. The kill switch is the controller's emergency brake when the
engine is misbehaving, the scenario changes abruptly, or the world needs to go quiet now.

## Acceptance Criteria
- [ ] Given any engine autonomy level, when a controller hits the kill switch, then the engine drops
      to **Suggest** (nothing auto-publishes) **or** full stop (no generation), per the control's
      setting, **instantly**.
- [ ] Given the kill switch has fired, when the situation resolves, then the engine does **not** raise
      its own autonomy back up — a controller restores it explicitly (self-escalation invariant).
- [ ] Given in-flight Delayed-auto countdowns, when the kill switch fires, then they are suspended (no
      auto-send) — consistent with dropping to Suggest.
- [ ] Given the kill switch fires, when it does, then it is logged (XC-004) with actor + scenario time,
      and the state is clearly indicated in the console (text + icon, not color alone; NFR-001),
      staff-only (XC-002).
- [ ] The kill switch coexists with the automatic degraded-mode fallback (they share the "autonomy
      only moves down" invariant) — either can trip; neither auto-recovers autonomy.

## Out of Scope
The automatic degraded-mode circuit breaker (engine-generation-infra story 05 — the automatic sibling);
the tiered pause (world-steering #26 — pause-engine is related but distinct: pause halts *new* content
while the kill switch drops *autonomy*); the autonomy levels (story 01).

## Technical Notes
Staff. A single control setting exercise engine-autonomy to Suggest (or a stopped flag), suspending
in-flight auto-sends. Shares the invariant + likely the console surface with degraded-mode. See
implementation.md (story 03) and architecture §8.4.

## Dependencies
Story 01 (autonomy levels it drops to); engine-generation-infra story 05 (shared invariant/surface);
reaction-loop (honors the dropped level); world-steering / console-shell (the control surface).

## Tests
- Unit: kill switch drops to Suggest/stop instantly and suspends in-flight countdowns.
- Unit: no auto-recovery of autonomy; the trip logs with actor + scenario time.
