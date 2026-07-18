# Feature: Storylines (storyline model)

**Epic:** E8 — Adaptive Content Engine · **Phase:** 2 (v1) · **World:** staff / backend
**Feature doc:** `docs/features/storyline-model/` · **Design:** `docs/design/E8-ENGINE-ARCHITECTURE.md` §1.1 / §6
**Issue:** #129 (stories #152–#156)

The engine's **state layer**: the storyline object and its lifecycle, continuous intensity/sentiment,
named escalation curves, per-exercise rate governance, and the dial-target follow loop. This is one of
the two "decide"-stage inputs the reaction loop consumes (the other is the generation core, PR #248).

**Pure backend domain logic** — no E2/E7 dependency, no participant surface. Every storyline is
exercise-scoped (COR-001) and staff-only (XC-002); all timers run in **scenario time** (COR-050/051).
The feature *produces* domain events and returns them from its operations; it does not depend on a
telemetry sink — `engine-telemetry-tuning` maps them onto the XC-004 taxonomy.

## The seams (what the reaction loop imports)

| Type | Role |
|---|---|
| `Models/Storyline.cs` | The aggregate (§1.1): state + config + reserved `ExpectedActionRef`/`RumorRefs`, the phase transitions, `Tick`, `RecordMatchedResponse`, `SetTargetIntensity`, `AssignCurve`. |
| `Services/StorylineStateMachine.cs` | The `DORMANT→SEEDED→ESCALATING→PEAK→ADDRESSED→DECAYING→RESOLVED` transition table (+ re-open); illegal transitions are rejected. |
| `Services/EscalationCurves.cs` | The curve registry (`Slow burn` / `Standard` / `Flash panic`) + `CurveFor(name)` (ADP-010). |
| `Services/IntensityModel.cs` | Pure intensity math (ADP-012): curve rise/decay bent up by amplification; `TickTowardTarget` drives to the dial target (CTL-022). |
| `Services/SentimentModel.cs` | Pure sentiment blend (engine state + reactions + content) and the intensity-weighted exercise-wide aggregate. |
| `Services/RateGovernance.cs` + `Services/ExerciseRateGovernor.cs` | Per-exercise cap/floor evaluation (ADP-011): `WithinCap` / `BelowFloor` / `AmbientDeficit`, live-changeable + logged. |
| `Services/TargetFollow.cs` | The decide-stage hint (CTL-022): `Modulate(storyline) → {raise/lower/hold}`, cap-bounded. |
| `Services/StorylineBriefProjection.cs` | `storyline.ToBrief()` → the generation-facing `StorylineBrief` (§3.3), with a phase/sentiment-derived tone mix. |
| `Services/IScenarioClock.cs` | The scenario-time seam (COR-050/051): freeze halts timers, a time-jump advances them. |
| `Models/StorylineEvents.cs` | `StorylineStateChanged` / `StorylineMeasured` / `SteeringActionLogged` / `RateGovernanceChanged` (→ `storyline.state_changed`, `engine.measured`, steering-action log). |

## Design decisions worth knowing

- **Intensity is 0–100 canonical** (§1.1); the epic's "0–10" is the planner's coarse label (×10).
- **Sentiment is explainable on purpose** — a fixed-weight blend, defensible in a hotwash (EVL-014).
  Exercise-wide sentiment is intensity-weighted so a loud concern dominates the mood.
- **The dial target overrides the curve, not the other way round** (CTL-022): with a target set the engine
  drives actual→target within the rate cap; the curve is only the *natural* trajectory when no target is
  set. The engine **never** raises intensity past a controller-lowered target — controller authority is
  absolute.
- **A matched official response** (ADP-002) addresses the storyline, resets the silence clock, and bends
  intensity down; an off-platform marker (CTL-026) is parity. The miss-safe *unmatched* default (ADP-002a)
  belongs to `response-reaction`, not here.
- **Reserved v1.1 / Phase-4 slots** (`RumorRefs`, `ExpectedActionRef`) exist now so rumor-model (§10.1)
  and Cadence binding (ADP-006) need no migration.

## Status

| Story | State |
|---|---|
| 01 Storyline object + state machine | Done — aggregate, 7-state machine, reserved slots, `storyline.state_changed`. |
| 02 Intensity + sentiment | Done — `IntensityModel` / `SentimentModel`, the scenario-time `Tick`, `engine.measured`, `ToBrief`. |
| 03 Escalation curves | Done — `EscalationCurve` + registry; live `AssignCurve` logs a steering action. |
| 04 Rate caps + quiet floors | Done — `RateGovernance` + `ExerciseRateGovernor`; live change logged. |
| 05 Dial-target follow loop | Done — `SetTargetIntensity`, `TickTowardTarget`, `TargetFollow.Modulate`. |

Consumed by `reaction-loop` (the decide stage) and `engine-telemetry-tuning`. The escalation dial UI
(world-steering #25) sets the target this feature follows.
