# Story: Portal data model and migration

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-002, PRT-003, PRT-022, PRT-040 (data side), XC-001, XC-010  ·  **Design decisions:** none  ·  **Issue:** —
**Stack:** backend  ·  **World:** foundation  ·  **Wave:** 1  ·  **Effort:** M

## Context
The portal owns no content (foundation Q7), but it owns four things that need rows: per-exercise portal configuration (masthead, module order), the non-fiction Resources shelf, and kiosk displays with their
credentials and state. This story adds exactly those three tables as PC-2 in **one migration** (**M2** of the foundation [migration ledger](../channels-foundation/implementation.md#migration-ledger): after F01's M1, before weather's M3 and F16's M4) and nothing else. See [`implementation.md` § PC-2](implementation.md#pc-2-entities-dataentities-iexercisescoped-behind-the-pulsedbcontext-central-filter--write-guard-one-migration-owned-by-story-01).

## Acceptance Criteria
- [ ] **Entities.** Given `PortalConfig`, `PortalResource` and `PortalDisplay` with the PC-2 columns, then each implements `IExerciseScoped`, is registered behind the `PulseDbContext` central query filter and write guard, and a test proves a query under exercise B never returns exercise A's rows and a write with the wrong `ExerciseId` is refused (XC-001).
- [ ] **Constraints.** Then `PortalConfig` has a unique index on `(ExerciseId)`, `PortalDisplay.TokenHash` is globally unique, `PortalResource.SortOrder` is indexed per exercise, and size caps from PC-1 (`ModulesJson`, `SkinOverridesJson`, names) are enforced by column length and a service-level guard the later stories call.
- [ ] **Soft delete (XC-010).** Given a resource is deleted or a display is revoked, then the row is retained (`DeletedAt` / `RevokedAt`), excluded from normal reads, and visible to an AAR export query; nothing in this feature hard-deletes.
- [ ] **Credential hygiene.** Given `PortalDisplay`, then the token is stored only as `TokenHash` plus a Data Protection `TokenProtected` copy (the `ParticipantLink` shape, EL-5); no plaintext token column exists and no entity `ToString`/log path prints either value.
- [ ] **One migration (M2).** Given a clean database and a database at M1 (F01's head), then the single migration applies and rolls forward idempotently (hand SQL `EXEC`-wrapped per #413) and the model snapshot matches; the migration id carries the ledger token (`Channels_M2_…`), later ledger migrations (weather M3, F16 M4, press M5) regenerate against this snapshot, and no other E3 story adds a migration.
- [ ] **Defaults without rows.** Given an exercise with no `PortalConfig`, then the entity layer exposes "absent" so story 03 can return defaults without creating a row on a participant read.

## Out of Scope
Any endpoint or service (03, 04, 05, 08), the `ContentItem` / `Outlet` tables (F01), seed data (21).

## Technical Notes
Files: `Data/Entities/{PortalConfig,PortalResource,PortalDisplay}.cs`, `Data/PulseDbContext.cs` (DbSets only), `Migrations/*`. Mirror `ParticipantLink` / `Outlet` configs. The migration is serialized with F16's by the orchestrator (seam table in `implementation.md`).

## Dependencies
F01 (M1) merged (so the snapshot is current), the existing isolation layer. Can run with 02.
