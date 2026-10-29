# Story: Content, outlet and alert data model + migration

**Feature:** Channels foundation  ·  **Epic:** E3–E6 (shared)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** In Review
**Requirements:** NWS-010, NWS-013, PRS-005, PRT-031, XC-001, XC-010, XC-005; schema only for PRT-002/003/022 (portal tables) and WX-004 (zones)  ·  **Design decisions:** D3-P1, Q-28 (Tom, 10/29: fold M2–M4 into M1)  ·  **Issue:** #697
**Stack:** backend  ·  **World:** staff/data (no UI)  ·  **Wave:** 1  ·  **Effort:** L

## Context
Every channel stores the same shape of thing. This story creates the five entities frozen in `implementation.md` **FC-2** (`Outlet`, `ContentItem`,
`ContentItemRevision`, `ContentItemMedia`, `ChannelAlert`) so E4/E5/E6 never add their own content table. It owns **M1**, the single schema migration for the whole December channels release (Q-28, **Tom 10/29**): beside the five content entities it
also creates the portal's `PortalConfig` and `PortalResource`, weather's `WeatherZone` and the nullable `InjectItem.ContentItemId` column, so the portal, weather and inject stories add **no** migration.
Only press's approval audit tables follow, as the ledger's one later migration (M2). See the [migration ledger](implementation.md#migration-ledger). Column specs for the folded tables are owned by their features
(portal PC-2, weather zone model) and are **frozen before CW1 starts**; this story only implements them.

## Acceptance Criteria
- [x] **Scoped by construction.** Given the five entities and the three folded entities below, when they are added to `PulseDbContext`, then each implements `IExerciseScoped`, is covered by the central
      exercise query filter and write guard, and a test proves a row written under exercise A is invisible (and unwritable) under exercise B (XC-001).
- [x] **Soft delete.** Given any of the five, when a row is deleted through the context, then it is retained with `DeletedAt` set and excluded from default reads (XC-010); a test proves nothing is hard-deleted.
- [x] **Slug and uniqueness rules (FC-1).** Given two content items in one outlet, when they share a slug, then the database rejects the second; the same slug in a different outlet or exercise is accepted. Outlet slugs are unique per `(ExerciseId, ChannelId)`.
- [x] **Cadence seam.** Given `ExternalSource` and `ExternalRef`, when both are set, then `(ExerciseId, ExternalSource, ExternalRef)` is unique (filtered index); when null, any number of rows coexist (PDF-06 seam).
- [x] **Concurrency.** `ContentItem`, `Outlet` and `ChannelAlert` carry an integer `Version` concurrency token; a stale write raises `DbUpdateConcurrencyException` (the `InjectItem` pattern).
- [x] **Follow-up columns (channel consolidation).** Given `ContentItem`, then it also carries `UpdatedScenarioTime?` (the Updated stamp; set by update/correction/silent_rewrite, never by `edit`), `PublishOptionsJson?` (staff-only; persisted `PublishOptions` replayed by the scheduler and inject fire, FC-7a) and `LastError?` (staff-only; set when a scheduled publish is refused, story 05); none is ever projected to a participant DTO.
- [x] **Folded channel schema (Q-28, Tom 10/29).** Given the same migration, then it also creates `PortalConfig` (unique `(ExerciseId)`, PC-2 columns), `PortalResource` (PC-2 columns, `SortOrder` indexed per exercise), `WeatherZone` (`Slug`, `Name`, `Kind` county|city|region|custom, `Description?`, `SortOrder`, `IsDefault`, `Version`, `DeletedAt`; slug unique per exercise) and a **nullable** `InjectItem.ContentItemId` with an index and a same-exercise reference to `ContentItem` (no behavior change to existing inject rows); every new entity is `IExerciseScoped`, soft-deleted (*except `PortalConfig`, which PC-2 gives no `DeletedAt`; see Implementation notes*) and behind the central filter + write guard, and **no `PortalDisplay` table is created** (display sessions are Deferred, post-December).
- [x] **One migration (M1).** A single EF migration creates all of the above tables/column, passes the idempotent deploy script (any hand-written SQL naming a same-migration column is `EXEC`-wrapped, #413 rule), and a `RequiresDockerFact` migration test proves `Up` applies on LocalDB/SQL Server.
- [x] **Time columns.** `CreatedScenarioTime` / `PublishedScenarioTime` / `ScheduledScenarioTime` are `datetimeoffset` and never defaulted from the wall clock; wall-clock columns are named `*WallClock` and exist only for staff/telemetry (COR-053).

## Implementation notes (build, 10/29)
Tests per AC: scoped → `ChannelsIsolationTests` (read/unset-scope/write-guard/bulk-write/composite-FK/stub-write) · soft delete → `DeletingThroughTheContext_…`, `ASoftDeleteByStub_…`, `IncludingSoftDeleted_…` · slugs → `ContentSlugs_…`, `OutletSlugs_…` · Cadence seam → `TheCadenceSeam_…` · concurrency → `AStaleWrite_…` · follow-up columns + folded schema + no `PortalDisplay` → `ChannelsM1MigrationTests` contract-column theory · one migration → `TheMigration_IsTheOneM1_…`, `Up_OverADatabaseThatAlreadyHasAnInject_…`, `TheDeployScript_BringsUpChannelsM1_…` · time columns → `TimeColumns_…`.

Recorded deviations and decisions (for the orchestrator; no spec was rewritten):
- **`PortalConfig` is not soft-deleted.** PC-2 (frozen, rule 6) gives it no `DeletedAt`, and portal 01's PC-2 drift test would fail on an extra column, so the AC's "every new entity … soft-deleted" holds for every M1 entity **except** `PortalConfig`. It is a 0..1 settings row: portal 03 resets it by update and must never `Remove` it. If a `DeletedAt` is wanted, it is an additive follow-on migration after M2.
- **Soft delete mechanism.** New opt-in `Data/ISoftDeletable.cs`: a context delete stamps only `DeletedAt`. EF Core 10 forbids an anonymous and a named filter on one entity, so the entity's (anonymous) filter is the exercise predicate AND `DeletedAt IS NULL`. Readers that need deleted rows use `PulseDbContext.IncludingSoftDeleted<T>()`, which keeps the exercise scope, never a bare `IgnoreQueryFilters()`.
- **Unfiltered unique indexes.** The slug indexes (content, outlet, zone) and the Cadence `(ExerciseId, ExternalSource, ExternalRef)` index are not filtered on `DeletedAt`, so a deleted row keeps its slug or reference reserved (NWS-011). Consumers' idempotency and slug-collision checks (F04 `-2` slugs, the Cadence seam, portal filler seeding, weather 02 zone create) must read through `IncludingSoftDeleted<T>()`, or they will hit a unique-key violation on a deleted row.
- **Same-exercise references** (beyond the AC's inject column): every reference from an M1 table to another table row, including `MediaAssets`, is a composite FK onto `(ExerciseId, Id)`. M1 therefore adds the alternate key `AK_MediaAssets_ExerciseId_Id` to the existing `MediaAssets` table: a unique constraint only, with no column change. `ExerciseId` is also a concurrency token on every M1 entity (model-only).
- **Soft delete semantics for services (03+):** a `Remove` persists `DeletedAt` plus any edits already made to the tracked row; it does not bump `Version` (services own version bumps, the `InjectItem` pattern). Story 05's due-item read uses `IgnoreQueryFilters()`, which also drops the soft-delete half of the filter, so it must restate `DeletedAt == null` and `Status == "scheduled"` to match the filtered index `IX_ContentItems_ExerciseId_ScheduledScenarioTime`.
- **`DeletedAt`** keeps the house soft-delete name (it matches `Post` and `InjectItem`); it is the one wall-clock column not named `*WallClock`.
- **Program.cs:** one line, `builder.Services.AddChannels();`. The seam (`Features/Channels/ChannelsServiceCollectionExtensions.cs`) is empty until story 03.

## Out of Scope
Any endpoint, service, DTO or seed data (stories 02–07). Kind-specific payload columns (payload is opaque `PayloadJson`; each kind descriptor validates it). Any behavior over the folded tables (portal 01/03/04, weather 02 services and API, F16 inject logic) — this story ships schema, entities, filters and isolation tests only. Press's approval tables (M2 in the ledger). `PortalDisplay` (post-December). PDF/`document` media kind (E5).

## Technical Notes
Staff/data layer. Files: `src/Pulse.WebApi/Data/Entities/{Outlet,ContentItem,ContentItemRevision,ContentItemMedia,ChannelAlert,PortalConfig,PortalResource,WeatherZone}.cs`, `Data/Entities/InjectItem.cs` (the one nullable column only), EF configuration beside the existing ones, `PulseDbContext` (DbSets only), one migration. This is the heaviest foundation story (still L; the folded tables are small, plain entities): if the builder needs to split, split by entity group inside one PR, never into a second migration. Entities use strings
for enum-like columns (the `Post`/`InjectItem` convention); the vocabulary class lives in story 02. See `implementation.md` § FC-2 for columns.

## Dependencies
Existing isolation layer (`IExerciseScoped`, `PulseDbContext` filter); the frozen column specs for the folded tables (portal PC-2, weather zone model, inject column). Blocks 03, 04, 06, 10, 16, portal 01, weather 02.
