# Story: Server-authoritative pause tier (Freeze genuinely halts the engine; Engine-paused unifies with the kill switch)

**Feature:** World steering  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-023, COR-001, COR-050/052, XC-002, XC-004  ·  **Design decisions:** D5-014/1.3 (see story 03)  ·  **Issue:** #350

> **Definition of done includes verified-in-UAT, not just unit-green.** Stories 02/03 shipped
> `Complete` and CLOSED on GitHub as frontend-only seams whose consumers were never wired — the
> controls looked done because their tests were green, and nobody exercised them against a live
> backend before closing the issue. This story is not Complete on green tests alone: it must be
> confirmed live against a deployed backend with `VITE_USE_MOCK_DATA` off — Freeze must visibly
> stop the reaction loop (no new review items appear while frozen) and Engine-paused must visibly
> agree with `<EngineControlBar>`'s STOP position, in the browser, before this is marked Complete.

## Context
Story 03 built a correct, well-tested tiered-pause **state machine** — `usePauseState()`, its four
tiers, the guarded Freeze confirm, the `steering_action` telemetry — entirely as a **frontend
module store**. Nothing downstream ever learns a tier changed. This session's UAT audit confirmed:

- **Freeze** installs a browser-local `pausableExerciseClock` (via `setExerciseClock()`) that stops
  only the `staff-shell` header's own scenario-time read, in that one tab. The backend has a real,
  already-built native clock (`ExerciseClockService` : `IExerciseClock`, `Freeze`/`Unfreeze`/`Jump`,
  `src/Pulse.WebApi/Features/EngineRuntime/Clock/`), and `ReactionLoopHost.TickExerciseAsync` already
  skips a tick entirely when `_exerciseClock.IsFrozen(exerciseId)` — but **no endpoint calls
  `Freeze`/`Unfreeze`**, so the engine keeps generating while the console reads WORLD FROZEN.
- **Pause engine** does nothing today, and it sits a few hundred pixels from a control that DOES
  work: `<EngineControlBar>`'s LIVE / SUGGEST-ONLY / STOP kill switch, wired in PR #337 to
  `POST /api/engine/autonomy/kill-switch` / `/restore` (`liveEngineControlActions.ts`). Two
  engine-stop controls, one real and one inert, is exactly the kind of confusion a controller
  hits mid-exercise.
