# Story: Controller-workload contract (≤6/min demand)

**Feature:** Autonomy & safety  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Not Started
**Requirements:** CTL-034  ·  **Design decisions:** D5-014/2.7  ·  **Issue:** #172

## Context
The product bar is "one controller runs a believable world." CTL-034 makes it a **joint E7+E8
acceptance criterion**: at NFR-002 burst load with the engine at Delayed-auto, a single controller's
**demanded** decisions (review-queue actions + response-match prompts + queue fires) must stay
**≤6/min sustained**. D5-014/2.7 frames the visible metric as **queue pressure = demand** (amber past
6), explicitly **not** a controller-performance measure. E8's job is to *reduce* demand — a design
that multiplies controller decisions is wrong.

## Acceptance Criteria
- [ ] Given the engine at Delayed-auto under NFR-002 burst load, when demanded decisions are counted
      over a rolling 60s window, then sustained demand stays **≤6/min** — a measured acceptance test,
      not an aspiration.
- [ ] Given E8's design, when it generates, then it reduces demand by: **burst-level review** (one
      burst = one decision, not N — batch approve, ADP-040), **storyline-level autonomy** (set once,
      not per post), **pre-filtering** (guard-failing drafts never reach the queue), and **match
      suggestion** (the engine proposes the match; the controller confirms with one key).
- [ ] Given the queue-pressure meter (world-steering), when it displays, then it shows **demand**
      (decisions demanded/min, rolling 60s, amber past 6) with a tooltip stating it is demand, **not
      a controller-performance measure** (D5-014/2.7) — E8 must not surface it as surveillance.
- [ ] Given a design change that pushes sustained demand past ~6/min, when detected in the eval
      (engine-eval-harness scenario tests), then it is **flagged as a defect**, not accepted.
- [ ] The demand count is consistent with the queue's pending count and the NEEDS-YOU bar (D5-014/2.1
      consistency); staff-only (XC-002).

## Out of Scope
The queue-pressure meter UI (world-steering / live-monitoring own it — this story feeds it the demand
signal and enforces the budget); the review-queue actions (engine-review-cockpit); staff-performance
surveillance (explicitly rejected, D5-014/2.7).

## Technical Notes
Staff. This is a *contract*, enforced by the demand-reduction design decisions above + the
engine-eval-harness scenario tests (workload under burst load). The demand signal feeds the existing
queue-pressure meter. See implementation.md (story 04), architecture §8.5, and D5 `STORY-UPDATES.md`
§A (CTL-034).

## Dependencies
engine-review-cockpit (batch approve, pending count); world-steering / live-monitoring (queue-pressure
meter); response-reaction story 03 (match suggestion reduces demand); engine-eval-harness (measures
demand under burst load); reaction-loop (burst-level + storyline-level design).

## Tests
- Unit: demand-reduction mechanisms (burst-level review, storyline-level autonomy, pre-filtering,
  match suggestion) each measurably lower demanded decisions.
- Scenario (engine-eval-harness): sustained demand ≤6/min at NFR-002 burst load with Delayed-auto; a
  regression past the budget fails the build.
