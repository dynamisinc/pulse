# Story: Pause tier, exercise clock and holding page survive a restart

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** In Review
**Requirements:** COR-053, world-steering Freeze (#350/#351), #526 (restart resilience slice)  ·  **Decisions:** DF-24..DF-28  ·  **Issue:** #536
**Stack:** backend  ·  **World:** foundation  ·  **Review:** Tier-1 (+ Tom reads the reset route)  ·  **Priority:** Must  ·  **Wave:** 4  ·  **Effort:** M
**Owner:** planning session · **Branch:** `build/demo-feedback/18-persist-tier-clock` → `feature/demo-feedback-w4`

## Context

`PauseTierRegistry` (`ConcurrentDictionary<Guid, PauseTier>`), `ExerciseClockService`
(`ConcurrentDictionary<Guid, ExerciseClockState>`) and `OverlayStateService` hold their state only in memory. A deploy
or restart puts every exercise back to Running with an unstarted clock (the next `ReactionLoopHost` tick restarts it
from the in-memory registration's `ScenarioStart`), and participants lose the holding page. On 10/15 that left UAT
**LIVE (suggest) with ~37 drafts**. Customer note (#526): *"Stability!"*. Tom 10/15: a running clock keeps advancing
through downtime; the tier comes back exactly as set.

## Acceptance Criteria

### Persist (write-through)

- [x] New `Features/EngineRuntime/Persistence/IExerciseRuntimeStateStore` + EF implementation (scoped `DbContext`
      through `IServiceScopeFactory`, since the registry and clock are singletons). `UpsertAsync` writes the full row;
      `DeleteAsync` removes it.
- [x] `PauseTierRegistry.SetTierAsync` writes the tier, clock and overlay snapshot **after** the in-memory apply and
      **outside** its lock, awaited. `Unchanged` and refused outcomes write nothing. A failed write is logged at Error
      and the response carries `persisted: false` (never rolls the tier back, never throws to the caller).
- [x] `ExerciseClockService` `Start`, `Freeze`, `Unfreeze` and `Jump` persist the anchor: `ClockScenarioStart`,
      `ClockTimeZone` (IANA/Windows id as `TimeZoneInfo.Id`), `ClockElapsedAtAnchorTicks`, `ClockWallAnchorUtc` (from
      `TimeProvider.GetUtcNow()`, never `GetTimestamp()`), `ClockFrozen`. The clock API stays synchronous for its
      readers; persistence is a fire-and-observe write (queued, logged on failure), so `CurrentScenarioMinute` never
      waits on SQL.
- [x] The overlay publisher persists `OverlayState`, `OverlayRegister`, `OverlayMessage` and `OverlaySequence` with
      each published snapshot.

### Restore (startup)

- [x] New hosted service `ExerciseRuntimeStateRehydrator` runs in `StartAsync` **before any other hosted service
      ticks** (registered first by seam S-5): reads every row (cross-exercise reader, `WhiteNoisePacer` pattern) and
      restores each exercise:
      - tier exactly as persisted (DF-26);
      - clock: running ⇒ `elapsed = elapsedAtAnchor + (utcNow − wallAnchorUtc)`; frozen ⇒ `elapsedAtAnchor` (DF-25),
        through a new `IExerciseClock.Restore(...)` (or an internal equivalent) that does not count as `Start`;
      - overlay snapshot and sequence, with the next sequence = persisted + 1 (DF-27), so `GET /api/overlay-state`
        returns the holding page after a restart while frozen.
- [x] A row for an exercise that no longer exists, or one that fails to parse, is logged and skipped; startup never
      fails because of runtime state.
- [x] `ReactionLoopHost` does not restart a restored clock (`ShouldStartClock` already returns false for running or
      frozen; a test proves the restored scenario minute survives the first tick).
- [x] A restored Freeze still blocks what Freeze blocks today: inject fire (`InjectQueueService.FrozenMessage`),
      noise (DF-13), engine ticks.

### Reset (DF-28)

- [x] `POST /api/steering/runtime-state/reset` (controller only; staff + controller filters as `POST
      /api/steering/pause-tier`): sets tier Running, clears the clock (unstarted), publishes overlay `none` with the next
      sequence, deletes the row, emits `steering.runtime_reset`, returns `PauseTierStateDto`. Exercise-scoped: it never
      touches another exercise. Idempotent.
- [x] `docs/features/world-steering/` notes and the `PauseTierRegistry` XML docs no longer say "an App Service
      restart clears the tiers".

### From the 10/15 reviews (story 17 Gate-1, PR #548 Copilot)

- [x] `GET /api/steering/runtime-state/reset` answers **405** (the route is POST-only), with a test: story 27's
      `Test-FreezeResume.ps1` detects story 18 by that 405 (404 = pre-18).
- [x] The reset's hard delete of the `ExerciseRuntimeStates` row is documented as deliberate: machine state, not
      in-fiction content or AAR evidence, so XC-010 retention does not apply (17 Gate-1 L-2).
- [x] The rehydrator's cross-exercise read uses the single documented `IgnoreQueryFilters` reader and is read-only;
      all writes go through the scoped path (17 Gate-1 L-4). The all-null-or-all-set clock rule is enforced in code
      (17 Gate-1 L-3).

### Cross-cutting

- [x] Isolation: restore and reset for exercise A never change B (test with two exercises).
- [x] Telemetry: tier changes keep their existing events; the reset adds one.

## Out of Scope

Persisting engine loop registrations, storylines, autonomy level or the kill switch (`Reset-DemoState` still re-seeds
the loop). Multi-instance coordination (UAT is one B1 instance; the row is last-writer-wins). Frontend: none needed,
because the console already reads the tier from `GET /api/steering/pause-tier` after a restart; a warning chip for
`persisted: false` is a post-demo follow-up.

## Technical Notes

`Features/EngineRuntime/Clock/ExerciseClockService.cs` (`ExerciseClockState` :94: `_scenarioElapsedAtAnchor`,
`_wallAnchor` monotonic, `_frozen`); `Steering/PauseTierRegistry.cs` (`SetTierAsync` :234, `TryApplyClockEffect`
~:360, Freeze starts the clock with `PauseClockStart` at :390); `Steering/PauseOverlayPublisher.cs` (`OverlayStateService`
:114, `OverlayStateChanged` :103); `PauseTierEndpoints.cs` (:102-103). Use `FakeTimeProvider` in tests to move wall
time across a simulated restart (new service instances over the same database).

## Dependencies

17 (schema). Seam S-5 registers the rehydrator first and maps the reset route. 26 calls the reset route.

## Tests

All under `src/Pulse.WebApi.Tests/Features/EngineRuntime/Persistence/` (Docker-gated SQL tests are `[RequiresDockerFact]`).

- **Persist (write-through)**
  - `RuntimePersistenceCompositionTests.AddExerciseRuntimePersistence_ReplacesTheNoOpDefaults_InEitherOrder` (AC-1: store + scoped writes via `IServiceScopeFactory`)
  - `ExerciseRuntimeStateRestartTests.EveryAppliedTierChange_IsWrittenThrough_AndUnchangedWritesNothing` (AC-1, AC-2, AC-4)
  - `PauseTierWriteThroughTests.Applied_WritesThroughOnce_AfterTheInMemoryApply_AndOutsideTheLock` (AC-2)
  - `PauseTierWriteThroughTests.EveryTierChange_WritesThrough` / `Unchanged_WritesNothing` / `Refused_WritesNothing` (AC-2)
  - `PauseTierWriteThroughTests.AFailedWrite_ReportsPersistedFalse_LogsAtError_AndKeepsTheTier` (AC-2)
  - `RuntimeStateResetEndpointTests.PauseTierPost_WritesThrough_AndReportsPersistedTrue` / `PauseTierPost_WhenTheWriteFails_Is200_PersistedFalse_AndTheTierStands` (AC-2, over HTTP)
  - `ExerciseClockPersistenceTests.StartFreezeUnfreezeJump_EachTellTheSink_AfterTheApply` / `Reads_NeverTellTheSink` / `GetAnchor_CarriesAUtcWallAnchor_FromGetUtcNow_NeverAMonotonicTimestamp` (AC-3)
  - `ExerciseRuntimeStateRestartTests.ClockOnlyChanges_AreWrittenThroughByTheQueue_WithAUtcWallAnchor` (AC-3)
  - `PauseTierWriteThroughTests.TheWriter_ComposesTheWholeRow_TierClockAndPublishedOverlay` (AC-4)
- **Restore (startup)**
  - `ExerciseRuntimeStateRestartTests.Restart_RestoresTheEngineTier_AndARunningClock_TenMinutesFurtherOn` (AC-5, DF-25/26)
  - `ExerciseRuntimeStateRestartTests.Restart_DuringFreeze_RestoresTheFrozenMinute_TheHoldingPage_AndTheNextSequenceIsHigher` (AC-5, DF-27; AC-8 noise)
  - `RuntimeStateResetEndpointTests.ARestartedHost_BringsTheFreezeAndTheHoldingPageBack_OnStartup` (AC-5 end to end: `GET /api/overlay-state` after a restart)
  - `ExerciseClockPersistenceTests.Restore_Running_AdvancesByTheDowntime_DF25` / `Restore_Frozen_HoldsTheBankedMinute_DF25` / `Restore_WithAWallAnchorInTheFuture_NeverMovesScenarioTimeBackwards` (AC-5)
  - `OverlayStateServiceRestoreTests.*` (AC-5, DF-27)
  - `ExerciseRuntimeStateRehydratorTests.Restores_TierClockAndOverlay_PerExercise_WithoutTouchingAnother` (AC-5)
  - `ExerciseRuntimeStateRehydratorTests.ARowForAMissingExercise_IsLoggedAndSkipped` / `AnUnparseableRow_IsLoggedAndSkipped_AndTheOthersAreRestored` / `AnUnreadableTable_NeverFailsStartup` (AC-6)
  - `ExerciseRuntimeStateRestartTests.Rehydrate_SkipsAnUnparseableRow_AndStillRestoresTheOthers` (AC-6, real SQL)
  - `ExerciseClockPersistenceTests.Restore_IsNotAStart_SoTheReactionLoopLeavesTheClockAlone` (AC-7)
  - `ExerciseRuntimeStateRestartTests.Restart_ThenTheReactionLoopsFirstTick_KeepsTheRestoredMinute_AndARestoredFreezeStaysHalted` (AC-7; AC-8 engine ticks)
  - `RestoredFreezeBlocksInjectsTests.Fire_UnderARestoredFreeze_Is409_TheWorldIsFrozen` (AC-8 inject fire)
  - `RuntimePersistenceCompositionTests.CalledBeforeTheTickingHosts_TheRehydratorIsTheFirstHostedService` (AC-5 ordering via the S-5 placement)
- **Reset (DF-28)**
  - `RuntimeStateResetEndpointTests.ResetRoute_IsMappedExactlyOnce_AsAPost` / `Post_NoStaffSession_Is401_AndResetsNothing` / `Post_UnresolvedScope_Is401` / `Post_AsEvaluator_Is403_AndResetsNothing` (AC-9 filters)
  - `RuntimeStateResetEndpointTests.Post_AfterAFreeze_ResetsTierClockAndOverlay_DeletesTheRow_AndEmitsOneEvent` (AC-9, AC-14 telemetry)
  - `RuntimeStateResetEndpointTests.Post_IsIdempotent` (AC-9)
  - `ExerciseRuntimeStateRestartTests.AfterARuntimeReset_TheNextLoopTick_StartsTheClockAgain_SoNoiseCanRun` (AC-9 follow-through: `ReactionLoopHost.EnsureClockStarted` now relies on `ShouldStartClock` alone, with no per-host started-clock memo, so a reset clock restarts on the next tick without an App Service restart)
  - `ExerciseRuntimeStateRestartTests.TheLoop_NeverStartsAFrozenClock_NorRestartsARunningOne_AcrossManyTicks` (AC-7 with the memo removed)
  - `ExerciseClockPersistenceTests.Clear_LeavesTheClockUnstarted_AndOnlyThatExercise` (AC-9)
- **From the 10/15 reviews**
  - `RuntimeStateResetEndpointTests.Get_OnTheResetRoute_Answers405` (AC-11)
  - Hard delete documented on `IExerciseRuntimeStateStore.DeleteAsync` / `RuntimeStateResetService` (AC-12)
  - `ExerciseRuntimeStateRehydratorTests.Restoring_WritesNothing` (AC-13 read-only reader); `ExerciseRuntimeStateMappingTests.*` (AC-13 all-null-or-all-set clock rule, L-3)
- **Cross-cutting**
  - `RuntimeStateResetEndpointTests.Post_ResetsOnlyTheResolvedExercise`, `ExerciseRuntimeStateRestartTests.Restart_RestoresEachExercise_OnlyFromItsOwnRow`, `OverlayStateServiceRestoreTests.Restore_ForA_NeverTouchesB` (isolation)
- **Gate-1 fixes (CR-1 serverless resume, M-1, M-2, L-3)** — `TransientRetryTests`:
  - `TheTransientSqlErrors_AreRecognised_EvenWrapped` / `NonTransientFailures_AreNotRetried` (the 40613-family classifier)
  - `Rehydrator_RetriesTwo40613s_ThenRestoresTheFreeze` / `Rehydrator_ANonTransientFailure_FailsFast_WithNoRetry` / `Rehydrator_GivesUp_WhenTheBudgetRunsOut_AndSaysSo` / `Rehydrator_WithAZeroBudget_DoesNotRetry` (budget `EngineRuntime:Persistence:RehydrateRetryBudgetSeconds`, default 90)
  - `Writer_RetriesATransientFailure_AndReportsPersisted` / `Writer_DoesNotRetryANonTransientFailure` / `Writer_GivesUpAfterTheConfiguredAttempts` / `TheResetDelete_RetriesATransientFailure` (the clock queue writes through the same writer)
  - `ACancelledRequest_StillPersistsTheAppliedChange_M1`
  - `Rehydrator_AFrozenClockUnderANonFreezeTier_RestoresFailSafeAsFreeze` (M-2)
  - L-3: the reset does the in-memory reset first; staff and exercise-facts reads are best-effort with the existing fallbacks
- **Waiting on seam S-5 (skipped until `Program.cs` is wired):** `RuntimePersistenceCompositionTests.ProgramCs_RegistersTheRehydrator_BeforeEveryTickingHostedService`, `RuntimePersistenceCompositionTests.ProgramCs_MapsTheRuntimeResetRoute_ExactlyOnce`.
