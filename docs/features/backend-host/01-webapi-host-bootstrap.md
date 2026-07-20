# Story: WebApi host bootstrap (composition root, health, CORS, App Insights)

**Feature:** Backend host & persistence foundation  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** none (foundation substrate — Master PRD §6; unblocks COR-001/002/007, COR-050, XC-004, NFR-006)  ·  **Design decisions:** none  ·  **Issue:** —

## Context
Pulse today is "two well-built halves with no middle" (`docs/BACKEND_ROADMAP.md` §1): a feature-rich
frontend that fails closed to mock data, and a mature `Pulse.Core` engine that is "a library island" —
"no ASP.NET Core, no EF Core... the only runnable artifact is `Pulse.Playground`, whose header reads
'There is no runtime yet.'" This story is the first runtime: a `Pulse.WebApi` ASP.NET Core Web API
project that hosts the engine's already-built DI composition (`AddEngineGeneration`,
`src/Pulse.Core/Core/Extensions/ServiceCollectionExtensions.cs`) for the first time, with the
health/CORS/config/telemetry scaffolding every later backend story builds on. It is Phase B0's first link
(`docs/BACKEND_ROADMAP.md` §4) — build first, serial, before anything consumer-facing.

Adding `Pulse.WebApi` to `pulse.slnx` is also what turns the already-wired CI `backend` job
(`.github/workflows/ci.yml`) from a job that builds/tests `Pulse.Core` alone into one that gates a real
host — no CI file change needed, per `docs/BACKEND_ROADMAP.md` §2.3.

World: backend infrastructure — a headless host, not a UI in either world (see `feature.md` Design
notes).

## Acceptance Criteria
- [ ] Given `pulse.slnx`, when `dotnet restore && dotnet build pulse.slnx --configuration Release` runs
      (the CI `backend` job's exact command), then a new `Pulse.WebApi` ASP.NET Core Web API project
      (targeting `net10.0`, matching `Pulse.Core`'s `Nullable`/`ImplicitUsings`/`AnalysisMode=Recommended`
      settings) is part of the build graph and compiles clean; a sibling `Pulse.WebApi.Tests` xUnit
      project (mirroring `Pulse.Core.Tests`'s package set) is added alongside it.
- [ ] Given the host starts, when `Program.cs` calls `builder.Services.AddEngineGeneration(builder.
      Configuration)` (the existing, unmodified `Pulse.Core` extension method), then the generation
      provider, prompt assembler, and tier policy resolve from DI with zero changes to
      `ServiceCollectionExtensions.cs` or any file under `Pulse.Core` — this story is a pure consumer of
      the existing engine seam.
- [ ] Given the host is running, when a client sends `GET /health`, then it returns `200 OK` with a body
      indicating liveness, with no dependency on a database connection (persistence lands in story 02).
- [ ] Given a request whose `Origin` header matches the configured frontend origin (the same
      `Authentication__FrontendBaseUrl`-equivalent config key `infrastructure/modules/webapp.bicep`
      already provisions for the Static Web App's URL), when a CORS preflight or simple request arrives,
      then it is allowed; given an unlisted origin, then it is rejected.
- [ ] Given `APPLICATIONINSIGHTS_CONNECTION_STRING` is present in configuration (as
      `infrastructure/modules/webapp.bicep` already provisions it as an app setting), when the host
      starts, then Application Insights telemetry (requests, dependencies, traces) is wired; given it is
      absent (local development), the host still starts cleanly — a missing connection string is never a
      startup failure.
- [ ] Given `dotnet test pulse.slnx --configuration Release --no-build` runs, then `Pulse.WebApi.Tests`
      includes at least one `WebApplicationFactory<Program>`-based integration test asserting the host
      boots and `GET /health` returns 200 — closing the CI backend gate on a real assertion about this
      story, not only "it compiles."

## Out of Scope
Any database/EF Core (story 02); the exercise-isolation query filter or `IExerciseContext`
(`exercise-isolation/01`/`04`, blocked on story 02); the telemetry ingest endpoint (`telemetry/02`,
blocked on story 02); SignalR, controllers beyond health, authentication/session handling, and the
reaction-loop runtime (Phases B1–B3); flipping `infrastructure/main.bicep`'s `deployBackend`/
`deployMonitoring` toggles to `true` or any actual Azure deployment (a separate, deliberate ops action,
not part of authoring the host).

## Technical Notes
World: backend infrastructure — no UI, no participant skin, no COBRA (see `feature.md` Design notes).

Paths: `src/Pulse.WebApi/` (new project, sibling to `src/Pulse.Core/`, `src/Pulse.Core.Tests/`,
`src/Pulse.Playground/` in `pulse.slnx`'s `/src/` folder) — `Pulse.WebApi.csproj`, `Program.cs`,
`appsettings.json` / `appsettings.Development.json`; `src/Pulse.WebApi.Tests/` (new xUnit project,
`WebApplicationFactory`-based).

Reuses `AddEngineGeneration(IServiceCollection, IConfiguration)` exactly as `Pulse.Playground`'s
`Program.cs` header already anticipates: *"which the reaction-loop, E7 cockpit and E2 publish will drive
for real"* — this story is the "for real" half of that sentence; the reaction-loop wiring itself is
Phase B3 (`engine-runtime`), out of scope here.

Config keys deliberately reuse what `infrastructure/modules/webapp.bicep` already provisions as App
Service app settings — do not invent parallel keys: `APPLICATIONINSIGHTS_CONNECTION_STRING`,
`Authentication__FrontendBaseUrl` (CORS origin), `ASPNETCORE_ENVIRONMENT`. `ConnectionStrings__
DefaultConnection` is also already provisioned in that Bicep module but is not consumed until story 02.

Standard ASP.NET Core idiom: register `AddControllers()` + `AddHealthChecks()` once, in this story;
`app.MapControllers()` + `app.MapHealthChecks("/health")` once, in this story. This is a deliberate design
choice for the Integration seam (see `implementation.md`): because controller discovery is automatic,
most *future* endpoint-adding stories (the telemetry sink, and beyond B0, feed/post APIs) add a new
`[ApiController]` class and need **no** `Program.cs` edit at all — only a story that adds a *new DI
registration* (like story 02's `AddPulsePersistence`) needs the orchestrator to add one line to
`Program.cs`, serially, between waves.

See `implementation.md` (story 01) for the full reuse map and Wave Plan.

## Dependencies
None (Wave 1, first story in Phase B0). Blocks story 02 and, transitively,
`telemetry/02-telemetry-sink-backend` and `exercise-isolation/01-exercise-scoped-queries`.

## Tests
- `src/Pulse.WebApi.Tests/`: a `WebApplicationFactory<Program>` integration test asserting `GET /health`
  returns 200; a DI-resolution test asserting `IGenerationProvider`/`IPromptAssembler`/`ITierPolicy`
  resolve from the host's service provider (proving `AddEngineGeneration` wiring, not re-testing
  `Pulse.Core`'s own already-covered internals); a CORS test asserting an unlisted origin is rejected.
- `dotnet build pulse.slnx` / `dotnet test pulse.slnx` (CI `backend` job, `.github/workflows/ci.yml`) is
  the Gate-0 command this story must pass.
