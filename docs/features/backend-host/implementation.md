# Implementation: Backend host & persistence foundation

> Phase B0 (`docs/BACKEND_ROADMAP.md` §4) — the load-bearing tier. **Serial, not fan-out**: two stories,
> a straight dependency line (host → persistence), built and Gate-1/Gate-2 reviewed in order. Nothing
> consumer-facing (a controller, a query, an endpoint) is safe to build until both land. This is where
> the `backend-agent` role and the already-wired-but-never-exercised CI `backend` job
> (`.github/workflows/ci.yml`) carry their first real story.

## Per-story tech notes

| Story | Approach | Key files | Exports (that others import) |
|-------|----------|-----------|-------------------------------|
| 01 WebApi host bootstrap | New `Pulse.WebApi` ASP.NET Core Web API project. `Program.cs` calls the existing `AddEngineGeneration(configuration)` (`Pulse.Core`, unmodified), registers `AddControllers()` + `AddHealthChecks()` (so future controllers self-register with no further `Program.cs` edits), CORS (SWA origin from the same config key `webapp.bicep` already provisions), and Application Insights (`APPLICATIONINSIGHTS_CONNECTION_STRING`, already provisioned). Adds a sibling `Pulse.WebApi.Tests` xUnit project (`WebApplicationFactory`-based). | `src/Pulse.WebApi/{Pulse.WebApi.csproj,Program.cs,appsettings*.json}`; `src/Pulse.WebApi.Tests/` | The running host; `GET /health`; the CORS/App-Insights/controller-discovery registrations every later story builds on; `Program.cs` itself (becomes orchestrator-owned from story 02 onward — see Integration seam) |
| 02 Persistence (EF Core) | `PulseDbContext` (EF Core SqlServer) + the minimal walking-skeleton entity set (`Exercise`, `PersonaTemplate`, `Persona`, `Post`, `TelemetryEvent`) under `Data/`; a shared `IExerciseScoped` marker + `SaveChangesAsync` write-time guard (fail-closed on a default `ExerciseId`); an `AddPulsePersistence(configuration)` extension method (mirrors `AddEngineGeneration`'s idiom) that the orchestrator wires into `Program.cs`; the initial migration. | `src/Pulse.WebApi/Data/{PulseDbContext.cs,Entities/*.cs,Extensions/PersistenceServiceCollectionExtensions.cs,Migrations/*}` | `PulseDbContext` (create-then-extend seam for `exercise-isolation/01`), `IExerciseScoped`, `AddPulsePersistence()`; `DbSet<TelemetryEvent>` (written by `telemetry/02`), `DbSet<Post>`/`DbSet<Persona>` (read/written by the parallel social-api feature once it lands) |

## Reuse map
- Engine DI — `src/Pulse.Core/Core/Extensions/ServiceCollectionExtensions.cs` (`AddEngineGeneration(IServiceCollection, IConfiguration)`) — called once from `Program.cs` (story 01), unmodified. This is the *only* thing `Pulse.Core` exports that this feature consumes; no other engine file changes.
- Frozen frontend telemetry seam — `src/frontend/src/core/telemetry/mockSink.ts` (the `api.post('/telemetry', event)` fire-and-forget call this feature's future sink, `telemetry/02`, answers — see that story) and `src/frontend/src/core/services/api.ts` (`baseURL: VITE_API_URL || '/api'` — the client the orchestrator eventually points at this host).
- Authored Bicep — `infrastructure/modules/webapp.bicep` (the App Service app-setting keys this host's config must match verbatim: `ConnectionStrings__DefaultConnection`, `APPLICATIONINSIGHTS_CONNECTION_STRING`, `Authentication__FrontendBaseUrl` for CORS — do not invent parallel keys), `infrastructure/modules/database.bicep` (Azure SQL — `GP_S_Gen5` serverless, collation `SQL_Latin1_General_CP1_CI_AS` — the migration target), `infrastructure/modules/appinsights.bicep` (connection-string shape). `infrastructure/main.bicep`'s `deployDatabase`/`deployBackend`/`deployMonitoring` toggles stay `false` until this feature is ready to deploy — flipping them is a deploy-config change outside this feature's docs footprint.
- `pulse.slnx` / `.github/workflows/ci.yml` — the existing `backend` CI job already runs `dotnet build/test pulse.slnx`; adding `Pulse.WebApi` (+ `Pulse.WebApi.Tests`) to the `.slnx` is sufficient to bring both under Gate 0 — **no CI file change needed**.
- `global.json` — pins SDK `10.0.100` / `net10.0`; `Pulse.WebApi` and `Pulse.WebApi.Tests` target the same TFM as `Pulse.Core`/`Pulse.Core.Tests`.
- Existing `Guid ExerciseId` convention — `Pulse.Core` already scopes engine contracts this way (`Features/ReactionLoop/Models/GenerationIntent.cs`, `Features/Autonomy/Models/EngineReviewItem.cs`) — story 02's entities follow the same type/naming convention for consistency, without adding an EF Core dependency *to* `Pulse.Core`.
- `Pulse.Core.Tests.csproj`'s package set (xUnit, `Microsoft.NET.Test.Sdk`, FluentAssertions, Moq, coverlet) — the template for `Pulse.WebApi.Tests.csproj`, plus `Microsoft.AspNetCore.Mvc.Testing` for `WebApplicationFactory`.

## Wave Plan (DAG-ready)

| Story | Stack | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|-------|----------------|------------|---------------|------|--------|
| 01 WebApi host bootstrap | backend | `src/Pulse.WebApi/{Pulse.WebApi.csproj,Program.cs,appsettings*.json}`, `src/Pulse.WebApi.Tests/` | none | — (serial chain, solo) | 1 | M |
| 02 Persistence (EF Core) | backend | `src/Pulse.WebApi/Data/**` | 01 | — (serial chain, solo) | 2 | L |

`Stack: backend` on both rows tells the orchestrator to spawn `backend-agent` and gate with
`dotnet build pulse.slnx && dotnet test pulse.slnx` (see `ORCHESTRATION_MECHANICS.md` §5) — no frontend
gate applies to either story.

**Cross-feature fan-out from story 02 (not modeled as extra waves here).** Two Phase-B0 stories in
*other* features depend on `backend-host/02` landing, as a serial edge, matching the roadmap's chain
"host(01) → persistence(02) → [telemetry sink + isolation filter]" (`docs/BACKEND_ROADMAP.md` §4, §7.2):
`telemetry/02-telemetry-sink-backend` (writes through `DbSet<TelemetryEvent>` — see
`docs/features/telemetry/implementation.md`) and `exercise-isolation/01-exercise-scoped-queries` (extends
`PulseDbContext.OnModelCreating` with the read-side global query filter — see
`docs/features/exercise-isolation/implementation.md`). Those two stories are **not** file-footprint
disjoint from *each other* in a way that matters here (different features, different files) and, once
`backend-host/02` is Gate-2 clean, can proceed independently/in parallel — but each is sequenced within
its own feature's Wave Plan, not this one.

### Integration seam (orchestrator-owned — never a wave story)

| Seam | File(s) | Rule |
|------|---------|------|
| Backend composition root | `src/Pulse.WebApi/Program.cs` | Story 01 authors its initial skeleton (solo, Wave 1, no parallel-merge risk). From Wave 2 onward, **every** story that needs a new DI registration (persistence today; later the isolation filter's services, the engine-runtime host, etc.) owns an `Add{X}()`/`Map{X}()` extension method in **its own file**; the orchestrator adds the one-line call into `Program.cs` serially, between waves, in its own commit — mirroring exactly how `src/frontend/src/App.tsx` is handled. No builder branch other than 01's initial one may edit `Program.cs` directly. Endpoint-only additions (a new `[ApiController]`, e.g. `telemetry/02`'s controller) need **no** `Program.cs` edit at all, because story 01 already registers `AddControllers()`/`MapControllers()` once — this halves how often the seam is actually touched. |
| Frontend mock→live flip | `src/frontend/src/core/config/mockData.ts` (`USE_MOCK_DATA`) + each service adapter (callers of `src/frontend/src/core/services/api.ts`) | Stays orchestrator-owned and **untouched by every Phase-B0 story** — B0 ships no frontend-visible endpoint yet (host/DI/schema only). The first real flip candidate is `telemetry/02-telemetry-sink-backend`: once its `POST /api/telemetry` is Gate-2 clean, the orchestrator (not a builder) may point a deployed `VITE_API_URL` at the real host — a serial deploy-config edit outside any story's file footprint. Until then this seam is inert for B0. |
| `PulseDbContext.OnModelCreating` | `src/Pulse.WebApi/Data/PulseDbContext.cs` | Not a wave-fan-out seam (only one known future extender at this phase) — story 02 **creates** it; `exercise-isolation/01` (a different feature, serially after 02) directly **extends** it with the read-side global query filter, the same "create then extend" pattern already used for `core/exerciseContext.tsx` (`exercise-isolation/10` creates → `exercise-isolation/04` extends). Documented here so a future builder does not stand up a second `DbContext`. Unlike the two rows above, this one *is* a normal serial story dependency (declared in `exercise-isolation/01`'s own Depends-on), not an orchestrator-only edit — listed here for visibility since it is the seam this whole feature exists to hand off. |
