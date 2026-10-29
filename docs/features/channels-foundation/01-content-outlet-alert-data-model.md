# Story: Content, outlet and alert data model + migration

**Feature:** Channels foundation  ·  **Epic:** E3–E6 (shared)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-010, NWS-013, PRS-005, PRT-031, XC-001, XC-010, XC-005  ·  **Design decisions:** D3-P1  ·  **Issue:** —
**Stack:** backend  ·  **World:** staff/data (no UI)  ·  **Wave:** 1  ·  **Effort:** L

## Context
Every channel stores the same shape of thing. This story creates the five entities frozen in `implementation.md` **FC-2** (`Outlet`, `ContentItem`,
`ContentItemRevision`, `ContentItemMedia`, `ChannelAlert`) so E4/E5/E6 never add their own content table. It owns **M1**, the first entry of the
[migration ledger](implementation.md#migration-ledger) (portal, weather, F16 and press follow it in a fixed order), which keeps migrations serial and conflict-free.

## Acceptance Criteria
- [ ] **Scoped by construction.** Given the five entities, when they are added to `PulseDbContext`, then each implements `IExerciseScoped`, is covered by the central
      exercise query filter and write guard, and a test proves a row written under exercise A is invisible (and unwritable) under exercise B (XC-001).
- [ ] **Soft delete.** Given any of the five, when a row is deleted through the context, then it is retained with `DeletedAt` set and excluded from default reads (XC-010); a test proves nothing is hard-deleted.
- [ ] **Slug and uniqueness rules (FC-1).** Given two content items in one outlet, when they share a slug, then the database rejects the second; the same slug in a different outlet or exercise is accepted. Outlet slugs are unique per `(ExerciseId, ChannelId)`.
- [ ] **Cadence seam.** Given `ExternalSource` and `ExternalRef`, when both are set, then `(ExerciseId, ExternalSource, ExternalRef)` is unique (filtered index); when null, any number of rows coexist (PDF-06 seam).
- [ ] **Concurrency.** `ContentItem`, `Outlet` and `ChannelAlert` carry an integer `Version` concurrency token; a stale write raises `DbUpdateConcurrencyException` (the `InjectItem` pattern).
- [ ] **Follow-up columns (channel consolidation).** Given `ContentItem`, then it also carries `UpdatedScenarioTime?` (the Updated stamp; set by update/correction/silent_rewrite, never by `edit`), `PublishOptionsJson?` (staff-only; persisted `PublishOptions` replayed by the scheduler and inject fire, FC-7a) and `LastError?` (staff-only; set when a scheduled publish is refused, story 05); none is ever projected to a participant DTO.
- [ ] **One migration (M1).** A single EF migration creates the tables, passes the idempotent deploy script (any hand-written SQL naming a same-migration column is `EXEC`-wrapped, #413 rule), and a `RequiresDockerFact` migration test proves `Up` applies on LocalDB/SQL Server.
- [ ] **Time columns.** `CreatedScenarioTime` / `PublishedScenarioTime` / `ScheduledScenarioTime` are `datetimeoffset` and never defaulted from the wall clock; wall-clock columns are named `*WallClock` and exist only for staff/telemetry (COR-053).

## Out of Scope
Any endpoint, service, DTO or seed data (stories 02–07). Kind-specific payload columns (payload is opaque `PayloadJson`; each kind descriptor validates it). The `InjectItem.ContentItemId` column (story 16, M4); channel-owned tables (portal M2, weather M3, press M5 — see the ledger). PDF/`document` media kind (E5).

## Technical Notes
Staff/data layer. Files: `src/Pulse.WebApi/Data/Entities/*.cs`, EF configuration beside the existing ones, `PulseDbContext` (DbSets only), one migration. Entities use strings
for enum-like columns (the `Post`/`InjectItem` convention); the vocabulary class lives in story 02. See `implementation.md` § FC-2 for columns.

## Dependencies
Existing isolation layer (`IExerciseScoped`, `PulseDbContext` filter). Blocks 03, 04, 06, 10.
