# Story: Persistence — `PulseDbContext` + EF Core walking-skeleton entities

**Feature:** Backend host & persistence foundation  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** COR-001 (schema precondition), XC-004 (durable event store), COR domain model §3.1 (partial)  ·  **Design decisions:** none  ·  **Issue:** #269

## Context
The first durable state in Pulse. Today "zero `DbContext`/EF/repository/migration code anywhere"
(`docs/BACKEND_ROADMAP.md` §1) is why a controller's post "evaporates on reload" and nothing persists
across sessions. This story stands up `PulseDbContext` (EF Core on Azure SQL, the authored-but-gated
`infrastructure/modules/database.bicep`) with the **minimal walking-skeleton entity set** the rest of
Phase B0 needs — `Exercise`, `PersonaTemplate`/`Persona`, `Post`, and the durable telemetry event store —
each scoped entity carrying a non-nullable `ExerciseId`. It explicitly defers the rest of E1's domain
model (`Organization`, `ParticipantAccount`, `StaffAssignment`, `Cast` — `docs/01-platform-core-
isolation.md` §3.1) to the identity phase (`docs/BACKEND_ROADMAP.md` Phase B2, `identity-backend`), so
this stays INVEST-small rather than modeling the whole epic's domain in one story.

This is the seam two *other* features' Phase-B0 stories depend on next, as a serial cross-feature edge:
`exercise-isolation/01-exercise-scoped-queries` (COR-001 — extends this story's `PulseDbContext` with the
read-side global query filter) and `telemetry/02-telemetry-sink-backend` (XC-004 — writes through this
story's `DbSet<TelemetryEvent>`). Neither of those stories is built by this one; this story only makes
them buildable.

World: backend infrastructure — no UI (see `feature.md` Design notes).

## Acceptance Criteria
- [x] Given `Pulse.WebApi`, when its EF Core model is built, then `PulseDbContext` exposes
      `DbSet<Exercise>`, `DbSet<PersonaTemplate>`, `DbSet<Persona>`, `DbSet<Post>`, and
      `DbSet<TelemetryEvent>` — the walking-skeleton set only; no other E1 entity (`Organization`,
      `ParticipantAccount`, `StaffAssignment`, `Cast`) is modeled by this story.
- [x] Given the `Post` entity, when its schema is defined, then it reserves nullable extension columns
      for the E8 rumor model (`RumorRef`, `MutationOf` — unused at v0, per `docs/BACKEND_ROADMAP.md` Risk
      1: *"reserve `rumorRef`/`mutationOf` on the `Post` schema even though rumors are v1.1"*) and a
      soft-delete field (nothing hard-deleted during a live exercise, XC-010) — so neither capability
      needs a later breaking migration.
- [x] Given the `TelemetryEvent` entity, when its columns are compared field-by-field to the locked v0
      envelope in `docs/features/telemetry/01-telemetry-emitter-v0.md` (`TelemetryEventV0`), then every
      field has a corresponding column — including the open `payload` extension point stored as a JSON
      column — so the durable store is schema-faithful to the already-shipped client contract, not a
      reinterpretation of it.
- [x] Given a clean database, when the initial EF Core migration is applied, then it succeeds against an
      Azure-SQL-compatible target (collation `SQL_Latin1_General_CP1_CI_AS`, matching
      `infrastructure/modules/database.bicep`), and `dotnet test` includes a test that applies the
      migration and round-trips one row per entity.
- [x] Given `Program.cs` (owned by story 01), when this story registers persistence, then it exposes an
      `AddPulsePersistence(this IServiceCollection, IConfiguration)` extension method (mirroring the
      `AddEngineGeneration(...)` idiom already established in `Pulse.Core`) that registers `PulseDbContext`
      (reading the `ConnectionStrings:DefaultConnection` key `infrastructure/modules/webapp.bicep` already
      provisions) plus a `DbContext` health check — this story does **not** itself edit `Program.cs`; the
      orchestrator adds the one-line call between waves (see `implementation.md`'s Integration seam).
- [x] **Isolation (COR-001/XC-001) — Tier-2, human sign-off required:** every scoped entity's
      `ExerciseId` is a non-nullable `Guid` column enforced `NOT NULL` at the database level by the
      initial migration, **and** a shared `IExerciseScoped` marker plus a `SaveChangesAsync` override
      rejects (throws, before the write reaches the database) any tracked scoped entity whose
      `ExerciseId` is `Guid.Empty`/default. This delivers the **schema and write-time** halves of the
      fail-closed guarantee only — it does not add the read-side global query filter (that is
      `exercise-isolation/01`'s job, extending this same `DbContext` next) and must not be described as
      "isolation is done" on its own.

## Out of Scope
The full E1 entity set (`Organization`, `ParticipantAccount`, `StaffAssignment`, `Cast` — deferred to
`identity-backend`, Phase B2); the read-side EF global query filter and `IExerciseContext`
(`exercise-isolation/01`/`04`, which extend this story's `PulseDbContext` rather than being built here);
any HTTP endpoint or controller that reads or writes these tables (the feed/post read-write APIs belong to
a parallel Phase-B0/B1 feature being authored separately; the telemetry ingest endpoint is
`telemetry/02-telemetry-sink-backend`); handle-uniqueness enforcement on `Persona`/`PersonaTemplate` (open
question, `docs/01-platform-core-isolation.md` §7 Q3 — per-exercise vs org-global is still undecided);
seed data or Cast-library instantiation (COR-021, a later content-authoring story); Cadence's `ScenarioDay`
semantics or any exercise-clock field beyond the bare `Exercise` anchor row (`exercise-clock`'s own future
backend story).

## Technical Notes
World: backend infrastructure — no UI (see `feature.md` Design notes).

Paths: `src/Pulse.WebApi/Data/PulseDbContext.cs`; `src/Pulse.WebApi/Data/Entities/{Exercise,
PersonaTemplate,Persona,Post,TelemetryEvent}.cs`; `src/Pulse.WebApi/Data/Extensions/
PersistenceServiceCollectionExtensions.cs` (the `AddPulsePersistence` export); `src/Pulse.WebApi/Data/
Migrations/` (the initial migration). EF Core packages
(`Microsoft.EntityFrameworkCore.SqlServer`, `Microsoft.EntityFrameworkCore.Design`) go on
`Pulse.WebApi.csproj` only — `Pulse.Core.csproj` is not touched and gains no EF Core dependency; the
engine stays a persistence-agnostic library.

`ExerciseId` as `Guid` matches the convention `Pulse.Core` already uses throughout (e.g.
`Features/ReactionLoop/Models/GenerationIntent.cs`'s `ExerciseId`, `Features/Autonomy/Models/
EngineReviewItem.cs`'s `ExerciseId`) — this story's entities follow the same type for consistency,
without creating a dependency from `Pulse.Core` to EF Core or to this project.

`PulseDbContext` is this story's file to **create**; `exercise-isolation/01` **extends** it (adds
`HasQueryFilter` in `OnModelCreating`) rather than recreating it — the same "create then extend" pattern
already used for `core/exerciseContext.tsx` (`exercise-isolation/10` creates; `exercise-isolation/04`
extends). Document this clearly so a later builder does not stand up a second `DbContext`.

CI note for the orchestrator: `.github/workflows/ci.yml`'s `backend` job runs on `ubuntu-latest`, where
SQL Server LocalDB is unavailable — the test strategy for "applies cleanly against an Azure-SQL-compatible
target" (AC4) will need a Linux-compatible real-SQL-Server test target (e.g. `Testcontainers.MsSql`, which
works on GitHub-hosted Linux runners via Docker) rather than LocalDB; left to `backend-agent`/
`testing-agent` to implement, flagged here since it shapes the test project's dependencies.

See `implementation.md` (story 02) for the full reuse map, Wave Plan, and Integration seam rows.

## Dependencies
`backend-host/01-webapi-host-bootstrap` (the `Pulse.WebApi` project and `Program.cs` this story's
`AddPulsePersistence()` is wired into). Blocks, serially and cross-feature:
`exercise-isolation/01-exercise-scoped-queries` and `telemetry/02-telemetry-sink-backend`.

## Tests
- `Pulse.WebApi.Tests`: a migration test that applies the initial migration to a real SQL Server target
  and round-trips one row per `DbSet`; a `SaveChangesAsync` test asserting a scoped entity with
  `ExerciseId == Guid.Empty` throws before any row is written (the Tier-2 AC); a schema-shape test
  asserting `TelemetryEvent`'s columns match `TelemetryEventV0`'s fields 1:1 (cross-checked against the
  frontend's locked schema, `src/frontend/src/core/telemetry/schema.ts`, by field name/optionality — a
  documented manual check is acceptable if an automated cross-language diff isn't feasible yet).
- `dotnet build pulse.slnx` / `dotnet test pulse.slnx` (CI `backend` job) is the Gate-0 command.
