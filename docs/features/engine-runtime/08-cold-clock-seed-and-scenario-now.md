# Story: A cold clock starts where the world is, and "scenario now" has one source  `[backend]`

**Feature:** engine-runtime  ·  **Epic:** E8  ·  **Phase:** 2  ·  **Stack:** backend  ·  **Status:** In Review
**Requirements:** COR-053, COR-050 (XC-004, COR-001)  ·  **Design decisions:** CLK-1, CLK-2 (Tom, 10/19), CLK-3 to CLK-5 (review folds)  ·  **Issue:** #654

## Context

There is no StartEx yet (COR-043/COR-050), so two paths start a **cold** exercise clock, and both start it at
wall-clock now:

- the engine content seed (`EngineContentSeedService`, `ScenarioStart = now`), which is how UAT goes live;
- the pause tier, when it freezes an exercise whose clock isn't running (`PauseTierEndpoints`,
  `CurrentScenarioTime ?? DateTimeOffset.UtcNow`).

`Exercise.CurrentScenarioTime` is a documented placeholder ("B2"). No production code writes it, so every reader
falls through to wall-clock now. About 38 services stamp telemetry scenario time as `CurrentScenarioTime ?? now`.
The exercise report and the post export read it as `StoredScenarioTime`.

For an exercise whose content carries real dates (the UAT Pilot) that is harmless. For one whose posts are dated,
say, 2033 (a scripted MSEL world), freezing or seeding jumps scenario time back to the real date. That breaks
COR-053's consistency: post order, the report's "now" and telemetry scenario time all disagree with the world.

The clock itself already survives a restart (`demo-feedback/18`, `ExerciseRuntimeState`). This story does not
change that, nor the engine-state work in [07](07-engine-state-survives-restart.md).

## Decisions

- **CLK-1 · A cold clock starts at the world's latest post.** Starting a clock that isn't running (the engine seed,
  or a freeze on a cold clock) uses the latest `CreatedScenarioTime` among the exercise's posts. With no posts, it
  uses wall-clock now. A fresh exercise behaves as today; a 2033 world continues from 2033. StartEx (COR-043) will
  replace this when it is built.
- **CLK-2 · "Scenario now" has one source; the placeholder is retired.** One resolver gives the exercise's scenario
  now: the running clock (live, or rehydrated by story 18), else the latest post's scenario time, else wall-clock
  now. Every reader of `Exercise.CurrentScenarioTime` / `ExerciseFacts.StoredScenarioTime` uses it instead. The
  column stays in the schema, unused and documented as retired, for a later migration to drop. Nothing writes
  it.
- **CLK-3 · One index serves the resolver (review W-1).** The resolver's post tier is one
  `MAX(CreatedScenarioTime) WHERE ExerciseId = @id`. A composite `Posts (ExerciseId, CreatedScenarioTime)` index
  makes it a single seek per exercise, so the story ships ONE migration, `EngineRuntimeScenarioNowPostIndex`, that
  only creates (Up) / drops (Down) that index. The single-column `ExerciseId` index stays: dropping it is not this
  story's change, and it remains the narrowest index for the per-exercise count/filter reads.
- **CLK-4 · The resolver's read has one shape (review S-1).** Always `IgnoreQueryFilters()` plus an explicit
  `ExerciseId == exerciseId` predicate. The predicate is the isolation guarantee; for a request scoped to that same
  exercise the central filter would add the identical predicate, so the result is the same on every path.
- **CLK-5 · No resolver work where the answer is known or the caller is unauthenticated (review W-2, S-2, S-3,
  S-6).** Staff login resolves scenario now once, only after the identity provider has answered, for both its
  failure and success events (no post read keyed by the body-supplied exercise id before authentication; a
  lockout-refused attempt, which never authenticates, stamps the wall clock). Creating an exercise (the create
  endpoint, a first bootstrap) stamps `now` (an unsaved exercise has no clock and no posts). The roster link-email
  batch resolves once per batch, not per recipient. The report's viewed event reuses the latest post the report
  already read (clock, else that post, else now) rather than querying again.

## Acceptance Criteria

- [x] The engine content seed starts the clock at the exercise's latest post's scenario time, else now.
- [x] A freeze on a cold clock starts it at the latest post's scenario time, else now. A running clock is never
      restarted or moved.
- [x] One scoped resolver (`IScenarioNow` or similar) returns clock → latest post → now for a given exercise. It
      reads posts only for that exercise id, by `IgnoreQueryFilters()` plus an explicit `ExerciseId` predicate on
      every path (CLK-4), never across exercises. It queries the database only when no clock is running, and that
      query is served by the `(ExerciseId, CreatedScenarioTime)` index (CLK-3).
