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
> **AC-7's "exactly one `steering_action`" — refined during build (WR-104).** An **applied**
> transition emits exactly one event, now tagged `payload.outcome: 'applied'` (additive; the story-03
> shape is otherwise unchanged). A transition that does **not stand** — the server refused the Freeze,
> or its outcome was unknown and the authoritative re-read disagreed — emits a **second** event for the
> correcting transition, `payload.outcome: 'reverted'` + `reverted: true`. That is deliberate, not a
> duplicate: the telemetry is emitted before the POST, so without the counter-event an AAR would show
> WORLD FROZEN for a freeze the server refused with a `409` — the story's own thesis ("never report a
> pause the server did not apply") moved into the audit trail. This is the ONLY two-event transition.

- [ ] Isolation (COR-001/XC-002): pause-tier state is held per-exercise, server-side, keyed the
      same way `ExerciseClockService` keys its own state; the endpoint is gated by the same
      staff-plus-assigned-exercise filter the review cockpit uses (`EngineCockpitStaffAuthorizationFilter`,
      reused unmodified) — a caller not assigned to the resolved exercise gets `403`, an
      unauthenticated/unscoped caller gets `401`, and a Freeze on exercise A never touches
      exercise B's clock. Every tier transition still emits exactly one `steering_action` XC-004
      event (unchanged shape from story 03) — this story does not duplicate that emission when the
      live POST additionally fires.

## Follow-ups recorded during build (NOT built here)
- **A fresh console can restore `'live'` past another controller's SUGGEST-ONLY.** The displaced
  kill-switch position (`engineModeBeforePause`) lives in one browser runtime, so console B — which
  adopted `engine` from the server resync and never saw console A's pre-pause choice — seeds from its
  own `'live'` default and restores that on Resume. Within this story's declared Out of Scope (the
  suggest-only nuance); the real fix is making the kill-switch position itself server-authoritative,
  which needs the frontend/backend autonomy-model alignment already tracked separately. Commented at
  the adopt site in `usePauseState.ts`.
- **The overlay publish is not ordered.** `PauseTierRegistry` publishes OUTSIDE its lock (you cannot
  await inside one), so two rapid transitions on the same exercise can reach
  `IPauseOverlayPublisher` out of order even though the tier state itself is serialized and correct.
  Carried into story 08's brief: a participant-visible publisher should carry its own
  sequence/timestamp rather than trusting arrival order. Noted at the publish site.
- **Scenario-epoch coupling once COR-050 lands.** Because the reaction loop never re-`Start`s a frozen
  clock, whichever of "a pre-seed Freeze" or "the seed's first tick" happens first will decide the
  exercise's scenario epoch once `Exercise.CurrentScenarioTime` is populated for real. Invisible today
  (the column is a usually-null placeholder, so both paths read the server wall clock). Documented at
  `ResolveClockStartAsync`; to be reconciled with the native scenario clock in B3.

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
> **Running the backend suite.** The 16 `PauseTierEndpointsTests` cases below are
> `[RequiresDockerFact]` — they SKIP (a real *Skipped*, never a silent *Passed*) on a Docker-less
> machine. They were run for real against LocalDB via the escape hatch, and must be run that way (or
> in CI, which has Docker) for the linkage below to mean anything:
> ```
> $env:PULSE_TEST_SQL_CONNECTION = 'Server=(localdb)\MSSQLLocalDB;Integrated Security=true;TrustServerCertificate=true'
> dotnet test pulse.slnx
> ```

