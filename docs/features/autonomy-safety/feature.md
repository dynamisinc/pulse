# Feature: Autonomy & safety

**Epic:** E8 — Adaptive Content Engine  ·  **Phase:** 2 (v1)  ·  **Feature ref:** F8.5
**World:** staff  ·  **Issue:** #135

## Summary
The load-bearing safety layer: the per-exercise (per-storyline overridable) autonomy levels
(Suggest + Delayed-auto in v1; Auto is v1.1), the **auto-HOLD-on-timeout** behavior E8 must produce
for the review cockpit (never auto-send — silence is never approval), the kill switch, and the
**CTL-034 controller-workload contract** that keeps the engine load-*reducing*. Automation never
escalates its own autonomy; every safety control moves autonomy only *down*.

## Requirements covered
ADP-040 (autonomy → the review queue behavior, auto-HOLD), ADP-042 (kill switch), CTL-034 (workload
budget as a joint E7+E8 acceptance criterion). Honors the D5 amendments D5-014/1.1 (auto-HOLD) and
D5-014/2.7 (queue-pressure = demand).

## Design references
`docs/design/E8-ENGINE-ARCHITECTURE.md` §8 (autonomy & safety state machine). D5
`STORY-UPDATES.md` §A (ADP-040 auto-HOLD, CTL-034 queue-pressure). Consumes the existing
engine-review-cockpit (#34–36) and world-steering; produces exactly what they consume.

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Suggest + Delayed-auto autonomy levels | ADP §2.3 (v1 subset) | Complete | #169 |
| 02 | Auto-HOLD-on-timeout wiring (never auto-send) | ADP-040 / D5-014/1.1 | Complete | #170 |
| 03 | Kill switch (drop to Suggest / stop) | ADP-042 | Complete | #171 |
| 04 | Controller-workload contract (≤6/min demand) | CTL-034 / D5-014/2.7 | Complete | #172 |

**Delivered** as the pure-backend `Pulse.Core/Features/Autonomy/*` slice (see its `README.md`): the
`EngineAutonomyState` aggregate (level resolution + kill switch + degraded-mode clamp), the pure
`AutoHoldPolicy`, the `AutonomyProviderHealthListener` bridge onto generation-infra's
`IProviderHealthListener`, and the CTL-034 `WorkloadDemandMeter` + `DemandAccounting`. No E2/E7 dependency;
no participant surface. **The API/DTO seam to the E7 cockpit (`EngineReviewItem` / `DraftDisposition`)
defined here now converges: the WebApi exists (Phase B0), and the endpoints/DI + SignalR push wiring
these services to the shipped cockpit is built as `docs/features/engine-runtime/02-review-cockpit-api.md`**
(Phase B3) — that story consumes `EngineAutonomyState`, `AutoHoldPolicy`, `WorkloadDemandMeter`, and the
frozen models exactly as written here; it does not re-derive the safety logic.

## Dependencies
engine-review-cockpit (#34 queue, #35 auto-HOLD, #36 swamped-mode) — E8 produces what these consume;
world-steering (queue-pressure meter, tiered pause); reaction-loop (routes drafts per level;
generate/publish/measure back-half now built as `engine-runtime/01`); engine-generation-infra story 05
(degraded-mode is the automatic sibling of the kill switch); E1 roles (lead-controller gate for swamped
mode). E1 clock (Delayed-auto countdown in scenario time — the loop-facing subset delivered by
`engine-runtime/03`). **`engine-runtime/02`** — the consumer that wires these built services to real
endpoints + SignalR push and flips the cockpit's `useReviewQueue` off its mock store.

## Design notes
Staff (COBRA). The safety invariants (architecture §8.2): **auto-HOLD on timeout, never auto-send**
(D5-014/1.1, supersedes D5-005 — auto-send only behind lead-controller swamped mode, #36);
**automation never escalates its own autonomy** (Suggest→Delayed→Auto is always a human toggle;
degraded mode + kill switch only move down); **the engine never removes controller authority**. The
CTL-034 contract is *the* number separating "junior staffer" from "second job" — E8 reduces demand by
burst-level review, storyline-level autonomy, pre-filtering, and match suggestion. A design past
~6/min is wrong; flag it.
