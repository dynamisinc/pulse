# Story: Telemetry sink (backend `POST /telemetry` ingest + durable store)

**Feature:** Telemetry capture (XC-004 v0)  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** XC-004  ·  **Design decisions:** none  ·  **Issue:** —

## Context
`telemetry/01-telemetry-emitter-v0` (Complete) already ships the locked v0 envelope and a client-side mock
sink that "best-effort POSTs it via the shared axios client... to a mocked `/telemetry` endpoint — a
network/mock failure is swallowed and never throws back into the caller's action"
(`src/frontend/src/core/telemetry/mockSink.ts`). That endpoint has never existed. This story builds the
real one: server-side validation of the same v0 envelope, and a durable store via `backend-host/02`'s
`PulseDbContext`/`DbSet<TelemetryEvent>`. It turns "the swallowed fire-and-forget into a real sink"
(`docs/BACKEND_ROADMAP.md` §4 Phase B0), and needs **no frontend code change** — `mockSink.ts`'s existing
`api.post('/telemetry', event)` call already targets this contract; the only integration action is
pointing `VITE_API_URL` at the deployed host (the mock→live flip, orchestrator-owned — see
`implementation.md`).

World: backend infrastructure — no UI (this feature has none; see `feature.md`).

## Acceptance Criteria
- [ ] Given a client POSTs a well-formed `TelemetryEventV0` JSON body to `POST /api/telemetry` (the same
      path shape `core/telemetry/mockSink.ts` already calls), when the request arrives, then the server
      validates it against the same v0 shape the client's `zod` schema enforces and persists it as one
      row via `backend-host/02`'s `DbSet<TelemetryEvent>`.
- [ ] Given a malformed or schema-invalid body (missing/empty `exerciseId`, a `schemaVersion` other than
      `'v0'`, an unrecognized top-level key), when it is POSTed, then the endpoint responds `400` and the
      event is **not** persisted — the server does not trust the client-side `zod` validation alone
      (defense in depth).
- [ ] Given the same `eventId` is POSTed twice (the documented client retry-after-swallowed-failure case
      in `mockSink.ts`'s header comment), when the second POST arrives, then it is deduplicated — no
      duplicate row, no error surfaced to the caller.
- [ ] Given `dotnet test` runs, then `Pulse.WebApi.Tests` includes an integration test
      (`WebApplicationFactory`, reusing `backend-host/01`'s test-host pattern) that POSTs a
      fully-populated v0 envelope and asserts it round-trips out of `PulseDbContext` unchanged
      (field-for-field).
- [ ] **Telemetry schema fidelity (XC-004 v0):** the accepted/stored shape matches the identical v0
      envelope locked in `docs/features/telemetry/01-telemetry-emitter-v0.md` — same field names, types,
      and optionality; the literal `schemaVersion: 'v0'`; the open `eventType` string; the reserved
      `correlationId`/`causationId`/`sequence`/`source` fields carried through unchanged. A drift between
      the client-locked schema and what the server accepts/stores is a contract break, not "the server
      just interprets it differently."
- [ ] **Content security (NFR-004):** the endpoint enforces a request-body size cap and rejects (`400`) a
      request exceeding it; free-text-bearing fields (`payload`, `target`) are stored as opaque, untrusted
      data — never HTML-rendered by this story (no read/render path exists yet) — and are written via
      parameterized EF Core operations only (no raw SQL string interpolation).

## Out of Scope
Per-session/hostname authorization of the `exerciseId` claim — this story validates the envelope's
**shape**, not session-bound **authority**; that arrives with `exercise-isolation/01`/`04` and, for
telemetry specifically, is not retrofitted in this pass. Any read/query API over stored telemetry (E10's
evaluator dashboard — `evaluation-backend/01-telemetry-queries`, Phase B4). Client-side sink changes
(batching, `navigator.sendBeacon` on unload, the mock sink's bounded-buffer behavior) — `telemetry/01`'s
emitter and mock sink are unmodified by this story. Rate limiting / abuse resistance beyond the size cap
(NFR-009 full abuse resistance is `evaluation-backend` hardening scope). SignalR / real-time fan-out
(unrelated to telemetry ingest; that's `social-api/03-signalr-feed-host`, Phase B1).

## Technical Notes
World: backend infrastructure — no UI (see `feature.md` Design notes).

Paths: `src/Pulse.WebApi/Telemetry/TelemetryController.cs` (or an equivalent minimal-API mapping), plus a
request/validation model distinct from the frontend's `zod` schema but shape-identical to it.

Because `backend-host/01` already registers `AddControllers()`/`MapControllers()`, this story adds a new
`[ApiController]` and needs **no** `Program.cs` edit — the orchestrator's only integration action for this
story is the mock→live client flip (pointing `VITE_API_URL` at the deployed host once this story is
Gate-2 clean), not a composition-root edit. See `implementation.md`'s Integration seam table.

Route note: mounted under the conventional `/api` prefix (`POST /api/telemetry`) to match the existing
default baked into `src/frontend/src/core/services/api.ts` (`baseURL: VITE_API_URL || '/api'`) and
`.env.example`'s framing ("Leave blank to point the shared axios client at same-origin `/api`") — so a
production `VITE_API_URL` value is expected to include the `/api` suffix (e.g.
`https://app-pulse-api-{env}.azurewebsites.net/api`) rather than the bare App Service root. This is a
deploy-config convention, not something this story enforces in code; flagged for the orchestrator in case
the eventual deploy wiring assumes otherwise.

See `implementation.md` for the reuse map and Wave Plan row (`stack: backend`).

## Dependencies
`backend-host/01-webapi-host-bootstrap` (the host this controller mounts in) and
`backend-host/02-persistence-efcore` (the `PulseDbContext`/`DbSet<TelemetryEvent>` this story writes
through). `telemetry/01-telemetry-emitter-v0` (Complete) — the v0 envelope this story is faithful to.

## Tests
- `Pulse.WebApi.Tests`: valid-envelope round-trip; invalid-envelope 400/not-persisted; duplicate-`eventId`
  idempotency; oversized-body 400. Cross-checked by hand against
  `src/frontend/src/core/telemetry/schema.test.ts`'s fixtures for shape parity until an automated
  cross-language contract test exists.
- `dotnet build pulse.slnx` / `dotnet test pulse.slnx` (CI `backend` job) is the Gate-0 command.