- Unit (backend): `PauseTierRegistry` records a tier per exercise, keyed independently (a Freeze on
  exercise A never marks exercise B frozen); entering/leaving `freeze` calls the injected
  `IExerciseClock.Freeze`/`Unfreeze` exactly once each; every transition invokes the registered
  `IPauseOverlayPublisher` (a fake in the test, asserting the no-op default doesn't throw).
  - `PauseTierRegistryTests.GetTier_UnknownExercise_DefaultsToRunning` (AC-7)
  - `PauseTierRegistryTests.SetTierAsync_KeysEachExerciseIndependently` (AC-7)
  - `PauseTierRegistryTests.SetTierAsync_FreezeOnExerciseA_NeverTouchesExerciseBsClock` (AC-7)
  - `PauseTierRegistryTests.SetTierAsync_EmptyExercise_ThrowsFailClosed` (AC-7)
  - `PauseTierRegistryTests.SetTierAsync_BlankActingHuman_ThrowsFailClosed` (AC-7)
  - `PauseTierRegistryTests.SetTierAsync_EnteringFreeze_CallsClockFreezeExactlyOnce` (AC-1)
  - `PauseTierRegistryTests.SetTierAsync_LeavingFreezeToRunning_CallsClockUnfreezeExactlyOnce` (AC-2)
  - `PauseTierRegistryTests.SetTierAsync_ReSelectingFreeze_DoesNotFreezeTwice` (AC-1)
  - `PauseTierRegistryTests.SetTierAsync_NonFreezeTiers_NeverTouchTheClock` (AC-1)
  - `PauseTierRegistryTests.SetTierAsync_EveryTransition_InvokesTheOverlayPublisher` (AC-7)
  - `PauseTierRegistryTests.SetTierAsync_NoChange_PublishesNothing` (AC-7)
  - `PauseTierRegistryTests.SetTierAsync_CarriesTheActingHuman_ToThePublisher` (AC-7, COR-018)
  - `PauseTierRegistryTests.NullOverlayPublisher_TheStory07Default_DoesNotThrow` (AC-7)
  - `PauseTierRegistryTests.PauseTierWire_RoundTripsTheFrozenClientLiterals` (AC-1)
  - `PauseTierRegistryTests.PauseTierWire_RejectsAnythingElse` (AC-1)
- Unit (backend), **CR-001 — a Freeze either really takes or is refused; it is never a silent no-op**
  (an unstarted clock is the DEFAULT state of a fresh host, since only
  `ReactionLoopHost.EnsureClockStarted` ever starts one):
  - `PauseTierRegistryTests.SetTierAsync_FreezeOnAColdClock_StartsItThenFreezesIt_AgainstTheRealClock`
    (AC-1) — runs against the REAL `ExerciseClockService`, which throws on an unstarted `Freeze`
  - `PauseTierRegistryTests.SetTierAsync_FreezeOnAColdClock_SurvivesTheReactionLoopsOwnLazyStart` (AC-1)
  - `PauseTierRegistryTests.SetTierAsync_FreezeWithNoStartPoint_IsREFUSED_AndRecordsNothing` (AC-1)
  - `PauseTierRegistryTests.SetTierAsync_FreezeWhenTheClockThrows_IsREFUSED_AndRecordsNothing` (AC-1)
  - `PauseTierRegistryTests.SetTierAsync_FreezeThatCannotBeVerified_IsREFUSED` (AC-1)
  - `PauseTierRegistryTests.SetTierAsync_ResumeIsNeverBlockedByAnUnstartedClock` (AC-2)
  - `PauseTierRegistryTests.SetTierAsync_AThrowingOverlayPublisher_NeverUndoesAnAppliedFreeze` (AC-7) —
    story 08's real publisher lands on this seam
  - `PauseTierRegistryTests.SetTierAsync_RefusedFreeze_LeavesTheClockUnfrozen_NeverHalfFrozen` (AC-1)
  - `PauseTierEndpointsTests.Post_Freeze_OnAColdClock_StartsAndFreezesIt_ReportingTheTruth` (AC-1)
  - `PauseTierEndpointsTests.Post_Freeze_OnAColdClock_ThenTheLoopsLazyStart_LeavesItFrozen` (AC-1)
  - `PauseTierEndpointsTests.Post_Freeze_WhenTheClockRefuses_Returns409_AndRecordsNothing` (AC-1) — the
    409 the whole frontend revert hangs off, proven over real HTTP (never a 500)
  - `PauseTierEndpointsTests.Get_AfterARefusedFreeze_StillReportsRunning` (AC-1)
  - `PauseTierEndpointsTests.Post_NonFreezeTier_StillSucceeds_WhenTheClockWouldRefuseAFreeze` (AC-1)
  - `SetTierAsync_FreezeOnAColdClock_SurvivesTheReactionLoopsOwnLazyStart` asserts the PRODUCTION
    predicate `ReactionLoopHost.ShouldStartClock` (extracted for exactly this reason), so a regression at
    the loop's lazy-start guard — which the whole CR-001 fix rests on — fails this test.
- Unit (backend): the endpoint fails closed — no staff session `401`, staff-but-unassigned `403`,
  assigned staff `200` — via the reused filter (no new authorization code).
  - `PauseTierEndpointsTests.Routes_AreMappedExactlyOnce` (AC-1)
  - `PauseTierEndpointsTests.Post_NoStaffSession_Returns401_FailClosed` (AC-7)
  - `PauseTierEndpointsTests.Post_UnresolvedScope_Returns401_FailClosed` (AC-7)
  - `PauseTierEndpointsTests.Post_StaffNotAssignedToResolvedExercise_Returns403_AndNeverFreezes` (AC-7)
  - `PauseTierEndpointsTests.Get_NoStaffSession_Returns401_FailClosed` (AC-7)
  - `PauseTierEndpointsTests.Get_AssignedStaff_Returns200WithTheRunningBaseline` (AC-7)
  - `PauseTierEndpointsTests.Post_Freeze_FreezesTheResolvedExercisesClock` (AC-1)
  - `PauseTierEndpointsTests.Post_Resume_UnfreezesWithoutLosingScenarioTime` (AC-2)
  - `PauseTierEndpointsTests.Post_FreezeInExerciseA_NeverFreezesExerciseB` (AC-7)
  - `PauseTierEndpointsTests.Post_NonFreezeTier_LeavesTheClockRunning` (AC-1)
  - `PauseTierEndpointsTests.Get_AfterAPost_ResyncsTheRecordedTier` (AC-7)
  - `PauseTierEndpointsTests.Post_UnknownTier_Returns400` / `Post_MissingActingHuman_Returns400` (AC-7)
  - `PauseTierEndpointsTests.AddPauseTierSteering_RegistersTheNoOpOverlayPublisherDefault` (AC-7)
- Unit (frontend): `usePauseState`'s live branch — optimistic flip, POST, and revert-on-rejection
  unless superseded by a newer transition (mirrors the `useEngineControl.setMode` revert test).
  - `usePauseState — live mode > flips the tier optimistically AND POSTs it with the acting human + time zone` (AC-1)
  - `usePauseState — live mode > POSTs the Resume transition too` (AC-2)
  - `usePauseState — live mode > reverts the optimistic flip when the POST rejects, keeping the telemetry already logged` (AC-4)
  - `usePauseState — live mode > does NOT revert when a newer transition has superseded the rejected one` (AC-4)
  - `usePauseState — live mode > reverts the engine kill switch too when the PAUSE-TIER POST rejects` (AC-4)
  - `usePauseState — live mode > resyncs ONCE on mount and adopts the server tier without emitting telemetry or POSTing` (AC-7)
  - `usePauseState — live mode > a resync that lands AFTER the controller acted never overwrites their choice` (AC-4)
  - `usePauseState — live mode > keeps the local baseline when the resync GET fails` / `resyncs only once across several mounted surfaces` (AC-7)
  - `livePauseTierActions.setPauseTier > POSTs the tier + acting human + time zone, and NO client exerciseId (COR-001)` (AC-7)
  - `livePauseTierActions.fetchPauseTier > GETs the pause-tier path with no parameters and returns the server state` (AC-7)
- Unit (frontend), **CR-001 — the console never renders a pause the server did not apply**:
  - `usePauseState — live mode > reverts a Freeze the server reports it did NOT apply (clockFrozen: false)` (AC-1/AC-4)
  - `usePauseState — live mode > reverts a Freeze the server REFUSED (the 409 rejection path)` (AC-1/AC-4)
  - `usePauseState — live mode > reverts when the server recorded a DIFFERENT tier than the one requested` (AC-4)
  - `usePauseState — live mode > keeps the Freeze when the server confirms the clock IS frozen` (AC-1)
  - `usePauseState — live mode > never adopts a Freeze the server reports as NOT applied` (AC-1)
  - `livePauseTierActions.setPauseTier > surfaces a Freeze the server did NOT apply as clockFrozen: false`
    / `treats a missing clockFrozen as NOT frozen (fail closed, never assumed)`
    / `resolves with the SERVER's resulting state, never discarding it` (AC-1)
- Unit (frontend), **the revert must not lie either (WR-101) — a failed POST is ASKED about, not guessed**:
  - `usePauseState — live mode > KEEPS a Resume whose response was lost but which the server actually applied` (AC-4)
  - `usePauseState — live mode > falls back to undoing its own flip only when the authoritative re-GET also fails` (AC-4)
  - `usePauseState — live mode > a stale failure never clobbers a newer transition that happens to share its tier VALUE` (AC-4)
  - `usePauseState — live mode > reverts a Freeze the server REFUSED (the 409 rejection path), after ASKING what is true` (AC-1/AC-4)
- Unit (frontend), **WR-104 — the audit trail never shows a pause that did not stand**:
  - `usePauseState — live mode > emits a second steering_action marking the reverted transition, never a silent correction` (AC-7)
  - `usePauseState — live mode > an APPLIED transition stays exactly one event, tagged applied` (AC-7)
- Unit (frontend), **CR-002 — ENGINE PAUSED cannot outlive a failed kill-switch POST**:
  - `usePauseState — live mode > POSTs the reverted tier after a kill-switch failure, so the server does not keep the abandoned tier` (AC-3/AC-7)
  - `usePauseState — live mode > a failed revert POST does not ping-pong (no further revert, no further POST)` (AC-3)
  - `usePauseState — live mode > reverts the tier when the KILL-SWITCH POST fails, even though the pause-tier POST succeeded` (AC-3)
  - `usePauseState — live mode > does NOT revert a kill-switch failure once a newer transition has superseded it` (AC-3/AC-4)
  - `useEngineControl — kill switch > invokes the optional onRejected callback after reverting, so a composing caller can undo coupled state` (AC-3)
  - `useEngineControl — kill switch > never invokes onRejected when the live POST succeeds` (AC-3)
  - `useEngineControl — kill switch > a throwing onRejected can never break the kill switch's own revert` (AC-3)
- Unit (frontend), **the resync writes no safety action nobody performed** (COR-018/XC-004 accuracy):
  - `usePauseState — live mode > adopting the engine tier reflects the STOP locally with no autonomy telemetry and no kill-switch POST` (AC-7)
  - `engineControlStore.adoptServerMode > reflects a server-reported mode locally without emitting an autonomy event or POSTing` (AC-7)
  - `engineControlStore.adoptServerMode > is a no-op when the adopted mode already matches` / `adopts per exercise — never leaking into another exercise (COR-001)` (AC-7)
- Unit (frontend): entering/leaving the `engine` tier calls `useEngineControl().setMode('stop'|'live')`
  with the correct value; `<EngineControlBar>` and the tier pill read the same store snapshot.
  - `usePauseState — ENGINE PAUSED ... > entering the engine tier calls setMode('stop') — the tier pill and the control bar agree` (AC-3)
  - `usePauseState — ENGINE PAUSED ... > leaving the engine tier for Resume calls setMode('live')` (AC-3)
  - `usePauseState — ENGINE PAUSED ... > leaving the engine tier for Freeze keeps the engine STOPPED` (AC-3)
  - `usePauseState — ENGINE PAUSED ... > the injects and freeze tiers never touch the kill switch on their own` (AC-3)
  - `usePauseState — ENGINE PAUSED ... > engine -> freeze -> Resume restores the engine (never RUNNING over a stuck STOP)` (AC-3)
  - `usePauseState — ENGINE PAUSED ... > Resume restores a manually chosen SUGGEST-ONLY rather than raising to LIVE (§8.2)` (AC-3)
  - `usePauseState — ENGINE PAUSED ... > leaving the engine tier for Pause injects restores the engine` (AC-3)
- Unit (frontend): the Pause-injects control is disabled and inert (no `setTier('injects')` call
  reaches the store) and communicates its reason via an accessible name/description, not color
  alone (NFR-001).
  - `PausePill — Pause injects ships DISABLED and INERT > renders the tier but disables its radio` (AC-5)
  - `PausePill — Pause injects ships DISABLED and INERT > communicates its reason as TEXT in the accessible name + description, not colour alone (NFR-001)` (AC-5)
  - `PausePill — Pause injects ships DISABLED and INERT > takes NO action — clicking it never selects it and no setTier("injects") ever reaches the store` (AC-5)
  - `PausePill — Pause injects ships DISABLED and INERT > pre-selects the first SELECTABLE tier when running` (AC-5)
  - `PausePill — Pause injects ships DISABLED and INERT > keyboard activation cannot select it either` (AC-5, NFR-001)
- Regression: `USE_MOCK_DATA=true` — story 03's existing test suite passes unchanged.
  - `usePauseState — mock mode fires NO backend call (story 03 path unchanged)` (AC-6)
  - story 03's `usePauseState.test.tsx` clock/telemetry/tier blocks and `pausableExerciseClock.test.ts`
    pass untouched (AC-6). ONE story-03 `PausePill.test.tsx` case necessarily changed — the former
    "selecting Pause injects applies immediately" now asserts Pause **engine** applies immediately,
    because AC-5 deliberately disables the injects tier.
- **Manual/UAT (required for Complete).** With `VITE_USE_MOCK_DATA` off, against a live backend. A
  control's POSITION is NOT evidence — that is exactly the class of proof that let stories 02/03 ship
  as inert seams. Every step below is verified by ENGINE ACTIVITY (the review queue and/or `engine.*`
  telemetry), not by what the console renders:
  1. **Freeze before the engine is seeded** (the cold-clock case CR-001 was about): with a fresh
     backend process and no `POST /api/ops/seed-engine-content` yet, select Freeze. The POST must
     return `200` with `clockFrozen: true` (check the network tab) — not a `200` with
     `clockFrozen: false`, and not a `409`. Then seed the engine and confirm NO
     `engine.observed`/`decided`/`generated` telemetry and NO new review items appear: the loop's
     first tick must find the clock already frozen and skip.
  2. **Freeze while the engine is running:** with the loop ticking and items arriving, select Freeze.
     Confirm new review items STOP arriving and no `engine.generated` events are emitted while frozen.
  3. **Resume:** confirm ticking resumes, items arrive again, and the header SCENARIO clock continues
     from the minute it held (no jump forward by the frozen span, COR-050).
  4. **Pause engine:** confirm `<EngineControlBar>` shows STOP **and** that generation actually
     stopped (no new review items / no `engine.generated` while ENGINE PAUSED). Resume; confirm the
     bar returns to the position it was on before the pause (LIVE, or SUGGEST-ONLY if that is what the
     controller had chosen) **and** that generation resumes.
  5. **Failure honesty:** with dev-tools offline (or the backend stopped), select Freeze. The pill must
     fall back to RUNNING — it must never sit on WORLD FROZEN after a failed POST.
  6. **Pause injects:** confirm the tier is visibly disabled, reads "Unavailable — No inject queue
     yet", and cannot be applied by mouse or keyboard.
