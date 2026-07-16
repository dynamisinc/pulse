# Story: Telemetry emitter v0 (schema + mock sink)

**Feature:** Telemetry capture (XC-004 v0)  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** XC-004 (COR-018, COR-053, XC-001/COR-001)  ·  **Design decisions:** none  ·  **Issue:** —

## Context
Every participant- or persona-generated event must be captured from day one of Phase 1, and the
adversarial review (`11-ADVERSARIAL-REVIEW.md`, finding D2) is explicit that this schema has no room
for a false start: "a schema mistake becomes a cross-phase migration" — E10's metrics, E9's `INT-031`
event stream, and E8's observation loop all consume this same taxonomy later. This story locks the
**v0 envelope** (below) and ships a working emitter — schema types, a `zod` runtime validator, and a
mock sink — so every later feature that emits an event has a stable contract to build against, with no
backend required yet.

## The v0 envelope (locked — encode verbatim)
This is the **stable** schema. New event kinds/fields extend it via the open `eventType` string and the
`payload` object; the envelope itself does not change without a version bump.

```ts
interface TelemetryEventV0 {
  schemaVersion: 'v0'                 // literal — future breaking changes are detectable
  eventId: string                     // uuid; client-generated in the mock
  exerciseId: string                  // REQUIRED — isolation scope (COR-001/XC-001)
  eventType: string                   // open string — see the v0 known set below
  channel: 'social' | 'portal' | 'news' | 'press' | 'weather' | 'system'
  actor: {
    kind: 'participant' | 'persona' | 'system' | 'engine'
    participantId?: string
    personaId?: string
    actingHumanId?: string           // the individual human behind a shared org account (COR-018)
    sessionId?: string               // ephemeral read-only session identity, reach counting (COR-015)
    role?: string
  }
  origin?: 'participant' | 'controller-as-persona' | 'engine' | 'inject'  // provenance; NEVER
                                                                            // participant-visible
                                                                            // (posts/03-post-provenance.md)
  injectId?: string                   // provenance — set when origin === 'inject'
  wallClockTime: string                // ISO-8601 UTC, real time — telemetry-only, never in fiction
  scenarioTime: string                 // ISO-8601, scenario time (COR-053)
  timeZone: string                     // IANA zone (XC-008)
  target?: {
    entityType?: string
    entityId?: string
  }
  payload?: Record<string, unknown>    // event-type-specific extension point
  emittedAt: string                    // ISO-8601 UTC — when the emitter stamped/sent the event
}
```

**v0 known `eventType` set** (open — not an enum; document, don't constrain): `post`, `reply`,
`reaction`, `repost`, `quote`, `article_view`, `press_release`, `dm`, `login`, `logout`, `follow`,
`view`, `search`, `steering_action`. Engine event types (`engine.observed` / `decided` / `generated` /
`reviewed` / `published` / `measured`, `storyline.state_changed`, and the reserved `rumor.*` family)
extend this set later per `engine-telemetry-tuning/01-engine-event-types.md` — additively, on the same
envelope, no migration.

## Acceptance Criteria
- [ ] `src/frontend/src/core/telemetry/` exports the v0 TypeScript types and a `zod` schema for
      `TelemetryEventV0` matching the envelope above exactly, including the literal
      `schemaVersion: 'v0'`.
- [ ] Given a partial event, when `buildTelemetryEvent(partial)` is called, then it stamps `eventId`
      (generated) and `emittedAt` (now), validates the result against the v0 `zod` schema, and throws
      (or returns a typed error) on an invalid/incomplete event rather than emitting a malformed one.
- [ ] Given a valid event, when `emitTelemetryEvent(event)` is called, then it (a) appends the event to
      an in-memory buffer, (b) logs it to the dev console, and (c) best-effort POSTs it via the shared
      axios client (`core/services/api.ts`) to a mocked `/telemetry` endpoint — a network/mock failure
      is swallowed and never throws back into the caller's action.
- [ ] The buffer is test-inspectable: a documented `getEmittedTelemetryEvents()` (read) and
      `resetTelemetryBuffer()` (reset) exist for use in other features' tests.
- [ ] Every emitted event carries a **required, non-empty `exerciseId`** — `buildTelemetryEvent`/the
      `zod` schema rejects an event missing it (isolation scope, COR-001/XC-001).
- [ ] `origin` and `injectId`, when present, are documented as **never participant-visible** — this
      module has no participant-facing read path; only staff/evaluator surfaces (later features) may
      render them.
- [ ] The v0 known `eventType` set (`post`, `reply`, `reaction`, `repost`, `quote`, `article_view`,
      `press_release`, `dm`, `login`, `logout`, `follow`, `view`, `search`, `steering_action`) is
      documented in the module as the Phase-1 vocabulary, with the schema left open (plain `string`)
      so engine event types extend it later without a migration.

## Out of Scope
Any real backend `/telemetry` endpoint (mocked only — a swallowed-failure POST); wiring `scenarioTime`/
`exerciseId` from `scenarioNow()`/`useExerciseContext()` (that is the **caller's** job — see Technical
Notes); the engine event-type extensions (`engine-telemetry-tuning`); E10's metric computation over
captured events; any UI (this feature has none).

## Technical Notes
World: **platform/foundation** — a pure `core/` module, no UI, no COBRA, no participant skin.

Deliverable: `src/frontend/src/core/telemetry/` with (at minimum) a schema module (TS types + `zod`
schema, zod v4), an emitter module (`emitTelemetryEvent`, `buildTelemetryEvent`), and a mock-sink module
(in-memory buffer + dev-console log + mocked axios POST). `eventId` generation uses the platform's
native `crypto.randomUUID()` — no new dependency needed for uuids.

**Decoupled at v0; wired at the edges later.** This emitter must **not** import `core/exerciseContext`
or `core/clock/scenarioTime` — the three foundation seams (this one, `exercise-isolation/10`,
`exercise-clock/04`) build in parallel, in isolated worktrees, and none may import another at v0.
Callers assemble the event themselves — e.g. a future `PostCard`/compose action calls
`useExerciseContext()` for `exerciseId`/`timeZone` and `scenarioNow()`/`formatScenarioTime` for
`scenarioTime`, then passes those values into `buildTelemetryEvent(...)`. This module only knows the
shape of the envelope, not where its fields come from.

See `implementation.md` (story 01) for the reuse map (single-wave, single-story feature).

## Dependencies
None (Wave 0). Every later event-emitting feature depends on this schema/emitter existing first —
notably `posts` (SOC-003 provenance), `persona-operation`, `identity-auth-roles`, `inject-queue`, and
all of E8, whose `engine-telemetry-tuning` feature **extends** (not forks) this v0 envelope.

## Tests
- Unit: `buildTelemetryEvent` stamps `eventId`/`emittedAt` and validates against the `zod` schema; a
  missing `exerciseId` (or other required field) fails validation rather than emitting.
- Unit: `emitTelemetryEvent` appends to the buffer and logs, and swallows a mock POST failure without
  throwing; `getEmittedTelemetryEvents()`/`resetTelemetryBuffer()` round-trip correctly.
- Unit: a hand-built event using each documented v0 `eventType` string validates against the schema.