- [x] No production code reads `Exercise.CurrentScenarioTime` or `ExerciseFacts.StoredScenarioTime`; every
      former reader uses the resolver. Today's behaviour is unchanged wherever the clock runs or the exercise has
      no posts.
- [x] The column is documented as retired (XML doc). The story's one migration,
      `EngineRuntimeScenarioNowPostIndex`, only creates / drops the `IX_Posts_ExerciseId_CreatedScenarioTime` index
      (CLK-3); the retired column is not touched.
- [x] Isolation (cross-exercise posts never inform another exercise's scenario now), telemetry envelopes and
      every existing suite unchanged.

## Out of Scope

StartEx / EndEx (COR-043, COR-054); time jumps (COR-051); dropping the column; client-supplied post scenario times.

## Tests

The resolver: clock wins; latest post when no clock; now when neither; another exercise's later post is ignored.
The seed and the freeze: a cold clock starts at the latest post (a 2033 world stays in 2033), or at now with no
posts; a running clock is untouched. Spot-check that two or three telemetry emitters (a login, a settings change,
the report) stamp the resolver's value. Static guard: a test fails if production code references
`CurrentScenarioTime` (the property) outside the entity and migrations (comment lines are not swept).

**Linked tests** (`src/Pulse.WebApi.Tests`):

- AC-1 (seed): `EngineContentSeedServiceTests.Seed_ColdClock_StartsAtTheLatestPost_A2033WorldStaysIn2033`,
  `EngineContentSeedServiceTests.Seed_ColdClock_NoPosts_StartsAtWallClockNow_AsBefore`,
  `EngineContentSeedServiceTests.Seed_RunningClock_IsNeverRestartedOrMoved`.
- AC-2 (freeze): `PauseTierEndpointsTests.Post_Freeze_OnAColdClock_StartsItAtTheLatestPost_A2033WorldStaysIn2033`,
  `PauseTierEndpointsTests.Post_Freeze_OnAColdClock_WithNoPosts_StartsItAtWallClockNow`,
  `PauseTierEndpointsTests.Post_Freeze_OnARunningClock_NeverRestartsOrMovesIt`.
- AC-3 (resolver): `ScenarioNowResolverTests.RunningClock_Wins_OverALaterPost`,
  `ScenarioNowResolverTests.RunningClock_AnswersWithoutTouchingTheDatabase`,
  `ScenarioNowResolverTests.NoClock_ReturnsTheExercisesLatestPost_IncludingATakenDownOne`,
  `ScenarioNowResolverTests.NoClock_NoPosts_ReturnsTheCallersWallClock_AndFindReturnsNull`,
  `StaffLoginServiceTests.Login_WrongSecret_FailureEventScenarioTime_IsResolvedOnlyAfterAuthentication` (CLK-5).
- AC-4 (no reader; telemetry spot checks): `RetiredScenarioTimeSourceGuardTests.NoProductionCode_ReadsTheRetiredScenarioTimePlaceholder`
  (+ its two self-tests), `ParticipantLoginServiceTests.Login_Success_IssuesParticipantSession_EmitsSuccessTelemetry_RecordsLastLogin`,
  `ExerciseSettingsServiceTests.UpdateAsync_StampsTheExercisesScenarioNow_TheRunningClock_ElseTheLatestPost_ElseNow`,
  `ExerciseLifecycleServiceTests.TransitionAsync_StampsTheExercisesScenarioNow_ItsLatestPost_RatherThanTheServerClock`,
  `ExerciseReportScopeEndpointTests.ViewedEvent_StampsTheScenarioNowResolver_TheLatestPost_WithNoClock`,
  `ExerciseReportScopeEndpointTests.ScenarioNow_IsTheRunningClock_OrTheLatestPostWhenLater_InTheExerciseZone`,
  `EasyLoginTelemetryTests.EventTime_StampsTheScenarioNowResolver_ElseTheWallClock`.
- AC-5 (retired; the index migration): the entity XML doc; `MigrationRoundTripTests` unchanged (column still
  mapped); `ScenarioNowPostIndexMigrationTests.TheMigration_IsTheStorysOnlyOne_DirectlyAfterAdminIdentityFoundation`,
  `ScenarioNowPostIndexMigrationTests.Post_HasTheExerciseIdThenCreatedScenarioTimeIndex_AndKeepsTheExerciseIdIndex`,
  `ScenarioNowPostIndexMigrationTests.Up_CreatesOnlyTheIndex_AndDown_DropsOnlyIt`; the deploy-script replay in
  `IdempotentMigrationScriptTests`.
- AC-6 (isolation): `ScenarioNowResolverTests.AnotherExercisesLaterPost_NeverInformsThisExercisesScenarioNow_ScopedOrByExplicitId`,
  plus the other-exercise later post in the seed, freeze, settings, lifecycle and report tests above;
  `OrganizationScopeSweepTests` (ResolvedScope inventory 27 → 26).
