# Implementation: Telemetry capture (XC-004 v0)

> Two stories now. Story 01 (Wave 0, frontend, **Complete**): schema + emitter + mock sink, no UI, no
> backend. This is one of Pulse's three Wave-0 foundation seams (with `exercise-isolation/10` and
> `exercise-clock/04`) and ships **code-decoupled** from the other two — it must not import
> `core/exerciseContext` or `core/clock/scenarioTime`. Callers assemble the event (passing in
> `exerciseId`, `timeZone`, `scenarioTime`) rather than this module reaching out to fetch them.
> Story 02 (Phase B0, backend, Not Started): the real `POST /telemetry` ingest the mock sink already
> fire-and-forgets to — see `docs/BACKEND_ROADMAP.md` §4 Phase B0 and `docs/features/backend-host/`.

## Per-story tech notes

| Story | Approach | Key files | Exports (that others import) |
|-------|----------|-----------|------------------------------|
| 01 Telemetry emitter v0 | Lock the v0 envelope as TS types + a `zod` schema; a mock sink (in-memory buffer + dev-console log + best-effort mocked axios POST, failures swallowed). | `src/frontend/src/core/telemetry/` (schema, emitter, mock-sink modules) | `TelemetryEventV0` (type), the v0 `zod` schema, `buildTelemetryEvent()`, `emitTelemetryEvent()`, `getEmittedTelemetryEvents()`, `resetTelemetryBuffer()` |
| 02 Telemetry sink (backend) | ASP.NET Core controller (`Pulse.WebApi`) validates the same v0 envelope server-side (defense in depth, not trusting the client `zod` check alone), dedupes on `eventId`, and persists through `PulseDbContext`'s `DbSet<TelemetryEvent>` (`backend-host/02`). No frontend change — `mockSink.ts`'s existing POST already targets this contract. | `src/Pulse.WebApi/Telemetry/TelemetryController.cs` (or an equivalent minimal-API mapping) | The durable `POST /api/telemetry` endpoint — the first real consumer of `backend-host/02`'s `DbSet<TelemetryEvent>` |

## Reuse map
- Shared axios client — `src/frontend/src/core/services/api.ts` (the mocked `/telemetry` POST goes
  through it; base URL `VITE_API_URL`)
- `zod` (already a dependency, v4) — the v0 schema's runtime validator
- Native `crypto.randomUUID()` — `eventId` generation; no new uuid dependency needed
- Env validation — `core/utils/validateEnv.ts` (not touched by this story; noted for consistency)
- Backend host + persistence (`backend-host`, Phase B0) — `src/Pulse.WebApi/` (`backend-host/01`, already
  registers `AddControllers()`/`MapControllers()` — story 02 adds a controller with **no** `Program.cs`
  edit) and `PulseDbContext`/`DbSet<TelemetryEvent>` (`backend-host/02`,
  `src/Pulse.WebApi/Data/PulseDbContext.cs`) — story 02 writes through it; it does not define its own
  store.
- Exercise-context (`exercise-isolation/10`, when it lands) — **not imported by this module.** Callers
  read `exerciseId`/`timeZone` from `useExerciseContext()` and pass them into `buildTelemetryEvent()`.
- Scenario-time (`exercise-clock/04`, when it lands) — **not imported by this module.** Callers read
  `scenarioTime` from `scenarioNow()`/`formatScenarioTime()` and pass it in.

## Wave Plan (DAG-ready)

| Story | Stack | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|-------|---------------|------------|--------------|------|--------|
| 01 Telemetry emitter v0 | frontend | `core/telemetry/` (schema, emitter, mock-sink) | none | — (Wave-0 seam, parallel with `exercise-isolation/10` and `exercise-clock/04` in other features — code-decoupled, no shared files) | 0 | M |
| 02 Telemetry sink (backend) | backend | `src/Pulse.WebApi/Telemetry/` (controller + server-side validation) | `backend-host/01`, `backend-host/02` | — (cross-feature serial edge into `backend-host`'s own chain; no other Phase-B0 story shares its file footprint) | 2 | M |

`Stack: backend` on story 02 tells the orchestrator to spawn `backend-agent` and gate with
`dotnet build pulse.slnx && dotnet test pulse.slnx` — no frontend gate applies to it (see
`ORCHESTRATION_MECHANICS.md` §5).

Story 01 is a Wave-0 primitive: it has zero upstream dependency and ships before any feature that emits
into it. Story 02 is the real backend half of the same seam — it depends on `backend-host`'s own serial
chain (`01-webapi-host-bootstrap` → `02-persistence-efcore`, `docs/BACKEND_ROADMAP.md` §4 Phase B0) as a
cross-feature serial edge, not modeled as a wave in `backend-host`'s own Wave Plan (see
`docs/features/backend-host/implementation.md`). Every later event-emitting feature (`posts`,
`persona-operation`, `identity-auth-roles`, `inject-queue`, all of E8, `world-steering`,
`evaluation-timeline`, `console-shell`, `staff-shell`, ...) still depends on story 01's schema/emitter
existing first on the frontend; none of them need to wait on story 02 to emit client-side (the mock sink
keeps swallowing failures until the real endpoint is live) — story 02 only changes where those
already-emitted events end up.
