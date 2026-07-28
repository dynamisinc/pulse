# Story: `POST /api/telemetry` server-stamps `exerciseId` from session scope

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** XC-004 (with COR-001 implicated)  ·  **Design decisions:** none  ·  **Issue:** #362
**Stack:** backend  ·  **Review:** Tier-2 (auth surface + the isolation seam — always-Critical class)

> **Split from [`11-api-session-enforcement.md`](11-api-session-enforcement.md) (#361), Wave 2** — a
> different file (`Telemetry/TelemetryController.cs`, not `Features/Social/*`) and a genuinely distinct
> open question (below) from story 12's `POST /api/posts` attribution, which is why it is kept as its own
> story rather than folded in. Previously tracked standalone as **#362**; retitled and rescoped here.

## Context
`TelemetryController`'s own doc comment (`Telemetry/TelemetryController.cs:18-19`) records this as
a known, explicit carve-out: *"Out of scope (by story): per-session/hostname authority of the
`exerciseId` claim."* The controller accepts `exerciseId` **as a string traveling in the client's
event envelope** (`:94-100`) and persists it verbatim after only a `Guid.TryParse`/non-empty
check — no comparison against any server-resolved scope.

**Confirmed exploit (audit finding #2), against the sandbox, no credential:** two `POST
/api/telemetry` calls both returned **202** — one naming the exercise's real id, and one naming
`deadbeef-0000-4000-8000-000000000001`, an exercise **that does not exist**, with a forged
`actor.kind: 'participant'` and a forged `actingHumanId`. Because there is **no FK constraint on
`TelemetryEvent.ExerciseId`**, the orphan row is storable, not merely rejected-but-logged.

**Why it matters more than it looks.** XC-004 is not incidental telemetry — it is Pulse's
evaluation record. Per COR-018 it is the mechanism that attributes actions to individual humans
behind shared org handles, and AAR/evaluator scoring reads it directly. An untrusted write path
into it means fabricated evaluation data, cross-exercise pollution (the exact COR-001 property the
rest of the codebase — `IExerciseScoped` + the central query filter — defends carefully), and
diluted audit value everywhere a story leans on telemetry as the durable, harder-to-tamper record
(e.g. `identity-auth-roles/10` records `participantPersonaId` on its event specifically because
table columns are mutable and telemetry was assumed trustworthy).

### Decided this session — the open question is answered, do not re-open

**There are no legitimately pre-auth telemetry emitters.** Verified this session:
- The only `POST /api/telemetry` caller in the frontend is `core/telemetry/mockSink.ts:66`.
- `src/frontend/src/features/login/**` contains **zero** telemetry references.
- All login-outcome telemetry (`ParticipantLoginService`'s `BuildLoginTelemetry`/
  `FailureOutcomePayload`) is emitted **server-side, in-process** — never over HTTP, so a
  login-failure event (the textbook "no session by definition" case) never touches this endpoint
  at all.

So `POST /api/telemetry` gets **no pre-auth carve-out**: it is fully session-gated (via story 11's
`FallbackPolicy` — see Dependencies), and `exerciseId` is stamped from the resolved session scope,
full stop. **If a genuinely pre-auth emitter is ever needed in the future, it gets its own,
explicitly allowlisted route with its own server-stamped scope — never a reopened,
body-supplied `exerciseId` on this endpoint.**

**Also decided: reject, never silently overwrite.** A client-supplied `exerciseId` that disagrees
with the session's own scope is **rejected with 400**, not silently replaced with the correct one.
A caller whose body disagrees with its own session is either a bug worth surfacing to the client or
an attempted forgery; silently overwriting hides a misconfigured client either way and gives the
caller no signal that something is wrong. This mirrors how `BootstrapService` already refuses to
trust a client-supplied scope rather than "fixing" it quietly.

## Acceptance Criteria

### `exerciseId` is server-authoritative
- [ ] Given a live session, when `POST /api/telemetry` is called, then the persisted
      `TelemetryEvent.ExerciseId` is stamped from the resolved session scope
      (`ICurrentSessionAccessor`, reused from story 12 — not a second, parallel accessor), **never**
      trusted from `TelemetryEventRequest.ExerciseId` even when the two agree.
- [ ] Given a live session, when the request body's `exerciseId` **disagrees** with the session's
      own bound exercise, then the request is rejected with **400** (not silently overwritten with
      the session's value, and not persisted).
- [ ] Given no live session, when `POST /api/telemetry` is called, then it is rejected (401) —
      this endpoint carries **no pre-auth allowlist entry** (Decision, above); it is not on story
      11's 11-route allowlist.

### Actor identity is server-authoritative, not a body claim
- [ ] Given a live session, when `POST /api/telemetry` is called, then `actor.kind`,
      `actor.personaId`/`actor.sessionId`, and `actor.actingHumanId` are populated from the
      session's own resolved identity — a body-supplied `actor.kind: 'participant'` (or any other
      forged actor claim, per the audit's confirmed exploit) is not trusted verbatim.

### Cross-cutting
- [ ] **Isolation (XC-001/COR-001):** a telemetry write can never be attributed to an exercise
      other than the caller's own session scope — closing the "attribute to any exercise it names"
      gap the audit confirmed, including the case of a nonexistent exercise id.

## Out of Scope
The default-deny session gate itself (story 11 — this story's "no live session → 401" AC relies on
it; `TelemetryController` is an MVC controller, so it is `AuthorizationMiddleware`'s `FallbackPolicy`
that gates it, not anything this story adds directly). `POST /api/posts` attribution (story 12) —
a different endpoint, a different file, though this story reuses story 12's
`ICurrentSessionAccessor` rather than inventing a second telemetry-specific one. The anonymous-401
regression suite (story 14). Any read/query API over stored telemetry, rate limiting beyond the
existing 64 KiB body cap (`TelemetryController.cs:30`), and SignalR fan-out for telemetry — all
already out of scope per the controller's own doc comment and unaffected by this story.

**Consider, not a hard AC:** an FK constraint on `TelemetryEvent.ExerciseId` (the audit proved none
exists — a write naming a nonexistent exercise was accepted). **Audit for existing orphan rows
first** before adding the constraint (the sandbox already has at least one:
`22222222-2222-2222-2222-222222222222`, per the audit's cleanup table) — a migration that adds the
FK without first resolving orphans would fail to apply or silently cascade-delete evaluation data,
either of which is worse than the current gap. Track as a follow-up migration, not this story's AC.

## Technical Notes
**Backend only.** Owns `Telemetry/TelemetryController.cs` — the `Ingest` action gains a
`ICurrentSessionAccessor` dependency (the same type story 12 introduces in
`Features/Identity/Sessions/CurrentSessionAccessor.cs`; this is the second consumer, not a new
accessor). Scope/actor validation runs **before** the existing size-cap/JSON/schema/dedup checks
that are already in place (`:52-117`) — a 401 for no session, a 400 for a scope mismatch, ahead of
the existing 400s for malformed envelopes. Update the class doc comment (`:18-19`) to remove the
"Out of scope: per-session/hostname authority of the `exerciseId` claim" line — it is no longer
true once this story lands, and leaving it would misdirect the next reader exactly as it misdirected
this audit's own scoping.

**Why this needs story 11's `FallbackPolicy` specifically, not just "any" session requirement:**
`TelemetryController` is an MVC controller (`[ApiController]`, self-registered via
`MapControllers()`), so a minimal-API `IEndpointFilter` (the pattern
`ReadOnlySessionWriteFilter`/`EngineCockpitStaffAuthorizationFilter` use) would never run for it —
see story 11's Decision 1 for the full reasoning. This story's own AC3 ("no live session → 401")
is therefore delivered by story 11's gate, not by new code in this story; this story's own new code
is the scope/actor **derivation and mismatch-rejection**, which requires a session to already be
guaranteed present.

Cross-reference `implementation.md`'s per-story tech notes and Wave Plan.

## Dependencies
`identity-auth-roles/11` (the `FallbackPolicy` default-deny gate — required for this story's
"no session → 401" AC; an `IEndpointFilter`-only approach could not have gated this MVC
controller). `identity-auth-roles/12` (reuses its `ICurrentSessionAccessor` — do not invent a
third parallel session-lookup shape; see story 12's own Out of Scope on consolidation as a
follow-up). `identity-auth-roles/03` (`Session.PersonaId`/`ActingHumanId`, the data the accessor
reads).

## Tests
- A live session's telemetry write is stamped with the session's own `exerciseId`, ignoring an
  agreeing or absent body value.
- A live session's telemetry write with a **disagreeing** body `exerciseId` is rejected (400), not
  persisted, not silently corrected.
- A telemetry write with no live session is rejected (401) — the MVC-controller proof point for
  story 11's `FallbackPolicy` mechanism choice.
- A telemetry write's `actor.kind`/`actingHumanId` reflects the session's own identity regardless
  of a divergent or forged body claim.
- Regression: the existing size-cap/malformed-JSON/schema/dedup 400 paths (`TelemetryController.cs`
  tests already covering `:52-117`) are unaffected by the new scope/actor checks running ahead of
  them.
