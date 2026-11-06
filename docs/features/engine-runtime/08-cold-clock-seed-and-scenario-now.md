# Story: A cold clock starts where the world is, and "scenario now" has one source  `[backend]`

**Feature:** engine-runtime  ·  **Epic:** E8  ·  **Phase:** 2  ·  **Stack:** backend  ·  **Status:** In Review
**Requirements:** COR-053, COR-050 (XC-004, COR-001)  ·  **Design decisions:** CLK-1, CLK-2 (Tom, 10/19), CLK-3 to CLK-5 (review folds)  ·  **Issue:** #654

> **Currency (2026-11-06).** Rebuilt on that day's `main` as a fresh branch (`fix/scenario-clock-seed-v2`), superseding
> PR #655, whose branch had drifted ~22 semantic conflicts behind main. The design (CLK-1 to CLK-5) is unchanged. The
> reader sweep was re-run against main and now also covers the readers main gained after 10/19: the channels content
> publish funnel (`ContentPublishService.ClockAsync`), the alert source (`AlertReader.ReadTimeAsync`, which also gates
> scenario-time expiry), outlets (`OutletService`), weather zones (`WeatherZoneService`), the go-live readiness
> opening-feed check (`ExerciseReadinessService`), and the steering-lever recorder (`EngineSteeringLeverRecorder`,
> #618). The index migration was regenerated as `20261106151929_EngineRuntimeScenarioNowPostIndex`.
>
> **Migration order (merge of `main`, 2026-11-06).** A3 (`20261030173000_A3SetupContentParticipantName`) is now on
> `main` and applied to UAT; this PR's migration sorts directly after it. The model snapshot was merged textually and
> this migration's Designer re-scaffolded over the merged model (`docs/OPERATE.md` A3 step 3, applied to this
> migration): the throwaway migration's `Up()`/`Down()` were empty and `has-pending-model-changes` reports none.
> A2 (`20261106153923_A2CredentialFoundation`) is still with the A2 session and sorts AFTER this PR, so whichever of
> this PR and A2 merges second re-merges the snapshot textually and re-scaffolds its own Designer the same way. The
> same merge rewired two more readers `main` had gained to `IScenarioNow`: the org newsroom provisioner
> (`OrgNewsroomProvisioner.TimeForAsync`, press-room 01) and the staff content service's schedule / preview clock
> (`StaffContentService.ScenarioNowAsync`, channels-foundation).

## Context

There is no StartEx yet (COR-043/COR-050), so two paths start a **cold** exercise clock, and both start it at
wall-clock now:

- the engine content seed (`EngineContentSeedService`, `ScenarioStart = now`), which is how UAT goes live;
- the pause tier, when it freezes an exercise whose clock isn't running (`PauseTierEndpoints`,
  `CurrentScenarioTime ?? DateTimeOffset.UtcNow`).

`Exercise.CurrentScenarioTime` is a documented placeholder ("B2"). No production code writes it, so every reader
falls through to wall-clock now. About 45 services stamp telemetry scenario time as `CurrentScenarioTime ?? now`
(or `clock ?? CurrentScenarioTime ?? now`). The exercise report, the post export, outlets and weather read it as
`ExerciseFacts.StoredScenarioTime`.

For an exercise whose content carries real dates (the UAT Pilot) that is harmless. For one whose posts are dated,
say, 2033 (a scripted MSEL world), freezing or seeding jumps scenario time back to the real date. That breaks
COR-053's consistency: post order, the report's "now" and telemetry scenario time all disagree with the world.

The clock itself already survives a restart (`demo-feedback/18`, `ExerciseRuntimeState`). This story does not
change that, nor the engine-state work in [07](07-engine-state-survives-restart.md).

## Decisions

- **CLK-1 · A cold clock starts at the world's latest post.** Starting a clock that isn't running (the engine seed,
  or a freeze on a cold clock) uses the latest `CreatedScenarioTime` among the exercise's non-participant posts
  (CLK-6). With no such posts, it uses wall-clock now. A fresh exercise behaves as today; a 2033 world continues from 2033. StartEx (COR-043) will
  replace this when it is built.
- **CLK-2 · "Scenario now" has one source; the placeholder is retired.** One resolver gives the exercise's scenario
  now: the running clock (live, or rehydrated by story 18), else the world's latest NON-participant post's scenario
  time (CLK-6), else wall-clock now. Every reader of `Exercise.CurrentScenarioTime` / `ExerciseFacts.StoredScenarioTime` uses it instead. The
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
- **CLK-6 · A client can never set the world's time (review CR-001, 2026-11-06).** With no clock running, a
  participant's post keeps its client-supplied scenario time (the frontend mock clock sends its wall `new Date()`).
  Three guards keep that value from becoming the exercise's clock epoch:
  1. The resolver's post tier counts only non-participant posts (`Origin != participant`, the shared
     `ChannelVocabulary.OriginParticipant`): controller-as-persona, engine, inject and noise posts say where the world
     is; a participant's post never moves the seed start, a cold freeze's start or a cold stamp.
  2. `PostIngestService` refuses a `scenarioTime` more than 100 years either side of the server's now with a 400
     (`scenarioTime must be within 100 years of the current date.`), for every origin and clock state, exactly as it
     already refuses an unparseable one. 100 years admits any exercise world in use (2026 to 2033 in tests and seeds)
     and keeps every stored instant thousands of years inside the `DateTimeOffset` range.
  3. `ExerciseClockService` refuses, with `ArgumentOutOfRangeException`, a `Start` or `Restore` outside year 2 to
     9000, a restored anchor whose elapsed would pass year 9000, and a `Jump` past it. The failure happens once, at
     the call, with the clock unchanged (the rehydrator logs and skips that one row), never on every read.
