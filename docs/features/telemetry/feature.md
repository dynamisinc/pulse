# Feature: Telemetry capture (XC-004 v0)

**Epic:** E1 — Platform Core & Exercise Isolation  ·  **Phase:** 1  ·  **Feature ref:** XC-004
(cross-cutting; named Phase-1-early design deliverable — Master §5, `11-ADVERSARIAL-REVIEW.md` finding
D2 "SPIKE")
**World:** platform/foundation  ·  **Issue:** #209

## Summary
Every participant- or persona-generated event (post, reply, reaction, view, DM, login, engine action)
is captured against one **stable v0 envelope** from day one of Phase 1 — before E2's posts, E7's
console, or E8's engine exist to emit into it. This is the single most schema-sensitive deliverable in
the product: the adversarial review flagged that "a schema mistake becomes a cross-phase migration"
(finding D2), because E10's metrics, E9's event stream (`INT-031`), and E8's observation loop all read
this same taxonomy later. Locking the envelope now — open `eventType`/`payload` extension points, closed
core fields — is what lets every later feature emit into it without a migration.

## Requirements covered
XC-004 (telemetry capture: wall-clock + scenario timestamp, actor including the human behind a shared
org account per COR-018, and channel, for every participant/persona event). Cross-referenced by
COR-018 (per-human attribution), COR-053 (scenario time), XC-001/COR-001 (exercise scoping —
`exerciseId` is required on every event).

## Design references
`docs/00-MASTER-PRD.md` §5 (XC-004) and §5b. `docs/11-ADVERSARIAL-REVIEW.md` finding D2 ("Telemetry
event schema is nowhere, but capture starts Phase 1" — disposition SPIKE, resolved here as the v0
schema). `docs/FEATURE_ORCHESTRATION_PLAYBOOK.md` (names this the telemetry-schema seam that precedes
consuming surfaces). No design brief exists for this surface — it has no UI.

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Telemetry emitter v0 (schema + mock sink) | XC-004 | Complete | #210 |
| 02 | Telemetry sink (backend `POST /telemetry` ingest + durable store) | XC-004 | Not Started | — |

## Dependencies
Story 01: none (Wave 0 — the first of Pulse's three foundation seams to have zero upstream dependency).
Story 02 (backend sink): **`backend-host`** (Phase B0, `docs/BACKEND_ROADMAP.md` §4) —
`backend-host/01-webapi-host-bootstrap` (the host it mounts in) and `backend-host/02-persistence-efcore`
(the `PulseDbContext`/`DbSet<TelemetryEvent>` it writes through). Consumed by nearly every later feature:
`posts` (SOC-003/provenance), `persona-operation`, `identity-auth-roles`, `inject-queue`, all of E8
(`reaction-loop`, `storyline-model`, `response-reaction`, `silence-escalation`, `amplification-engine`,
`autonomy-safety`, `persona-voice-engine`, `engine-generation-infra`, `engine-telemetry-tuning` — which
**extends** this v0 schema, not forks it), `world-steering`, `evaluation-timeline`, `evaluation-metrics`,
`evaluator-tools`, `aar-export`, `console-shell`, `staff-shell`. None of those are built yet; this feature
exists so they have a stable contract to emit into from the moment each one lands. All of them depend on
story 01 existing (the client-side emitter); none of them need to wait on story 02 (the frontend keeps
emitting through the same mock-sink call regardless of whether the backend sink exists yet).

## Design notes
World: **platform/foundation** — a pure `core/` module (`src/frontend/src/core/telemetry/`); no UI
surface, no COBRA, no participant skin. No backend exists yet, so v0 writes to a **mock sink**: an
in-memory buffer (test-inspectable) plus a dev-console log plus a best-effort mocked POST via the
shared axios client — failures swallowed, never blocking the caller's action. The schema is
**stable by design**: `schemaVersion: 'v0'` is a literal so a future breaking change is detectable, and
new event kinds extend via the open `eventType` string, event-type-specific data via the `payload`
extension point, and cross-cutting metadata via named reserved envelope fields
(`correlationId`/`causationId`/`sequence`/`source`) — all additive, needing no envelope migration. This is one of Pulse's three Wave-0 foundation seams (with
`exercise-isolation/10` and `exercise-clock/04`) and is deliberately **code-decoupled** from the other
two at v0: the emitter does not import scenario-time or exercise-context — callers assemble the event
and pass `scenarioTime` + `exerciseId` in themselves. Wiring (assembling a telemetry event from
`scenarioNow()` + `useExerciseContext()`) happens later, in consumers (the shell mount contract,
`PostCard`, etc.), not in this module.
