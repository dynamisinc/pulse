# Story: Wave 4 foundation: one migration and the frozen contract

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-053, NFR-008 (restart resilience, #526 slice), D1 parity  ·  **Decisions:** DF-24..DF-27, DF-29..DF-33  ·  **Issue:** #535
**Stack:** backend  ·  **World:** foundation  ·  **Review:** **Tier-2 (schema)**  ·  **Priority:** Must  ·  **Wave:** 4  ·  **Effort:** S
**Owner:** planning session · **Branch:** `build/demo-feedback/17-wave4-foundation` → `feature/demo-feedback-w4`

## Context

Wave 4 needs two pieces of schema: a per-exercise runtime-state row so the pause tier, clock and holding page survive
an App Service restart (18), and edit tracking on posts (19). [`WAVE-4.md`](WAVE-4.md#schema-story-17-one-migration-demofeedbackwave4runtimeandedits)
freezes both in **one migration**. This story lands the entities, the migration and the contract stubs so 18, 19 and
20 build in parallel against fixed shapes.

## Acceptance Criteria

- [ ] New entity `Data/Entities/ExerciseRuntimeState.cs` exactly as the WAVE-4 schema table: `ExerciseId` is the
      primary key and an FK to `Exercises` (cascade delete), implements `IExerciseScoped`, `PauseTier` defaults to
      `running`, `OverlayState` to `none`, `OverlaySequence` to 0, `ClockFrozen` to false. XML docs state that clock
      columns are all null (unstarted) or all set, and that the wall anchor is UTC.
- [ ] New entity `Data/Entities/PostEdit.cs`: `Id`, `ExerciseId` (`IExerciseScoped`), `PostId` (FK restrict),
      `EditNumber` (1..5), `PreviousBody` (same max length constant as `Post.Body`), `EditedAt`, `EditedScenarioTime`,
      `ActingHumanId` (same type as `Post.ActingHumanId`, nullable). Unique index (`PostId`, `EditNumber`).
- [ ] `Post` gains `EditCount` (int, default 0), `LastEditedAt` and `LastEditedScenarioTime` (nullable
      `DateTimeOffset`). `LastEditedAt` is documented as staff/export only (XC-002: never projected to a participant).
- [ ] `PulseDbContext` registers both sets; both are covered by the central exercise query filter and the write guard
      (a test inserts a row for another exercise and it is refused; a read under exercise A never sees B's rows).
- [ ] **ONE migration `DemoFeedbackWave4RuntimeAndEdits`** + snapshot. It applies cleanly through the idempotent
      script (`dotnet ef migrations script --idempotent`) on top of `20261014202342_DemoFeedbackPinsNoiseImport`, and
      on a database that already has data (existing posts get `EditCount = 0`).
- [ ] Contract stubs compile and are referenced by nothing yet: `Features/Social/Editing/PostEditDtos.cs`
      (`EditPostRequest { text }`, `PostEditHistoryDto`, `PostEditedDto`, `PostEditedSummaryDto { count, scenarioTime }`),
      `PauseTierStateDto` gains `persisted` (default `true` until 18 wires it). camelCase on the wire.
- [ ] No behaviour change: every existing backend test passes.

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
