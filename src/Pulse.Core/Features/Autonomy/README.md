# Feature: Autonomy & safety

**Epic:** E8 — Adaptive Content Engine · **Phase:** 2 (v1) · **World:** staff / backend
**Feature doc:** `docs/features/autonomy-safety/` · **Design:** `docs/design/E8-ENGINE-ARCHITECTURE.md` §8 (+ §3.5)
**Issue:** #135 (stories #169–#172)

The engine's **load-bearing safety layer**: it decides *whether and how* generated content ships. This is
the third "decide"-stage input the reaction loop consumes, alongside the storyline model (*what to say*)
and the generation core (*how to say it*).

**Pure backend domain logic** — no E2/E7 dependency, no participant surface. Every control is
exercise-scoped (COR-001) and staff-only (XC-002); all timers run in **scenario time** (COR-050/051). The
feature *produces* domain events and returns them from its operations; it does not depend on a telemetry
sink — `engine-telemetry-tuning` maps them onto the XC-004 taxonomy.

## The seams (what the reaction loop + cockpit import)

| Type | Role |
|---|---|
| `Models/AutonomyLevel.cs` | `Suggest` / `DelayedAuto` (v1); `Auto` reserved for v1.1 and rejected by `AutonomyLevels.EnsureSelectable`. `AutonomyLevels.Lower` is the "only ever move down" primitive. |
| `Services/EngineAutonomyState.cs` | The per-exercise aggregate (#169/#171): default + per-storyline overrides, the resolution rule, the kill switch, the degraded-mode clamp, swamped-mode flag. `ResolveEffective(storyline)` is what dispatch routes on. |
| `Services/IEngineSafetySwitch.cs` | The automation-facing seam — **lowering paths only** (§8.2). No method here can raise autonomy. |
| `Services/AutoHoldPolicy.cs` | The pure auto-HOLD decision (#170): `(countdown, effective level, current scenario minute, swamped) → {Hold \| Publish \| AwaitDecision}`. Silence is never approval. |
| `Services/AutonomyProviderHealthListener.cs` | Bridges generation-infra's `IProviderHealthListener` (§3.5) into the same clamp mechanism the kill switch uses (#171). |
| `Services/WorkloadDemandMeter.cs` | The CTL-034 demand meter (#172): rolling scenario-time demand rate; amber past ~6/min. A **demand** meter, never a controller-performance measure. |
| `Services/DemandAccounting.cs` | Pure quantifiers proving each demand-reduction mechanism lowers demanded decisions (burst-level review, storyline-level autonomy, pre-filtering, match suggestion). |
| `Models/DelayedAutoCountdown.cs` | The scenario-time countdown snapshot for one Delayed-auto draft (+ `ControllerDecision`). |
| `Models/EngineReviewItem.cs` | The **review-item / draft-disposition contract** (`DraftDisposition`) autonomy-safety *produces* and engine-review-cockpit (#34–36) *consumes*. |
| `Models/AutonomyEvents.cs` | `AutonomyLevelChanged` / `EngineKillSwitchFired` / `SwampedModeChanged` / `DraftTimeoutResolved` → the XC-004 autonomy + `engine.reviewed` log entries. |

## The safety invariants (architecture §8.2 — the whole point of the feature)

1. **Auto-HOLD on timeout, never auto-send** (D5-014/1.1, supersedes D5-005). A Delayed-auto countdown that
   expires with no decision **holds** ("timer expired — held for you", NEEDS YOU) — silence is never
   approval. The *only* auto-send-on-timeout path is the explicit, lead-controller-gated **swamped mode**
   (#36), and even that is suspended the moment a safety clamp lowers the effective level.
2. **Automation never escalates its own autonomy.** Suggest→Delayed→Auto is *always* a human toggle
   (`SetExerciseDefault` / `SetStorylineOverride`, cause `Human`). The kill switch and the degraded-mode
   listener only ever clamp *down*; recovery re-enables generation at the current level, it never raises.
   A controller lifts a clamp explicitly via `RestoreFromSafety` — base config is preserved underneath, so
   a restore never loses per-storyline overrides.
3. **The engine never removes controller authority.** Every level change, kill-switch trip, swamped-mode
   toggle, and timeout resolution is returned as an event to log.

## Design decisions worth knowing

- **The kill switch and degraded mode share one clamp** (`EngineAutonomyState`): the manual brake (§8.4)
  and the automatic provider fallback (§3.5) converge on the same lowering mechanism. Neither auto-recovers.
- **`Auto` exists in the enum but is not selectable in v1** — the slot is reserved so v1.1's `auto-mode`
  feature needs no enum change; `EnsureSelectable` throws on it today.
- **Decoupled from Storylines' clock.** The pure policies take an `int` scenario minute, so the slice does
  not depend on `IScenarioClock`; only `AutonomyProviderHealthListener` reads the clock (read-only) to
  stamp the degrade/recover transition in scenario time.
- **Demand, not performance.** `WorkloadDemandMeter` measures what the engine's design *pushes onto* a
  controller (CTL-034 / D5-014/2.7). A value past budget flags an engine defect (too much demand), never a
  slow controller — the type exposes no human throughput/efficiency.

## Status

| Story | State |
|---|---|
| 01 Suggest + Delayed-auto levels (#169) | Done — `AutonomyLevel`, `EngineAutonomyState` resolution + overrides, human-only raise. |
| 02 Auto-HOLD-on-timeout (#170) | Done — `AutoHoldPolicy` (Hold/Publish/AwaitDecision), swamped-mode as the only auto-send. |
| 03 Kill switch + degraded-mode (#171) | Done — `EngageKillSwitch`, `AutonomyProviderHealthListener`; one-way toward less autonomy. |
| 04 Workload demand meter (#172) | Done — `WorkloadDemandMeter` + `DemandAccounting`. |

Consumed by `reaction-loop` (dispatch routes on `ResolveEffective`; the timeout policy resolves countdowns)
and `engine-review-cockpit` (#34–36, which renders `EngineReviewItem` / `DraftDisposition`). DI wiring
(the per-exercise safety-switch registry that fans one provider trip out to every active exercise) lands
with the WebApi — none exists yet, so this ships as pure domain logic.
