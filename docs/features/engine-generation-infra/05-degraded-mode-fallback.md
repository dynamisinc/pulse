# Story: Degraded-mode fallback (circuit breaker)

**Feature:** Engine generation infrastructure  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** In Progress
**Requirements:** NFR-003, ADP-042  ·  **Design decisions:** none  ·  **Issue:** #146

## Context
Exercises are one-shot events (NFR-003). The provider interface carries a **circuit breaker**: on
provider outage, elevated error rate, or a **p95 latency breach (~10s)**, the engine **auto-falls
back to Suggest/manual** and raises a controller alert (ADP-042). This is the automatic sibling of
the manual kill switch (autonomy-safety story 03). The invariant: degradation only ever moves
autonomy **down** — automation never raises its own autonomy (architecture §3.5).

## Acceptance Criteria
- [ ] Given a provider outage or error-rate spike, when the breaker trips, then the engine drops to
      **Suggest** (no auto-publish) and the controller is alerted with the reason.
- [ ] Given generation latency, when p95 breaches the configured trip threshold (~10s), then the
      breaker trips to Suggest/manual and alerts — the same path as an outage.
- [ ] Given the breaker has tripped, when the provider recovers, then the engine does **not** raise
      its own autonomy back up — a controller restores it explicitly (automation never self-escalates).
- [ ] Given the breaker trips, when it does, then the event is logged (telemetry XC-004) with the
      trigger (outage / error rate / latency) and scenario time.
- [ ] The degraded-state indicator is **staff-only** (XC-002); no participant surface reveals engine
      state.

## Out of Scope
The manual kill switch (autonomy-safety story 03 — this is the *automatic* trip); the autonomy levels
themselves (autonomy-safety story 01); SignalR/feed polling fallback (E2/E1 — this story is the
generation-provider breaker only).

## Technical Notes
Staff/backend. Circuit-breaker around the provider interface (story 01) with configurable
error-rate + latency thresholds; on trip it sets exercise engine-autonomy to Suggest and emits an
alert to the console. Shares the "autonomy only moves down" invariant with the kill switch. See
implementation.md (story 05) and architecture §3.5.

## Dependencies
Story 01 (provider interface); autonomy-safety (autonomy levels it drops to; kill switch is the
manual sibling); XC-004 emitter; the console alert surface (engine-review-cockpit / console-shell).

## Tests
- Unit: simulated outage / error spike / p95 breach each trips the breaker to Suggest + alert.
- Unit: recovery does not auto-raise autonomy; a trip is logged with its trigger.
