# Story: Persona handle uniqueness — the `(ExerciseId, Handle)` unique index

**Feature:** Backend host & persistence foundation  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** COR-001 (per-exercise scope of the constraint), COR-020/022 (the handle-uniqueness policy `persona-management`/`persona-operation` validate against)  ·  **Design decisions:** resolves `docs/01-platform-core-isolation.md` §7 Q3  ·  **Issue:** —

## Context
Story 02 shipped `Persona` with `HasIndex(ExerciseId)` only and explicitly deferred handle uniqueness to the
then-open question `docs/01-platform-core-isolation.md` §7 Q3 (*"per-exercise only (recommended) or
org-global?"*). Code written since has stopped treating that as open and simply assumes per-exercise
uniqueness:

- `Features/Ops/EngineContentSeed/PersonaCastSeeder.cs` does its **idempotency read** by `(ExerciseId,
  Handle)` and groups the result with `OrdinalIgnoreCase`. A duplicate handle makes the seeder silently
  non-idempotent — it reuses one row arbitrarily and the other becomes an orphan the cast never references
  again.
- `Features/EngineRuntime/EngineReviewService.ResolvePersonaHandlesAsync` maps a burst's handles to persona
  instance ids and takes `.First()` per handle.
- **#342** adds `Features/Ops/Bootstrap/OpsPersonaResolver`, which binds a **participant's
  posting persona** by handle and works around the missing constraint with `OrderBy(p => p.Id)
  .FirstOrDefault()` so a duplicated cast at least resolves *deterministically*. That is a mitigation, not a
  fix: with two matching rows, which persona a participant posts as is decided by a Guid sort.

So the invariant is already load-bearing in three places while nothing enforces it. This story closes the gap
in the schema — the only place a constraint can actually hold — and resolves §7 Q3 in favour of the
recommended per-exercise scope. Surfaced by the Tier-2 review of **#342**, which deliberately shipped without a
migration to stay scoped.

> **Note on #342's filing.** It is `login/07-participant-persona-binding` on `main` today and is being re-homed
> to `identity-auth-roles/10-participant-persona-binding` on its own branch
> (`build/login/07-participant-persona-binding`, unmerged). The issue number is the stable reference; this
> document cites #342 rather than a story path for that reason.

World: backend infrastructure — no UI (see `feature.md` Design notes).

## Acceptance Criteria
- [x] Given the EF Core model, when it is built, then `Persona` carries a **unique** index on `(ExerciseId,
      Handle)` (`IX_Personas_ExerciseId_Handle`), alongside the existing non-unique `ExerciseId` lookup index
      — the same shape `Account.Username` already uses for its per-exercise login handle.
- [x] Given a database at the previous migration, when `PersonaHandleUniqueIndex` is applied, then
      `Personas.Handle` is narrowed from `nvarchar(max)` to `nvarchar(256)` (nvarchar(max) is not index-key
      eligible in SQL Server) and the unique index is created, against a real Azure-SQL-compatible target.
- [x] Given one exercise, when a second persona is written with a handle differing from an existing one **only
      by case** (`mvega_fh` vs `MVega_FH`), then the write is rejected by the database — the index folds case
      under the `SQL_Latin1_General_CP1_CI_AS` collation, consistent with the `OrdinalIgnoreCase` grouping
      `PersonaCastSeeder` does in memory and the case-insensitive server-side `==`/`Contains` the by-handle
      resolvers rely on. A lookalike handle cannot be introduced by case alone.
- [x] Given two **different** exercises, when each writes a persona with the same handle, then both persist —
      uniqueness is per-exercise, never org-global (COR-001; a shared library cast must be seedable into every
      exercise).
- [x] Given a database that already contains a legitimately seeded persona cast (the live UAT case), when the
      migration is applied, then it succeeds and deletes nothing. *Verified two ways: a test that migrates a
      seeded database forward, and a read-only pre-flight against the real `sqldb-pulse-uat` (clean — see
      Technical Notes).*
- [x] Given a database that already contains genuinely duplicated `(ExerciseId, Handle)` rows, when the
      migration is applied, then it **fails fast inside its own transaction** with a diagnostic naming each
      offending exercise id, handle, and occurrence count, and leaves both the data and the schema untouched —
      it does **not** de-duplicate automatically (see Technical Notes for why, and for the remediation shape).

## Out of Scope
- **De-duplicating existing rows.** Deliberate — see Technical Notes.
- **Handle normalization.** The index keys on the stored handle, so `@mvega_fh` and `mvega_fh` remain two
  distinct legal keys within one exercise. Every caller that accepts either spelling still normalizes the `@`
  itself (`EngineReviewService.ResolvePersonaHandlesAsync`, `OpsPersonaResolver`), and their
  `GroupBy`/`First()` collapse of the two spellings keeps its residual arbitrariness. Canonicalizing the
  stored form (strip-or-require `@` on write) is a separate change with its own data migration.
- **`PersonaTemplate.Handle`.** The cross-run authoring library is not exercise-scoped, so "unique per
  exercise" is not even expressible for it; whether the shared library wants a global unique handle is
  `persona-management/01`'s question, not this story's.
- **Application-level validation and its error surface.** A `DbUpdateException` is the right *floor*, not a
  good user-facing error. The friendly, keyboard-accessible "handle already taken" message belongs to the
  authoring stories that create personas interactively (`persona-management/03`, `persona-operation/05`),
  which can now validate against an enforced constraint rather than an assumed one.
- **The insert/resolve race.** The index makes a concurrent duplicate insert *fail* rather than succeed; it
  does not make any caller's read-then-insert atomic. `PersonaCastSeeder` is single-writer per exercise in
  practice; if a concurrent-seed path ever appears, it needs the idempotent-recovery treatment
  `BootstrapService` already applies to the `Exercises.Hostname` unique index.

## Technical Notes
Paths: `src/Pulse.WebApi/Data/PulseDbContext.cs` (the `Persona` model block); `src/Pulse.WebApi/Data/
Migrations/20260725120413_PersonaHandleUniqueIndex.cs`; `src/Pulse.WebApi/Data/Entities/Persona.cs` (the
`Handle` XML doc, which previously read *"uniqueness policy is out of scope here"*).

**The column narrowing is not cosmetic.** SQL Server cannot use an `nvarchar(max)` column as an index key, so
the migration's `AlterColumn` to `nvarchar(256)` is a precondition of the index, not tidying. 256 matches
`Account.Username` and `StaffUser.ExternalSubject`.

**No de-duplication step — decided explicitly.** The migration guards instead of repairing. A duplicate
persona row can already be referenced by `Posts.AuthorPersonaId` and `Accounts.PersonaId`; neither is a
declared FK, so a `DELETE` would succeed and silently orphan a live exercise's authored posts or leave a
participant bound to a persona id that no longer exists. Choosing which row survives is a judgement about
*that exercise's content*, not something a migration can infer. And the case is unlikely by construction:
`PersonaCastSeeder` is the only production insert path and is idempotent on `(ExerciseId, Handle)`, so
duplicates require concurrent seeds of the same exercise or a manual `INSERT`. Read-only pre-flight for any
environment (safe to run against UAT or production before deploying):

```sql
SELECT ExerciseId, MIN(Handle) AS Handle, COUNT(*) AS Occurrences
FROM Personas
GROUP BY ExerciseId, Handle   -- CI collation: folds case exactly as the index key will
HAVING COUNT(*) > 1;
```

**UAT verified clean (2026-07-25, before merge).** Ran against `sqldb-pulse-uat` on `sql-pulse-uat`: **zero**
duplicate groups and zero over-length handles, so **no de-duplication step is needed for this deployment**. The
one exercise present (`Pulse UAT Pilot`, host `app-pulse-api-uat-dynamis.azurewebsites.net`) holds exactly 6
personas with 6 distinct handles — the seeded starter cast, untouched. Two further facts confirmed against the
real database rather than assumed: `Personas.Handle` is currently `nvarchar(max)` with collation
`SQL_Latin1_General_CP1_CI_AS` (so the narrowing ALTER *is* required and the case-insensitivity this story
relies on genuinely holds in UAT), and `__EFMigrationsHistory` tops out at `20260722163046_EngineReviewItems`
— this migration is the immediate next one, with nothing interleaved. No handle carries a leading `@`, so the
out-of-scope normalization ambiguity is not live in UAT today.

Empty result ⇒ the migration applies cleanly. Non-empty ⇒ resolve each group by hand before deploying:
repoint the losing row's `Posts.AuthorPersonaId` / `Accounts.PersonaId` references at the surviving persona
id, then delete the loser. The migration's own guard runs the same query and refuses to proceed with a
diagnostic listing the groups, so a deploy against a duplicated database fails safely and legibly rather than
on an opaque `CREATE UNIQUE INDEX` error.

**The defensive workarounds stay, with comments saying why — but they are not all the same case.** Each of the
three sites now carries a comment stating what the index does and does not guarantee for *it*, so a later
reader neither mistakes a belt-and-braces layer for a live code path nor deletes one thinking the constraint
covers it:

| Site | Still reachable under the index? | Kept because |
|---|---|---|
| `PersonaCastSeeder`'s `GroupBy(..., OrdinalIgnoreCase)` | No | It is what stops `ToDictionary` throwing; one pass over six rows. |
| `EngineReviewService.ResolvePersonaHandlesAsync`'s `GroupBy`/`First()` | **Yes** | It fetches *both* the `@` and no-`@` spellings and folds them client-side. The index treats those as two distinct legal keys, so this collapse is still doing real work and still picks arbitrarily between them. |
| `OpsPersonaResolver.OrderBy(p => p.Id)` (#342) | No | A pure fail-safe — see below. |

`OpsPersonaResolver` deserves the correction explicitly, because the obvious reading is wrong: it is *not* the
`EngineReviewService` case. `TryNormalizeHandle` strips the `@` from the **input** and the query then matches
the stored handle exactly, so only one spelling is ever asked for — which the unique index reduces to at most
one candidate, making the `OrderBy` unreachable. (The flip side, pre-existing and untouched here: a persona
stored *with* a leading `@` cannot be found by that path at all. A normalization quirk, not a uniqueness one.)
It is kept anyway because it costs nothing — the index makes this a one-row seek regardless — and because
dropping or reverting the index should degrade that lookup to *deterministic*, not to *arbitrary*.

## Dependencies
`backend-host/02-persistence-efcore` (the `PulseDbContext` and `Persona` entity this constrains). Not blocked
by, and does not block, **#342** — that story's `OpsPersonaResolver` behaves identically either way, and the two
changes touch disjoint files, so they can merge in either order. The comment + `MaxHandleLength` doc correction
inside `OpsPersonaResolver` is committed on `build/login/07-participant-persona-binding` (`aa06fd4`; it cannot
land here — the file does not exist on `main` yet) and is worded to be accurate before *and* after this
migration merges. Unblocks the enforced-uniqueness ACs in
`persona-management/03-mid-exercise-persona-creation` and
`persona-operation/05-mid-exercise-persona-creation`.

## Tests
- `src/Pulse.WebApi.Tests/Data/PersonaHandleUniquenessTests.cs` — real-SQL (`[RequiresDockerFact]`):
  same-exercise duplicate rejected with a SQL uniqueness error (2601/2627) and the original row left intact;
  case-variant handle rejected too (the collation-consistency AC); the same handle in two different exercises
  both persisting; plus schema assertions over `sys.indexes`/`sys.columns` that the index is UNIQUE on
  `(ExerciseId, Handle)` and that `Handle` is `nvarchar(256)` with the CI collation — proof the *migration*
  applied, not merely that the C# model compiles.
- `src/Pulse.WebApi.Tests/Data/PersonaHandleUniqueIndexMigrationGuardTests.cs` — provisions its own throwaway
  database, migrates to the *previous* migration, stages data, then migrates forward: an already-seeded
  six-persona cast (in two exercises, same handles) migrates cleanly and loses no rows; a duplicated pair
  fails with a diagnostic naming the exercise and handle, deletes nothing, and rolls the schema back. Without
  this, the guard would be the one piece of hand-written SQL in the change that CI never executes.
- The existing `PersonaCastSeederTests` idempotency and cross-exercise-same-handle cases now run *against* the
  constraint, which is where a regression in the seeder's assumption would surface.
- Gate-0: `dotnet build pulse.slnx -c Release` (0 warnings) + `dotnet test pulse.slnx`. Run the SQL-backed
  suites locally by setting `PULSE_TEST_SQL_CONNECTION` to a LocalDB connection string — CI otherwise catches
  unique-index collisions in shared fixtures late.

**Review posture.** A schema change, so **Tier-2 human sign-off** per `docs/BACKEND_ROADMAP.md` §3 principle 5
(*"isolation/security/schema"*) — and specifically a review of the no-de-duplication decision and the
per-exercise (not org-global) scope, both of which are irreversible in a live environment in the way an
endpoint change is not. Principle 6 (*"seed v0, budget one hardening pass … do not treat the first migration as
final"*) is the standing licence for this change.
