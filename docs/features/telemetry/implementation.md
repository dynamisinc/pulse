# Implementation: Telemetry capture (XC-004 v0)

> Single-story feature — single wave. Foundation only: schema + emitter + mock sink, no UI, no
> backend. This is one of Pulse's three Wave-0 foundation seams (with `exercise-isolation/10` and
> `exercise-clock/04`) and ships **code-decoupled** from the other two — it must not import
> `core/exerciseContext` or `core/clock/scenarioTime`. Callers assemble the event (passing in
> `exerciseId`, `timeZone`, `scenarioTime`) rather than this module reaching out to fetch them.

## Per-story tech notes

| Story | Approach | Key files | Exports (that others import) |
|-------|----------|-----------|------------------------------|
| 01 Telemetry emitter v0 | Lock the v0 envelope as TS types + a `zod` schema; a mock sink (in-memory buffer + dev-console log + best-effort mocked axios POST, failures swallowed). | `src/frontend/src/core/telemetry/` (schema, emitter, mock-sink modules) | `TelemetryEventV0` (type), the v0 `zod` schema, `buildTelemetryEvent()`, `emitTelemetryEvent()`, `getEmittedTelemetryEvents()`, `resetTelemetryBuffer()` |

## Reuse map
- Shared axios client — `src/frontend/src/core/services/api.ts` (the mocked `/telemetry` POST goes
  through it; base URL `VITE_API_URL`)
- `zod` (already a dependency, v4) — the v0 schema's runtime validator
- Native `crypto.randomUUID()` — `eventId` generation; no new uuid dependency needed
- Env validation — `core/utils/validateEnv.ts` (not touched by this story; noted for consistency)
- Exercise-context (`exercise-isolation/10`, when it lands) — **not imported by this module.** Callers
  read `exerciseId`/`timeZone` from `useExerciseContext()` and pass them into `buildTelemetryEvent()`.
- Scenario-time (`exercise-clock/04`, when it lands) — **not imported by this module.** Callers read
  `scenarioTime` from `scenarioNow()`/`formatScenarioTime()` and pass it in.

## Wave Plan (DAG-ready)

| Story | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|-------|---------------|------------|--------------|------|--------|
| 01 Telemetry emitter v0 | `core/telemetry/` (schema, emitter, mock-sink) | none | — (Wave-0 seam, parallel with `exercise-isolation/10` and `exercise-clock/04` in other features — code-decoupled, no shared files) | 0 | M |

Story 01 is a Wave-0 primitive: it has zero upstream dependency and ships before any feature that emits
into it. Every later event-emitting feature (`posts`, `persona-operation`, `identity-auth-roles`,
`inject-queue`, all of E8, `world-steering`, `evaluation-timeline`, `console-shell`, `staff-shell`, ...)
depends on this schema/emitter existing first — that is a serial edge into each of those features' own
wave plans, not modeled here.
