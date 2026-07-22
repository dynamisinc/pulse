# Story: Scenario-clock service — native COR-050 clock driving the loop's timers  `[backend]`

**Feature:** engine-runtime  ·  **Epic:** E8  ·  **Phase:** 2  ·  **Stack:** backend  ·  **Status:** Complete
**Requirements:** COR-050, COR-051, COR-052 (COR-053, CTL-023, CTL-015, COR-001)  ·  **Design decisions:** none  ·  **Issue:** #287

> **Reconciles `exercise-clock` #77 (partially).** This delivers the COR-050 native-clock backend
> `exercise-clock/01 (#77)` speced — **scoped to what the engine's loop consumes** (the clock + the
> timer subscription + freeze/jump). It does **not** close `exercise-clock`'s COR-054 EndEx (#81) or the
> full TTX-advancement breadth (#79) — those remain `exercise-clock`'s later stories. Scope honestly.

## Context
Pulse owns a **native exercise clock from Phase 1** (COR-050) — not an E9/Cadence dependency. The
engine's scenario-time timers today run against the hand-cranked `IScenarioClock`
(`Pulse.Core/Features/Storylines/Services/IScenarioClock.cs`), which exposes only
`CurrentScenarioMinute` and is described in its own doc comment as a stand-in: "the real clock is E1's
and isn't built yet; the reaction loop supplies an implementation." The reaction-loop host (story 01)
and the Delayed-auto countdown (story 02) both need real StartEx + pause/freeze + time-jump semantics.

This story builds the native exercise clock as a backend service driving the engine's scenario-time
timers, behind a **swappable `IExerciseClock`** (Cadence becomes the provider in Phase 4 behind the
same interface, exactly like the swappable generation provider). It delivers what the loop consumes:
the clock, the timer subscription, and freeze/jump. Backend/platform — no participant surface (the
participant-visible scenario-time *rendering*, COR-053, already shipped as `exercise-clock/04` #80).
See `feature.md` and `implementation.md`.

## Acceptance Criteria
- [x] **StartEx + monotonic tick.** Given an exercise starts, When StartEx fires, Then the clock begins
  at the exercise's scenario start instant in the exercise time zone and advances scenario time
  monotonically; `CurrentScenarioMinute` increments; the reaction-loop host and any Delayed-auto
  countdown subscribe to and advance off this one clock.
- [x] **Freeze stops the clock (COR-052 / CTL-023).** Given a Freeze-world command, When the scenario
  is frozen, Then scenario time holds constant — engine silence windows do **not** accrue and
  Delayed-auto countdowns do **not** advance while frozen — and it resumes exactly where it stopped on
  unfreeze (so an engine silence window that had 4 minutes left still has 4 minutes left).
- [x] **Discrete time-jump (COR-051 / CTL-015).** Given a Director time-jump of N scenario minutes, When
  the jump fires, Then `CurrentScenarioMinute` advances by N in one step, and any storyline that blew
  its response window during the skipped span is carried past expiry so it surfaces in the jump's batch
  disposition (fed to story 01's observe on the next tick; a Delayed-auto countdown carried past its
  deadline resolves to a **HOLD** via `AutoHoldPolicy`, never a missed auto-send).
- [x] **Swappable provider (COR-050).** Given the clock sits behind `IExerciseClock`, Then the native
  implementation is the v1 provider and a Cadence-linked provider is a Phase-4 swap behind the same
  interface with **no** engine change; provider selection follows the config/DI pattern of
  `AddEngineGeneration`.
- [x] **Replaces the hand-cranked `IScenarioClock`.** Given the engine reads scenario minutes only
  through `IScenarioClock`, When this service is wired, Then `ObserveStage`, `Storyline.Tick`, and
  `DelayedAutoCountdown` read from the one native clock (the hand-cranked stub is adapted onto
  `IExerciseClock`, not left as a parallel clock).
- [x] **Scenario time only (COR-053).** Given the loop's timers and the Delayed-auto countdown, Then
  they are computed in scenario time in the exercise time zone — a freeze halts them and a jump advances
  them; wall-clock never drives an engine timer.
- [x] **Isolation (COR-001).** Given a per-exercise clock, When exercise A is frozen or jumped, Then it
  never affects exercise B's scenario time; the clock is exercise-scoped.

## Out of Scope
- **COR-054 EndEx** (`exercise-clock/05`, #81) — remains `exercise-clock`'s later story.
- **Full overnight / TTX module advancement** (`exercise-clock/03`, #79) — only the freeze/jump the
  engine loop consumes is built here.
- **Participant-visible scenario-time rendering** (COR-053) — already shipped as `exercise-clock/04`
  (#80, frontend); this story feeds the backend loop, not the participant surfaces.
- **The tiered-pause / Freeze-world *UI and controls*** (`world-steering`, CTL-023) — this consumes the
  pause/freeze state; it does not build the controller controls.
- **Continuous clock compression** (Master decision 12) — explicitly out of scope; only discrete jumps
  + suspension.

## Technical Notes
Backend / platform world — no participant skin, no COBRA (no UI). Owns
`src/Pulse.WebApi/Features/EngineRuntime/Clock/**` (or a sibling clock namespace): `ExerciseClockService.cs`
(implements a native `IExerciseClock` with StartEx / pause-freeze / time-jump), a thin adapter exposing
the engine's `IScenarioClock` over it, and `AddExerciseClock()`.

**Reuse, do not reinvent** (see `implementation.md`): the engine's `IScenarioClock`
(`Pulse.Core/Features/Storylines/Services/IScenarioClock.cs`) is the seam the engine already reads —
adapt it onto the native clock rather than editing engine code. `Storyline.Tick`,
`DelayedAutoCountdown` (whole-scenario-minute math: `deadlineScenarioMinute`, `hasExpired`,
`minutesRemaining`) already do the right thing under a freeze/jump when the minute they read is driven
by this clock — the design comment on `IScenarioClock` ("leaps on a time-jump; holds constant while
frozen") is exactly the contract to satisfy. Provider swappability mirrors `AddEngineGeneration`'s
config-selected provider. Exercise time zone comes from `exercise-configuration` (COR-030) — mockable
until wired.

## Dependencies
- **Delivered:** Phase B0 (`backend-host/01` host + `Program.cs`); the built `Storylines`/`Autonomy`
  slices that read `IScenarioClock` / count in scenario minutes.
- **Requirement owner:** `exercise-clock` (#77 native clock, #78 time-jump, #79 suspension) — this
  delivers the loop-facing subset of #77 and the freeze/jump the loop needs.
- **Consumed by (same feature):** story 01 (loop timers) and story 02 (Delayed-auto countdown +
  auto-HOLD tick). Foundation for both — Wave 1.
- **Config:** `exercise-configuration` (time zone COR-030) — may be mocked this pass.

## Tests
xUnit: StartEx sets the scenario origin + TZ; a freeze holds `CurrentScenarioMinute` and a
Delayed-auto countdown does not advance while frozen, resuming on unfreeze; a time-jump of N advances
by N in one step and a countdown carried past its deadline resolves to HOLD via `AutoHoldPolicy`
(not auto-send); a storyline whose window blew during the skip surfaces on the next observe tick; the
engine's `IScenarioClock` reads the native clock (one clock, not two); per-exercise isolation (A's
freeze/jump never moves B's minute). Reuse the storyline `Tick` end-to-end pattern the built slice
already tests against a stub clock.
