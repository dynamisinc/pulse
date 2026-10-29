# Story: Portal data model — constraints, limits guard and isolation tests (schema is F01's M1)

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21); **re-scoped 10/29 (Q-28: schema folded into F01's M1; Q-35: no `PortalDisplay`)**  ·  **Status:** Not Started
**Requirements:** PRT-002, PRT-003, PRT-022, XC-001, XC-010  ·  **Design decisions:** Q-28, Q-35 (Tom, 10/29)  ·  **Issue:** #767
**Stack:** backend  ·  **World:** foundation  ·  **Wave:** 1 (E3-local; combined **CW2**, after F01 merges)  ·  **Effort:** S (was M)

## Context
The portal owns no content (foundation Q7), but it owns two things that need rows: per-exercise portal configuration (masthead, module order) and the non-fiction Resources shelf. On 10/29 Tom
decided (Q-28) to **fold the portal tables into foundation F01's M1**, so this story **no longer authors entities or a migration**: `PortalConfig` and `PortalResource` (PC-2 columns) are created by F01.
The third table, `PortalDisplay`, is **not created at all** — kiosk display sessions are Deferred (post-December, Q-35; stories 05/08/20), so there is nothing to store. What remains here is the part that makes the
tables safe to build on: the limits guard the later stories call, soft-delete/AAR semantics, the "absent row = defaults" rule, and the isolation and contract tests over F01's entities. See
[`implementation.md` § PC-2](implementation.md) (PC-2 Entities).

## Acceptance Criteria
- [ ] **Isolation over F01's entities.** Given `PortalConfig` and `PortalResource` as created by F01's M1, then a test proves each is `IExerciseScoped`, covered by the `PulseDbContext` central query filter and write guard, that a query under exercise B never returns exercise A's rows and that a write with the wrong `ExerciseId` is refused (XC-001); the two tables are added to the standing isolation suite.
- [ ] **Constraints and limits guard.** Given the PC-1 limits, then `PortalConfig` is unique on `(ExerciseId)`, `PortalResource.SortOrder` is indexed per exercise (both asserted against the model from F01), and a service-level `PortalLimits` guard (masthead name ≤ 60, `ModulesJson`/`SkinOverridesJson` ≤ 4 KB, ≤ 25 resources) exists for stories 03/04/16 to call and refuses over-cap input with a readable reason.
- [ ] **Soft delete (XC-010).** Given a resource is deleted, then the row is retained (`DeletedAt`), excluded from normal reads, and visible to an AAR export query this story provides; nothing in this feature hard-deletes.
- [ ] **Defaults without rows.** Given an exercise with no `PortalConfig`, then the data layer exposes "absent" so story 03 can return defaults without creating a row on a participant read.
- [ ] **Schema contract and no migration (Q-28/Q-35).** Given the PC-2 table in `implementation.md`, then a contract test compares the EF model's `PortalConfig` and `PortalResource` columns to it (a drift fails the build), asserts **no `PortalDisplay` entity or table exists**, and asserts this story adds no migration (the ledger test in F20 enforces the same).

## Out of Scope
Entities, DbSets and the migration (**F01's M1**); any endpoint or service (03, 04); `PortalDisplay` and everything credential-related (Deferred with story 05); the `ContentItem` / `Outlet` tables (F01); seed data (21).

## Technical Notes
Files: `Features/Portal/Data/**` (`PortalLimits`, AAR export query) and `Pulse.WebApi.Tests/Portal/Data/**`. Does **not** touch `Data/Entities/**`, `PulseDbContext.cs` or `Migrations/**` (F01's). If F01's merged entity shape differs from PC-2, amend PC-2 in the same PR as the contract test, not the migration. Mirror the `Outlet` isolation tests.

## Dependencies
**F01 (M1 merged, with the folded portal tables)**, the existing isolation layer. Can run with 02.
