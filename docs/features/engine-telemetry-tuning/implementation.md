# Implementation: Engine telemetry & tuning

> ADP-041 engine-action logging extending the XC-004 v0 schema + the tuning/observability surface.
> Backend .NET absent; the event types + query surface are the seams. Schema mistakes are cross-phase
> migrations (adversarial review D2) — extend XC-004, do not fork it.

## Per-story tech notes

| Story | Approach | Key files it will own | Exports (the seam others import) |
|-------|----------|-----------------------|----------------------------------|
| 01 Engine event types | Additive event types on the XC-004 envelope; every E8 feature emits them; reserve `rumor.*` + lineage. | `telemetry/engineEvents` (schema) | the engine event-type definitions every E8 feature emits |
| 02 Tuning & observability surface | Read/query view over the engine event log; overlay data for E10. | `services/tuning/observability` | query API + EVL-014 overlay data for E10 |
| 03 AI generation usage panel | Three serial edges (backend read API → backend price table/rollup → frontend panel), decomposed below into 03a/03b/03c. Read `TelemetryEvent` as **entities** so `PulseDbContext`'s central query filter applies (never a bespoke `ExerciseId` predicate over raw/aggregate SQL); project only `Payload` + `WallClockTime`; deserialize into the emitter's own `EngineEventPayloads.Generated`; aggregate in a pure function. Price table is config-sourced (`appsettings`, keyed by provider+model), never a hardcoded switch — Foundry deployments are not version-pinned. First telemetry *read* endpoint in the repo — needs a `WebApplicationFactory<Program>` composition-root route guard (slice-level TestServer tests alone are not sufficient evidence in this repo). | 03a: a new query method on `EngineReviewService` or a new `Telemetry` read slice (`GET /api/engine/usage` or similar) + the pure aggregation function. 03b: `Generation:Pricing:*`-style config section + a cost-rollup function keyed off 03a's aggregation, with an explicit "unpriced" state. 03c: `UsagePanel.tsx` + `useEngineUsage.ts` under `features/controller/engine/components/`. | 03a exports the volume-aggregation contract 03b and 03c both consume; 03b exports the priced-rollup shape 03c renders; 03c exports nothing further (leaf UI). |

## Reuse map
- **XC-004 v0 telemetry emitter (E1)** — the base envelope + emitter; engine events extend it (additive), never fork it.
- Every E8 feature — emits these event types (reaction-loop, storyline-model, response-reaction, autonomy-safety, amplification-engine, silence-escalation).
- **E10** — the primary consumer (timeline, replay, metrics); this surface feeds it.
- **E9 INT-031** — shares the taxonomy (the event stream).
- **EVL-014** — dial-input overlay semantics (designed vs participant-driven pressure).
- storyline-model — the curve/rate-cap/threshold config a tuner adjusts.
- **Story 03 additionally reuses:** `EngineEventPayloads.Generated`
  (`src/Pulse.WebApi/Features/EngineRuntime/Telemetry/EngineEventPayloads.cs:84`) — the emitter's own
  payload record; the read side deserializes into this shape, it does not redefine it. The existing
  `/api/engine` route group and its two authorization filters
  (`EngineCockpitStaffAuthorizationFilter` — every assigned staff caller, the group the existing
  read-only `GET /api/engine/review-queue` / `GET /api/engine/settings` sit on;
  `EngineCockpitControllerRoleFilter` — the additional controller-role gate on mutating routes,
  `EngineReviewEndpoints.cs`) — a usage-panel read is observability like the existing GETs, so it is
  expected to sit on the staff-only group rather than invent a third auth mechanism. `GET
  /api/engine/settings`'s `EngineSettingsDto.Provider` field — AC1 reuses this value directly rather
  than computing a second provider readout. `PulseDbContext`'s central query filter
  (`HasQueryFilter(e => e.ExerciseId == _currentExerciseId)`, `Data/PulseDbContext.cs`) — the usage
  query must run as an EF entity query over `TelemetryEvent` so this filter (not a hand-written
  predicate) is what enforces isolation.

## Wave Plan (DAG-ready)

| Story | Stack | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|-------|---------------|------------|--------------|------|--------|
| 01 Engine event types | backend | telemetry/engineEvents | E1 XC-004 v0 emitter | — | 1 | M |
| 02 Tuning & observability surface | fullstack | services/tuning/observability | 01, E10 consumer contract, EVL-014 | — | 2 | M |
| 03a Usage read API | backend | new query method on `EngineReviewService` (or a new `Telemetry` read slice) exposing a usage-aggregation endpoint under `/api/engine`; the pure volume-aggregation function (provider/model buckets, token categories, latency, guard-result mix) | 01 (`engine.generated` payload shape); `EngineCockpitStaffAuthorizationFilter` (reuse map) | 03b | 3 | M |
| 03b Price table + cost rollup | backend | config-sourced per-model price table (`appsettings` section, keyed by provider+model); the cost-rollup function consuming 03a's aggregation output; the explicit "unpriced" state | 03a's aggregation shape (same wave; not its output, its contract) | 03a | 3 | S |
| 03c Usage panel (frontend) | frontend | `UsagePanel.tsx`, `useEngineUsage.ts` under `features/controller/engine/components/` | 03a + 03b (contract; serial — no codegen, the endpoint/DTO shape is the seam); `GET /api/engine/settings`'s `provider` field (AC1 reuse) | — | 4 | M |

Event types first (01) — they are the shared dependency every other E8 feature emits against, so this
is near-foundation and should land early alongside storyline-model. The observability surface (02) is
a view over them. Frontend→backend edge serial; the event schema is the seam E10/E9 consume.

**Story 03 is a three-edge serial split** (backend read API → backend price table/cost rollup →
frontend panel), not one fullstack story, following the same shape `autonomy-safety/implementation.md`
used to split its engine-settings story into a backend edge (05) and a strict frontend-after-backend
serial edge (06). 03a and 03b both run wave 3 and can proceed in parallel with each other (03b needs
03a's aggregation *contract*, agreed at the top of the wave, not its built output) since their file
footprints are disjoint (a new query/aggregation method vs. a new config section + rollup function);
03c is wave 4, strictly after both, because the frontend hook has nothing to call until the endpoint
and DTO shape exist — there is no codegen step, so this is a serial edge, not a can-run-with.

### Integration seam (orchestrator-owned — never a wave story)
Story 03a adds the **first telemetry *read* endpoint** anywhere in `Pulse.WebApi` (today there is only
`POST /api/telemetry` ingest plus the engine slice's own `GET /api/engine/review-queue` / `GET
/api/engine/settings`). This repo has merged fully-green slices whose `Program.cs` wiring never
executed (composition-root dead-wiring class), so slice-level TestServer tests are not sufficient
evidence for this story. The orchestrator (or 03a's own PR, if the endpoint is added to the
already-wired `EngineReviewEndpoints.cs` `Map*`/`Add*` pair) must add or extend a
`WebApplicationFactory<Program>` composition-root route guard that boots the real host and asserts the
new route resolves and returns data through the real wiring — following the pattern in
`Pulse.WebApi.Tests/Features/Ops/Bootstrap/CompositionRootWiringTests.cs` and
`Pulse.WebApi.Tests/Features/EngineRuntime/Steering/SteeringCompositionRootWiringTests.cs`. If the
endpoint instead lands on a brand-new `Telemetry` read slice (the open design question above), that
slice's own `Add*`/`Map*` wiring into `Program.cs` is an orchestrator-owned, serial edit — no builder
wires it — and needs the same guard.
