# Story: Wave 4 foundation: one migration and the frozen contract

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** In Review
**Requirements:** COR-053, NFR-008 (restart resilience, #526 slice), D1 parity  ·  **Decisions:** DF-24..DF-27, DF-29..DF-33  ·  **Issue:** #535
**Stack:** backend  ·  **World:** foundation  ·  **Review:** **Tier-2 (schema)**  ·  **Priority:** Must  ·  **Wave:** 4  ·  **Effort:** S
**Owner:** planning session · **Branch:** `build/demo-feedback/17-wave4-foundation` → `feature/demo-feedback-w4`

## Context

Wave 4 needs two pieces of schema: a per-exercise runtime-state row so the pause tier, clock and holding page survive
an App Service restart (18), and edit tracking on posts (19). [`WAVE-4.md`](WAVE-4.md#schema-story-17-one-migration-demofeedbackwave4runtimeandedits)
freezes both in **one migration**. This story lands the entities, the migration and the contract stubs so 18, 19 and
20 build in parallel against fixed shapes.

## Acceptance Criteria

- [x] New entity `Data/Entities/ExerciseRuntimeState.cs` exactly as the WAVE-4 schema table: `ExerciseId` is the
      primary key and an FK to `Exercises` (restrict, XC-010), implements `IExerciseScoped`, `PauseTier` defaults to
      `running`, `OverlayState` to `none`, `OverlaySequence` to 0, `ClockFrozen` to false. XML docs state that clock
      columns are all null (unstarted) or all set, and that the wall anchor is UTC.
- [x] New entity `Data/Entities/PostEdit.cs`: `Id`, `ExerciseId` (`IExerciseScoped`), `PostId` (FK restrict),
      `EditNumber` (1..5), `PreviousBody` (same max length as `Post.Body`: `nvarchar(max)`), `EditedAt`, `EditedScenarioTime`,
      `ActingHumanId` (same type as `Post.ActingHumanId`, nullable). Unique index (`PostId`, `EditNumber`).
- [x] `Post` gains `EditCount` (int, default 0), `LastEditedAt` and `LastEditedScenarioTime` (nullable
      `DateTimeOffset`). `LastEditedAt` is documented as staff/export only (XC-002: never projected to a participant).
- [x] `PulseDbContext` registers both sets; both are covered by the central exercise query filter and the write guard
      (a test saves a row with no resolved scope, `ExerciseId = Guid.Empty`, and the guard refuses it and persists
      nothing; a read under exercise A never sees B's rows, by list, by id (IDOR) or by aggregate, and an unset scope
      sees zero rows).
- [x] **ONE migration `DemoFeedbackWave4RuntimeAndEdits`** + snapshot. It applies cleanly through the idempotent
      script (`dotnet ef migrations script --idempotent`) on top of `20261014202342_DemoFeedbackPinsNoiseImport`, and
      on a database that already has data (existing posts get `EditCount = 0`).
- [x] Contract stubs compile and are referenced by nothing yet: `Features/Social/Editing/PostEditDtos.cs`
      (`EditPostRequest { text }`, `PostEditHistoryDto`, `PostEditedDto`, `PostEditedSummaryDto { count, scenarioTime }`),
      `PauseTierStateDto` gains `persisted` (default `true` until 18 wires it). camelCase on the wire.
- [x] No behaviour change: every existing backend test passes, including the XC-010 no-cascade invariants
      (`DemoPolishSchemaModelTests`, `DemoPolishMigrationTests`), unchanged.

## Out of Scope

Any service, route or hosted service (18, 19). Frontend. `Program.cs` (seam S-5).

## Technical Notes

- Match the style of `20261014202342_DemoFeedbackPinsNoiseImport` (one migration for a wave). Merge into the
  integration branch with a **real merge**, never a squash, so later branches carry the same migration file.
- `Exercise.cs` is not touched (22 copies its columns for duplicate; keeping runtime state off the entity also keeps
  duplicate from copying a Freeze).

## Dependencies

None. Blocks 18 and 19. 20 builds on the contract in WAVE-4.md against mocks.

## Tests

`src/Pulse.WebApi.Tests/Data/`: entity configuration (defaults, max lengths, unique index), isolation (read filter +
write guard for both new sets), migration applies on an empty database and on one seeded with posts (localdb via
`PULSE_TEST_SQL_CONNECTION`).

**Linked (story 17 build):**

- `Wave4FoundationMigrationTests.ExerciseRuntimeState_IsKeyedByItsExercise_WithARestrictForeignKeyToExercises` (AC-1)
- `Wave4FoundationMigrationTests.ExerciseRuntimeState_HasTheContractColumns_LengthsAndDefaults` (AC-1)
- `Wave4FoundationMigrationTests.PostEdit_HasTheContractColumns_ARestrictForeignKeyToPosts_AndTheUniqueEditNumberIndex` (AC-2)
- `Wave4FoundationMigrationTests.TheEditNumberKey_RefusesASecondRowForTheSameEdit_ButAllowsTheNextNumber` (AC-2)
- `Wave4FoundationMigrationTests.ThePostEditColumns_DefaultToNeverEdited` (AC-3)
- `Wave4FoundationMigrationTests.TheNewColumns_RoundTrip_AndNewRowsTakeTheDefaults` (AC-1, AC-2, AC-3)
- `QueryFilterModelTests.EveryExerciseScopedEntity_HasAGlobalQueryFilter` (+ `ExerciseRuntimeState`, `PostEdit` rows) (AC-4)
- `Wave4FoundationIsolationTests.RuntimeStateQuery_InExerciseA_ReturnsOnlyExerciseARow` (AC-4)
- `Wave4FoundationIsolationTests.RuntimeState_FindByAnotherExercisesKey_ReturnsNull_AndCountsDoNotLeak` (AC-4)
- `Wave4FoundationIsolationTests.RuntimeState_UnsetOrEmptyScope_ReturnsZeroRows_FailClosed_WhileTheRowExists` (AC-4)
- `Wave4FoundationIsolationTests.SavingARuntimeState_WithNoResolvedScope_ThrowsAndPersistsNothing` (AC-4)
- `Wave4FoundationIsolationTests.PostEditQuery_InExerciseA_ReturnsOnlyExerciseARows` (AC-4)
- `Wave4FoundationIsolationTests.PostEdit_IdorByKnownCrossExerciseIds_ReturnsNull_AndCountsDoNotLeak` (AC-4)
- `Wave4FoundationIsolationTests.PostEdit_UnsetOrEmptyScope_ReturnsZeroRows_FailClosed_WhileTheRowExists` (AC-4)
- `Wave4FoundationIsolationTests.SavingAPostEdit_WithNoResolvedScope_ThrowsAndPersistsNothing` (AC-4)
- `Wave4FoundationMigrationTests.TheMigration_IsWave4sOnlyOne_DirectlyAfterDemoFeedbackPinsNoiseImport` (AC-5)
- `Wave4FoundationMigrationTests.TheModelSnapshot_MatchesTheModel_SoNoSchemaChangeIsPendingWithoutAMigration` (AC-5)
- `Wave4FoundationMigrationTests.Up_CreatesTheColumnsWithTheContractTypes_AndTheirDefaults` (AC-5)
- `Wave4FoundationMigrationTests.Up_OverADatabaseThatAlreadyHasPosts_GivesThemEditCountZero_AndDownUpReapplies` (AC-5)
- `IdempotentMigrationScriptTests.TheDeployScript_BringsUpWave4_OverExistingPostsAndExercises_AndReplaysAsANoOp` (AC-5)
- `IdempotentMigrationScriptTests.TheDeployScript_AppliesEveryMigrationToAnEmptyDatabase_AndReplaysAsANoOp` (AC-5, empty DB)
- `Wave4ContractStubTests.EditPostRequest_ReadsText_AndAMissingTextIsNullNotAFailure` (AC-6)
- `Wave4ContractStubTests.PostEditHistoryDto_SerializesThePostIdAndVersionsWithTheFrozenKeys` (AC-6)
- `Wave4ContractStubTests.PostEditedDto_AndItsSummary_SerializeWithTheFrozenKeys` (AC-6)
- `Wave4ContractStubTests.PauseTierStateDto_CarriesPersisted_DefaultingToTrue` (AC-6)
- Full runs green: `Pulse.WebApi.Tests` 4419/4419, `Pulse.Core.Tests` 404/404 (AC-7)

**Build notes.** `Post.Body` has no max-length constant (it is `nvarchar(max)`), so `PostEdit.PreviousBody` is
`nvarchar(max)` too (the model test pins "same as `Post.Body`"). The central write guard refuses an **empty**
`ExerciseId` (the existing `GuardExerciseScope`, unchanged); it does not compare a row's non-empty `ExerciseId` with the
current context, so the write-guard tests prove the empty-scope refusal, and the cross-exercise half is proved on the
read side (a B row is invisible under A, so it cannot be loaded and modified under A).

**Resolved (orchestrator, option b).** The `ExerciseRuntimeStates.ExerciseId` → `Exercises` FK is **Restrict**, so the
XC-010 "every FK is Restrict/NoAction" invariants stand unchanged and pass; the migration was regenerated under the same
name. The write guard refuses an empty scope only (unchanged); cross-exercise protection is the read filter. Both
accepted as built.
