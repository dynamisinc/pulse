# Story: Schema — media, replies, reactions, avatars (one migration)

**Feature:** Demo polish  ·  **Epic:** E1 / E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-001, SOC-010, SOC-030, COR-001, COR-020, COR-024, XC-010  ·  **Design decisions:** none  ·  **Issue:** —
**Story ID:** B1  ·  **Stack:** backend  ·  **Priority:** Must  ·  **Effort:** M  ·  **Wave:** 1 (merges first)  ·  **Review:** Tier-2 (Tom)
**Home story:** [`posts/01`](../posts/01-post-composition.md), [`persona-management/05`](../persona-management/05-avatar-library.md); also seeds [`reactions/01`](../reactions/01-like.md), [`threads-replies/01`](../threads-replies/01-flattened-thread-view.md).

## Context
**As** the build team, **I want** every table and column the demo needs in exactly one migration plus the frozen
interface skeleton, **so that** BM, BP, B2, B3, B6 and PE-BE can be built in parallel without fighting over the
EF model snapshot or each other's compile errors.

Schema only — **no endpoint or service behaviour**. The exact entity shapes, indexes and FKs are in
`implementation.md` §1.2–§1.3; the seam interfaces and DTO skeleton are §1.4. This story also owns decisions
DP-1…DP-4 and DP-7 (extra columns `MediaAsset.CreatedScenarioTime`, `MediaAsset.PosterMediaAssetId`,
`Persona.Location`; `PostMediaItem` is exercise-scoped).

## Acceptance Criteria
- [ ] **Entities exist exactly as frozen.** `MediaAsset`, `PostMediaItem`, `PostReaction` (all
      `IExerciseScoped`, non-nullable `ExerciseId`); `Post` gains `ParentPostId` +
      `BaselineLike/Repost/ReplyCount`; `Persona` gains `AvatarMediaId`, `BannerMediaId`, `Location` — names,
      types, nullability, lengths per §1.2.
- [ ] **EF config per §1.3.** Unique `(PostId, PersonaId, Kind)` on reactions, unique `(PostId, Order)` on media
      items, unique `BlobName`, `IX_Posts_ParentPostId`; every FK is `Restrict`/`NoAction` (no cascade path; no
      hard-delete path — XC-010).
- [ ] **Isolation (always-Critical, COR-001/XC-001).** Given rows for exercises A and B, then under scope A none
      of B's `MediaAssets`, `PostMediaItems`, `PostReactions` are returned; an unresolved scope returns **zero**
      rows; the write guard throws `ExerciseScopeViolationException` for each of the three with `ExerciseId ==
      Guid.Empty`. The existing "every `IExerciseScoped` entity has the central filter" sweep stays green with
      the new types listed.
- [ ] **Exactly one migration** `…_DemoPolishMediaRepliesReactions` (+ Designer + updated
      `PulseDbContextModelSnapshot.cs`); `dotnet ef migrations has-pending-model-changes` is clean.
- [ ] **Safe over legacy rows.** Migrating from `20260802124443_ExerciseCreatedAt` with existing
      `Posts`/`Personas` rows keeps every row; new columns read `ParentPostId NULL`, baselines `0`,
      avatar/banner/location `NULL`.
- [ ] **Deploy-script safe (lesson #413).** `IdempotentMigrationScriptTests` replays the generated script
      batch-by-batch (as `sqlcmd -b` does) on an empty database and on the legacy-rows database, and a second
      apply is a no-op. Any hand-written SQL that names a column added in the same migration is
      `EXEC(N'…')`-wrapped (expected: there is none).
- [ ] **Frozen seam skeleton lands, behaviour-free.** The five interface files and `PostWireDtos.cs` exist
      verbatim from §1.4 with the `FROZEN` header; `ParticipantPostDto` is unsealed with a protected copy
      constructor and optional `media`/`inReplyTo`/`viewer`; `ParticipantPostDto.FromPost` output is
      byte-identical to today (existing `FeedReadEndpointTests`/`PostWriteEndpointTests` unchanged and green).

## Out of Scope
Any endpoint, service, store, projector or broadcaster behaviour; registering the seam interfaces in DI;
baselines backfill; showing `Location` anywhere; a second migration (a later need goes to the orchestrator as a
Tier-2 decision).

## Technical Notes
- Backend (no world). Files per implementation.md §4.1 row B1. Mirror `Follow` for the scoped-entity config
  (`ExerciseId` required + `HasIndex`, scope-leading unique keys where it matters, logical persona reference).
  The column `Order` is a SQL reserved word — EF brackets it; raw SQL must too.
- Migration procedure and the idempotent-script rule: implementation.md §6. Nobody else touches
  `PulseDbContext.cs`, `Post.cs`, `Persona.cs`.
- The DTO skeleton is why BP/B2/BM compile in isolated worktrees; do **not** implement `FromPost` media/viewer
  behaviour here.

## Dependencies
P2 (frozen contract). **Blocks** BM, BP, B2, B3, B6, PE-BE. Independent of I1, F0, B5.

## Tests
- `Pulse.WebApi.Tests/Data/QueryFilterModelTests.cs` (extend `InlineData` with the three types) and
  `QueryFilterIsolationTests.cs` (cross-exercise reads per new entity, real SQL via `MsSqlContainerFixture`).
- `WriteGuardTests.cs`: `Guid.Empty` rejection for each new scoped entity.
- `IdempotentMigrationScriptTests.cs` (new replay case) and new `DemoPolishMigrationTests.cs` (legacy rows
  survive; unique indexes reject duplicates: reaction triple, media `(PostId, Order)`, `BlobName`).
- `FeedReadEndpointTests`/`PostWriteEndpointTests`/`PersonaEndpointsTests` unchanged and green (no behaviour
  change).