- **CLK-7 · Alert expiry runs only on a started clock (review W-3, 2026-11-06).** The alert source stamps issue and
  clear times from the resolver, but it decides EXPIRY (the 5 s sweep and the active read) only when the exercise's
  clock is started (running or frozen), the pre-08 rule. A cold clock's latest-post instant does not advance, so
  expiring against it would hand an irreversible decision to whichever post landed last.

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

StartEx / EndEx (COR-043, COR-054); time jumps (COR-051); dropping the column. Client-supplied post scenario times
stay accepted on a cold clock (only bounded and excluded from the resolver, CLK-6); replacing them with a server
time is not this story's change.

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
  `ScenarioNowResolverModelTests.RunningClock_AnswersWithoutTouchingTheDatabase`,
  `ScenarioNowResolverTests.NoClock_ReturnsTheExercisesLatestPost_IncludingATakenDownOne`,
  `ScenarioNowResolverTests.NoClock_NoPosts_ReturnsTheCallersWallClock_AndFindReturnsNull`,
  `StaffLoginServiceTests.Login_WrongSecret_FailureEventScenarioTime_IsResolvedOnlyAfterAuthentication` (CLK-5).
- CLK-6 (review CR-001): `ScenarioNowResolverModelTests.NoClock_IgnoresParticipantPosts_EvenALaterOrAnOverflowingOne`,
  `ScenarioNowResolverTests.NoClock_IgnoresParticipantPosts_EvenALaterOne_AndAParticipantOnlyWorldFallsToTheWallClock`,
  `PostIngestServerClockTests.OnAColdClock_AParticipantPostDatedLaterThanTheWorld_NeverMovesTheScenarioNow_OrTheClockStartedFromIt`,
  `PostIngestServerClockTests.AnOverflowingScenarioTime_IsRefusedAt400_AndNothingIsWritten`,
  `PostIngestServerClockTests.TheScenarioTimeWindow_IsAHundredYearsEitherSideOfTheServersNow_AndOverflowSafe`,
  `ExerciseClockServiceTests.Start_RefusesAnInstantNearTheEdgesOfTheRange_AndLeavesTheClockUnstarted`,
  `ExerciseClockServiceTests.Start_AtTheBounds_IsAccepted_AndReadsKeepWorkingAsWallTimePasses`,
  `ExerciseClockServiceTests.Jump_PastTheCeiling_IsRefused_AndTheClockIsUnchanged`,
  `ExerciseClockServiceTests.Restore_RefusesAPoisonedAnchor_SoTheRehydratorSkipsThatRowInsteadOfEveryReadFailing`;
  the seed and freeze cold-clock tests above also seed a later participant post (and, for the freeze, a 9999 one)
  that must not move the start; `ExerciseReportScopeEndpointTests.ViewedEvent_StampsTheScenarioNowResolver_TheLatestPost_WithNoClock`
  seeds a later participant post that must not move the stamp.
- CLK-7 (review W-3): `AlertServiceTests.Sweep_NeverExpiresAgainstTheWallClock_WhenNoScenarioTimeIsKnown`,
  `AlertEndpointsTests.Active_IsOrderedBySeverityThenNewest_AndDropsExpiredOnScenarioTime_OnRealSql` (a later post on a
  cold clock expires nothing; starting the clock does), `AlertEndpointsTests.Sweep_ExpiresEachExerciseInItsOwnScope_OnRealSql`
  (expires on started clocks).
- AC-4 (no reader; telemetry spot checks): `RetiredScenarioTimeSourceGuardTests.NoProductionCode_ReadsTheRetiredScenarioTimePlaceholder`
  (+ its two self-tests), `ParticipantLoginServiceTests.Login_Success_IssuesParticipantSession_EmitsSuccessTelemetry_RecordsLastLogin`,
  `ExerciseSettingsServiceTests.UpdateAsync_StampsTheExercisesScenarioNow_TheRunningClock_ElseTheLatestPost_ElseNow`,
  `ExerciseLifecycleServiceTests.TransitionAsync_StampsTheExercisesScenarioNow_ItsLatestPost_RatherThanTheServerClock`,
  `ExerciseReportScopeEndpointTests.ViewedEvent_StampsTheScenarioNowResolver_TheLatestPost_WithNoClock`,
  `ExerciseReportScopeEndpointTests.ScenarioNow_IsTheRunningClock_OrTheLatestPostWhenLater_InTheExerciseZone`,
  `EasyLoginTelemetryTests.EventTime_StampsTheScenarioNowResolver_ElseTheWallClock`.
