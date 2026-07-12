# Story: Queue-pressure meter (demand, not performance)

**Feature:** Live monitoring  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-034  ·  **Design decisions:** D5-014/2.7, D5-003  ·  **Issue:** #33

## Context
The controller workload budget made visible. The D5 review turned CTL-034's "decisions/min" into a
**queue-pressure meter**: decisions **demanded** per minute over a rolling 60s window, with a design
budget of **≤6**, amber past 6. It is explicitly **demand, not a controller-performance measure** —
staff-performance surveillance was rejected. The meter exists so a design that pushes sustained demand
past the budget is caught (CTL-034 is an acceptance criterion for E7+E8 together).

> **Amendment (D5-014/2.7, D5-003).** Before: "decisions/min" AC (unspecified surfacing). After: a
> header/action-bar queue-pressure meter = decisions demanded/min (rolling 60s), budget ≤6, amber past
> 6; tooltip states it is demand, not performance. Surveillance explicitly rejected.

## Acceptance Criteria
- [ ] Given the console, when it renders, then a header/action-bar meter shows **decisions demanded**
      per minute over a rolling 60s window (review-queue actions + response-match prompts + queue
      fires demanded of the controller).
- [ ] The meter shows amber past the **budget of 6**; the state is conveyed by number + label, not
      color alone (NFR-001).
- [ ] The meter's tooltip states plainly that it measures **demand on the console, not the
      controller's performance**, and the value is **never** persisted or surfaced as a per-controller
      performance/evaluation signal.
- [ ] The demanded-decisions count **agrees** with the NEEDS-YOU bar and the review-queue pending
      count (single source of truth; D5-014/2.1).
- [ ] The meter is exercise-scoped (COR-001) and staff-only (XC-002).

## Out of Scope
Any controller-performance analytics or evaluation (explicitly rejected); the review queue itself
(engine-review-cockpit); the NEEDS-YOU bar (console-shell story 02, which shares the source).

## Technical Notes
Staff world (COBRA). Computes a rolling-60s demand rate from the same derived to-dos source as the
NEEDS-YOU bar (no separate tally). Value is ephemeral — not written to any per-controller record. See
implementation.md (story 04).

## Dependencies
console-shell (NEEDS-YOU source), engine-review-cockpit (review demand), inject-queue (fire demand).
Ticks STORY-UPDATES.md §A **CTL-034** and contributes to §C count-consistency (D5-014/2.1).

## Tests
- Unit: the meter computes demanded-decisions/min over a rolling 60s window and goes amber past 6.
- Unit: the value is not persisted to any per-controller record.
- Unit: the count matches the NEEDS-YOU / review-queue pending source.