- **Pause injects** has nothing to pause — the `inject-queue` feature (#4) is entirely `Not
  Started`. Per this session's decision, this story does **not** build an inject queue; it ships
  the two tiers that are genuinely wireable now (Pause engine, Freeze world) and leaves Pause
  injects **honestly disabled**, not silently broken.

This story makes the pause tier **server-authoritative**: a new `POST /api/steering/pause-tier`
records the tier per exercise and, on Freeze, calls the ALREADY-BUILT `ExerciseClockService`; on
Pause engine, `usePauseState` drives the SAME kill-switch/restore path `<EngineControlBar>` uses
(a frontend-only unification — no new backend engine-control code, and this story does **not**
touch `EngineReviewEndpoints.cs`, which is a concurrent story's file in another feature).
Ticks STORY-UPDATES.md §A **CTL-023** (already applied by story 03; this story fulfils its
"server enforces this" half). See `docs/features/world-steering/feature.md` and this feature's
`implementation.md` for the reuse map and Wave Plan.

## Acceptance Criteria
- [ ] Given a running, registered exercise, when the controller selects **Freeze world** in live
      mode (`USE_MOCK_DATA === false`), then `usePauseState` POSTs
      `/api/steering/pause-tier` (`tier: 'freeze'`), the backend calls
      `IExerciseClock.Freeze(exerciseId)`, and `ReactionLoopHost`'s next tick for that exercise is
      skipped (`IsFrozen` true) — no `engine.observed`/`decided`/`generated` telemetry is produced
      and no review item is enqueued while frozen.
- [ ] Given the console frozen, when the controller selects **Resume** (`running`), then the
      backend calls `IExerciseClock.Unfreeze(exerciseId)` and the reaction loop resumes ticking
      from **exactly** the scenario minute it held at — no scenario time is lost (COR-050),
      matching `ExerciseClockService`'s own freeze/unfreeze contract.
- [ ] Given the controller selects **Pause engine** in live mode, then the SAME kill-switch/restore
      path `<EngineControlBar>` drives is invoked (`mode: 'stop'` entering the tier, `mode: 'live'`
      leaving it) — reusing the #337 wiring with **no new backend engine-control endpoint** — so
      the tier pill and `<EngineControlBar>` always agree on whether the engine is stopped; they
      never show contradictory states.
- [ ] Given any tier-change POST is rejected (network/backend failure) after the optimistic local
      tier flip has already applied, then `usePauseState` reverts to the prior tier **unless** a
      newer transition has since superseded it (mirrors `useEngineControl.setMode`'s guarded-revert
      from #337 — a stale rejection can never clobber a newer toggle).
- [ ] Given the controller attempts to select **Pause injects**, then the control is visibly
      disabled with an honest inline reason (e.g. "No inject queue yet") and takes no action —
      CTL-023's three-tier shape is preserved for a later phase without pretending it works today.
- [ ] Given `USE_MOCK_DATA` is true (the dev/UAT default), then `usePauseState`'s existing
      browser-local `pausableExerciseClock` behavior from story 03 is **unchanged** — this story
      adds a live branch; it does not alter or remove the mock path.
- [ ] Isolation (COR-001/XC-002): pause-tier state is held per-exercise, server-side, keyed the
      same way `ExerciseClockService` keys its own state; the endpoint is gated by the same
      staff-plus-assigned-exercise filter the review cockpit uses (`EngineCockpitStaffAuthorizationFilter`,
      reused unmodified) — a caller not assigned to the resolved exercise gets `403`, an
      unauthenticated/unscoped caller gets `401`, and a Freeze on exercise A never touches
      exercise B's clock. Every tier transition still emits exactly one `steering_action` XC-004
      event (unchanged shape from story 03) — this story does not duplicate that emission when the
      live POST additionally fires.

## Out of Scope
Building the inject queue or making Pause injects functionally pause anything (tracked separately
as `inject-queue`, feature #4 — the user's explicit decision this session); Break Fiction (story
04, deferred, which implies world-freeze); the participant-visible overlay / holding page (story
08 — this story only records the tier and exposes the seam a real overlay publisher will use; it
does not push to participants or touch `overlay-state`); reconciling a pre-existing `suggest-only`
selection on `<EngineControlBar>` across a Pause-engine/Resume cycle — Pause engine always sets
`'stop'` and Resume always sets `'live'`, so a controller who had manually chosen suggest-only
before pausing loses that nuance on Resume (a documented, accepted gap, mirroring
`useEngineControl.ts`'s own "KNOWN GAP" comment style); multi-controller conflict resolution for
simultaneous tier changes (last-write-wins is acceptable; no locking/CRDT); surviving an App
Service restart (in-memory state only, the same accepted limitation `ExerciseClockService` already
has).

## Technical Notes
Staff world (COBRA). **Backend** (new files, under
`src/Pulse.WebApi/Features/EngineRuntime/Steering/`, kept disjoint from
`EngineReviewEndpoints.cs`): `PauseTierEndpoints.cs` (the `Add*`/`Map*` minimal-API convention,
mapping `POST /api/steering/pause-tier` and a `GET` for resync) backed by a small in-memory
per-exercise `PauseTierRegistry` (mirrors `ExerciseClockService`'s `ConcurrentDictionary<Guid, ...>`
keying pattern) and `IPauseOverlayPublisher` — a seam interface with a `NullPauseOverlayPublisher`
default (`TryAddSingleton`) that story 08 REPLACES with a real implementation via
`services.RemoveAll<IPauseOverlayPublisher>()` + `AddSingleton<..., Real...>()`, mirroring
`EngineReviewEndpoints.AddEngineReview`'s existing `IProviderHealthListener` swap pattern. The
endpoint calls this publisher on every tier transition; until story 08 lands, it's a no-op, so
story 07 does not block on story 08. Reuses `EngineCockpitStaffAuthorizationFilter` unmodified.
Freeze/Unfreeze go through the injected `IExerciseClock` (`ExerciseClockService`), never a new
clock implementation. **Frontend:** extends `usePauseState.ts` with a live branch (mirrors
`useReviewQueue`'s `USE_MOCK_DATA` split) plus a new `features/controller/services/livePauseTierActions.ts`
(POST, modeled directly on `liveEngineControlActions.ts`'s shape — no client `exerciseId`, COR-001).
For the engine-tier unification, `usePauseState()` composes `useEngineControl()` internally (a
hook calling another hook is legal here — both are called unconditionally on every render) and
calls its `setMode('stop' | 'live')` on entering/leaving the `engine` tier, so both surfaces read
the one `engineControlStore` module singleton. Kept file-disjoint from story 09's storyline
endpoint file (different file under the same `Steering/` folder is fine; the same file is not).
**Orchestrator-owned wiring caution (the #310→#317 lesson):** the new `AddPauseTierSteering()` /
`MapPauseTierSteering()` pair is a serial `Program.cs` edit after this story's Gate-2 — a
merged-but-unwired slice is invisible until someone hits it in UAT, which is exactly how #25/#26
reached the user broken. See `implementation.md` for the reuse map and Wave Plan.

## Dependencies
Story 03 (`usePauseState`, `pausableExerciseClock` — mock path unchanged); the shipped native
clock (`IExerciseClock`/`ExerciseClockService`, `src/Pulse.WebApi/Features/EngineRuntime/Clock/`);
the shipped `EngineCockpitStaffAuthorizationFilter`; the shipped kill-switch/restore endpoints +
`useEngineControl`/`liveEngineControlActions.ts` (#337). The orchestrator-owned `Program.cs` wiring
(new `Add*`/`Map*` pair) lands as a serial step after Gate-2. Story 08 depends on this story's
`IPauseOverlayPublisher` seam. Ticks STORY-UPDATES.md §A **CTL-023**'s "server enforces this" gap.

## Tests
- Unit (backend): `PauseTierRegistry` records a tier per exercise, keyed independently (a Freeze on
  exercise A never marks exercise B frozen); entering/leaving `freeze` calls the injected
  `IExerciseClock.Freeze`/`Unfreeze` exactly once each; every transition invokes the registered
  `IPauseOverlayPublisher` (a fake in the test, asserting the no-op default doesn't throw).
- Unit (backend): the endpoint fails closed — no staff session `401`, staff-but-unassigned `403`,
  assigned staff `200` — via the reused filter (no new authorization code).
- Unit (frontend): `usePauseState`'s live branch — optimistic flip, POST, and revert-on-rejection
  unless superseded by a newer transition (mirrors the `useEngineControl.setMode` revert test).
- Unit (frontend): entering/leaving the `engine` tier calls `useEngineControl().setMode('stop'|'live')`
  with the correct value; `<EngineControlBar>` and the tier pill read the same store snapshot.
- Unit (frontend): the Pause-injects control is disabled and inert (no `setTier('injects')` call
  reaches the store) and communicates its reason via an accessible name/description, not color
  alone (NFR-001).
- Regression: `USE_MOCK_DATA=true` — story 03's existing test suite passes unchanged.
- **Manual/UAT (required for Complete):** with mock off, open the console against a live exercise;
  select Freeze; confirm via the review queue (or `engine.*` telemetry) that no new items/events
  appear while frozen; select Resume; confirm ticking resumes with no scenario-minute jump. Select
  Pause engine; confirm `<EngineControlBar>` shows STOP; Resume; confirm it shows LIVE again.