- AC-5 (retired; the index migration): the entity XML doc; `MigrationRoundTripTests` unchanged (column still
  mapped); `ScenarioNowPostIndexMigrationTests.TheMigration_IsTheStorysOnlyOne_AppliedAfterA3`,
  `ScenarioNowPostIndexMigrationTests.Post_HasTheExerciseIdThenCreatedScenarioTimeIndex_AndKeepsTheExerciseIdIndex`,
  `ScenarioNowPostIndexMigrationTests.Up_CreatesOnlyTheIndex_AndDown_DropsOnlyIt`; the deploy-script replay in
  `IdempotentMigrationScriptTests`.
- AC-6 (isolation): `ScenarioNowResolverTests.AnotherExercisesLaterPost_NeverInformsThisExercisesScenarioNow_ScopedOrByExplicitId`,
  plus the other-exercise later post in the seed, freeze, settings, lifecycle and report tests above;
  `OrganizationScopeSweepTests` (ResolvedScope inventory 34 → 33 on the 2026-11-06 rebuild: the media upload no longer
  reads the exercise row; 34 after merging `main`, whose idle-db-autopause pacer sweep added one).
- Readers added on main after 10/19 (2026-11-06 rebuild):
  `ContentPublishServiceTests.WithNoStartedClock_TheExercisesLatestPost_IsTheFallback_ThenNow` (the content funnel),
  `AlertEndpointsTests` (issue/clear stamps come from the resolver; expiry runs only on a started clock, CLK-7, and
  never on the wall clock), `ExerciseReadinessServiceTests.OpeningFeed_ComparesAgainstTheScenarioStart_NotTheRealWorldScheduledStart`
  and `ExerciseReadinessServiceTests.OpeningFeed_CountsAnyLiveTopLevelPost_WhenNoClockRuns` (the opening-feed bound is
  the running clock, else the latest post), and the weather-zone harness (a resolver over its stub clock).
- Readers `main` gained before the 2026-11-06 merge: `OrgNewsroomProvisionerTests` and `StaffContentServiceTests`
  (both through the funnel harness, which composes the real `ScenarioNowResolver`), and the
  `RetiredScenarioTimeSourceGuardTests` sweep (both read the removed `ExerciseFacts.StoredScenarioTime`, so the merged
  build did not compile until they were rewired).

## Known limitations / open questions (for Tom)

The 2026-11-06 adversarial review raised both of these. Neither is changed here.

- **W-1 · Cold-clock stamps no longer advance.** With no clock running, `ScenarioNowResolver.FindAsync` /
  `GetAsync` (`src/Pulse.WebApi/Features/EngineRuntime/Clock/ScenarioNowResolver.cs:56-81`) return the same
  `MAX(CreatedScenarioTime)` of the world's non-participant posts until another such post lands. Every cold-clock
  telemetry stamp taken in that interval therefore carries the SAME scenario instant: logins, settings changes,
  lifecycle transitions, report views, alert issue/clear stamps. Before this story each carried its own wall-clock
  now, so the stamps advanced. Scenario: a seeded 2033 world sits in Staged for an hour of familiarisation with no
  clock started. Every participant login, roster change and settings save in that hour is stamped 2033-06-14 09:00
  (the last seeded post). Only wall-clock time keeps the order inside that hour. Since CLK-6, participant posts
  no longer advance it either. Open question: is a frozen cold stamp acceptable until StartEx, or should a cold clock
  add the wall time elapsed since the latest post?
- **W-2 · After a DF-28 runtime reset the reaction loop restarts the clock at the seed-time start.**
  `PauseTierRegistry.ResetAsync` clears the clock (`src/Pulse.WebApi/Features/EngineRuntime/Steering/PauseTierRegistry.cs:409`).
  On its next tick, `ReactionLoopHost.EnsureClockStarted`
  (`src/Pulse.WebApi/Features/EngineRuntime/ReactionLoopHost.cs:142`, `:209-213`) starts it again at
  `registration.ScenarioStart`. `EngineContentSeedService` captured that value ONCE from `IScenarioNow` at seed time
  (`src/Pulse.WebApi/Features/Ops/EngineContentSeed/EngineContentSeedService.cs:194`, stored at `:282`). Scenario: a
  world seeded at 2033-06-14 09:00 runs for three hours (posts up to 12:00), then the controller resets the runtime.
  The clock restarts at 09:00, so new posts are stamped three scenario hours BEFORE posts already in the feed, and
  the newest-first order inverts. Before this story the restart used the seed-time wall clock, which was just as
  stale, so the problem is not new. Open question: should the loop restart a cleared clock at `IScenarioNow`
  (where the world is now) rather than at the registration's seed-time start? That needs a scoped resolver from the
  singleton host.
