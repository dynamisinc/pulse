# Story: `POST /api/posts` derives identity server-side, never from the body

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-018 (with COR-001, NFR-009 implicated)  ·  **Design decisions:** none  ·  **Issue:** #366
**Stack:** backend  ·  **Review:** Tier-2 (auth surface + attribution — always-Critical class)

> **Split from [`11-api-session-enforcement.md`](11-api-session-enforcement.md) (#361), Wave 2.** Different
> files (`Features/Social/*`) and a different mechanism (attribution logic, not the composition-root gate)
> from story 11's `Program.cs` edit and story 13's `Telemetry/TelemetryController.cs` edit — kept as its own
> story rather than folded into either.

## Context
`ENDPOINT-AUTH-AUDIT.md`'s confirmed exploit #1: `POST /api/posts` → **201 Created**, a post
injected into the live exercise as persona `mvega_fh` (an id read straight off the unauthenticated
`GET /api/personas` roster), attacker-chosen `origin: engine`, attacker-chosen `scenarioTime`
(2033), and `actingHumanId` returned as `""`. Story 11 closes the "no credential at all" half of
that exploit — once it lands, this endpoint requires a live session. It does **not** close the
other half: even a legitimately live **participant** session's request body is still fully trusted.
`PostIngestService.IngestAsync` (`PostIngestService.cs`) reads `authorPersonaId`, `origin`, and
`actingHumanId` **entirely from `CreatePostRequest`** — a participant's own composer could name any
persona, any origin in the full `PostOrigin` union (`AllowedOrigins`, `:33-39`), and any
`actingHumanId`, and the service accepts it as long as it parses. Line 139 is the concrete bug the
audit's exploit exposed: `var actingHumanId = request.ActingHumanId ?? string.Empty;` — an absent
body field silently becomes an empty string, satisfying no one and defeating COR-018 attribution
even for a caller who never intended to omit it.

`PostWriteEndpoints.cs`'s own doc comment (`:51-62`) already flags this as a known, deliberate
placeholder — *"Role is proxied by `origin` until Phase B2 auth lands... Phase B2 hardens `origin`
authenticity"* — this story is that hardening.

COR-018 (`docs/01-platform-core-isolation.md`): attribution to individual humans behind
shared/organization accounts is evaluation-critical; `actingHumanId` must never be blank and must
never be a self-reported claim from an untrusted body.

### Decided this session — the session-identity blocker (do not re-open)

`AuthenticatedSession` (`ISessionAuthenticator.cs:30-43`) — the type `SessionAuthenticationMiddleware`
resolves per request — carries only `SessionId`/`ExerciseId`/`Kind`/`StaffUserId`. It has no
`PersonaId` or human-identity field, because nothing outside the middleware's own scope-write has
ever needed one. `Session.PersonaId`/`ActingHumanId` (and `Account.PersonaId`) already exist and
are persisted — they populate `GET /api/session`'s response today — so the data exists; only a
request-scope *read* of it at endpoint-handler time is missing.

This story adds **exactly one** new request-scoped accessor, `ICurrentSessionAccessor` (any
session kind — participant, staff, or read-only), following the established codebase pattern for
precisely this shape: `CurrentStaffSessionAccessor` (`CurrentStaffSessionAccessor.cs`) and
`ReadOnlySessionProbe` (`ReadOnlySessionWriteFilter.cs:100-135`) both independently re-resolve the
presented bearer token against `PulseDbContext.Sessions` at endpoint time, because the
middleware's own lookup ran in a throwaway scope and is gone by handler time
(`SessionAuthenticationMiddleware.cs`'s own remarks). `ICurrentSessionAccessor` follows that same
shape rather than inventing a third. **Consolidating the now 3+ parallel session-lookup seams
(`ISessionAuthenticator`, `ICurrentStaffSessionAccessor`, `IReadOnlySessionProbe`, and this new
one) into one canonical mechanism is a real follow-up, worth its own issue — explicitly not
attempted in this story** (see Out of Scope).

## Acceptance Criteria

### Participant sessions post only as their own bound persona (COR-018)
- [ ] Given a live **participant** session, when that session's account posts, then
      `authorPersonaId` is taken from `ICurrentSessionAccessor`'s resolved `PersonaId` (backed by
      `Account.PersonaId`/`Session.PersonaId`) — **never** from `CreatePostRequest.AuthorPersonaId`
      — and a client-supplied `authorPersonaId` in the body is ignored for that session kind.
      `origin` is forced to `participant` regardless of any body value.
- [ ] Given a live participant session, when it posts, then the persisted and telemetered
      `actingHumanId` is populated from the authenticated identity behind the session — **never**
      returned or stored as an empty string (`PostIngestService.cs:139`'s
      `request.ActingHumanId ?? string.Empty` is exactly the bug this AC removes for a
      participant-origin post).

### Staff sessions operating a persona are attributed to the operator, not the body
- [ ] Given a live **staff** session operating a persona (`origin: controller-as-persona`), when
      it posts, then `actingHumanId` is derived from the staff session's own identity
      (`ICurrentSessionAccessor`'s `StaffUserId` or its resolved human identity) — never trusted as
      free client-supplied text — while `authorPersonaId` stays body-supplied (the console picks
      which persona to operate; the caller's *staff-ness* is what must be proven, not the persona
      choice).

### Non-participant origins are unreachable from a non-staff session
- [ ] Given a live session that is **not** staff-kind (participant or read-only), when the
      request's `origin` is `controller-as-persona`, `engine`, or `inject`, then the request is
      rejected (400/403) — a participant or read-only session can never reach a non-`participant`
      origin. (Per story 11's default-deny gate, a request with no session at all cannot reach this
      endpoint in the first place, so that case is covered upstream, not here.)

### Cross-cutting
- [ ] **Isolation (XC-001/COR-001):** the session-derived `authorPersonaId` must belong to the
      session's own bound exercise — a participant session cannot post as a persona from another
      exercise even if it somehow names one (defense-in-depth over the persona lookup; the primary
      isolation guarantee is the session's own exercise scope, unchanged by this story).
- [ ] **Telemetry (XC-004):** the `post` event's `actor.actingHumanId`
      (`PostIngestService.cs:168-180`) is populated from the same session-derived value as the
      persisted `Post.ActingHumanId` — one source of truth, not two independently-trusted paths.

## Out of Scope
The default-deny session gate itself (story 11 — this story assumes it has landed: without it, an
unauthenticated request would never reach this endpoint's attribution logic to begin with).
`POST /api/telemetry`'s own `exerciseId`/actor stamping (story 13) — a different endpoint, a
different file, reusing this story's `ICurrentSessionAccessor` but not built here. The anonymous-401
regression suite (story 14). **Consolidating the 3+ parallel session-lookup mechanisms
(`ISessionAuthenticator`/`ICurrentStaffSessionAccessor`/`IReadOnlySessionProbe`/this story's new
`ICurrentSessionAccessor`) into one canonical seam** — flagged as a follow-up worth its own issue,
not attempted here. The org-account multi-persona operation path (COR-018's remaining scope —
story `09-org-account-operation.md`, deferred out of B2) — this story only hardens the existing
single-persona-per-session write path, it does not add multi-persona grants or the participant
switcher. The read-only-session write denial (`ReadOnlySessionWriteFilter`, story 06) — unaffected,
untouched by this story.

## Technical Notes
**Backend only.** Owns:
- `Features/Identity/Sessions/CurrentSessionAccessor.cs` (new) — `ICurrentSessionAccessor` +
  `CurrentSession` (session id, kind, exercise id, persona id, acting-human id), mirroring
  `CurrentStaffSessionAccessor`'s endpoint-time token-lookup shape (`PulseDbContext.Sessions`
  re-resolved from the presented bearer token, not a middleware handoff).
- `Features/Social/PostWriteEndpoints.cs` + `PostIngestService.cs` — `CreatePostAsync`/`IngestAsync`
  take the new accessor as a collaborator; `authorPersonaId`/`origin`/`actingHumanId` are derived
  from it per session kind instead of from `CreatePostRequest` (the request DTO's corresponding
  fields become advisory/ignored for a participant session, and validated-against-caller-identity
  for a staff session).
- No `Program.cs` edit — this story registers its one new service via the existing
  `AddSocialPostWrite()` extension (`PostWriteEndpoints.cs:26-33`), which the orchestrator already
  wires; adding one `services.AddScoped<...>()` line inside that existing extension needs no new
  composition-root call.

Cross-reference `implementation.md`'s per-story tech notes and Wave Plan for how this story slots
in after story 11 (needs a live-session-required endpoint to build the identity read against).

## Dependencies
`identity-auth-roles/11` (the endpoint must require a live session before this story's attribution
logic has anything to derive from — without it, an unauthenticated caller reaches this code path at
all). `identity-auth-roles/03` (`Session.PersonaId`/`ActingHumanId`, the data this story reads).
`identity-auth-roles/05` (`CurrentStaffSessionAccessor`, the pattern this story's new accessor
follows). `social-api` (`PostWriteEndpoints`, `PostIngestService` — the files this story edits).

## Tests
- A participant session's post persists with the session's own `authorPersonaId`/
  `origin: 'participant'` regardless of a divergent body value; `actingHumanId` is never empty.
- A staff session operating a persona: `actingHumanId` is the staff identity, not a
  client-supplied string; `authorPersonaId` is the body-supplied persona choice.
- A participant or read-only session cannot reach `origin: controller-as-persona | engine | inject`
  (400/403).
- A session-derived `authorPersonaId` belonging to another exercise is rejected (isolation
  defense-in-depth).
- The persisted `Post.ActingHumanId` and the telemetered `TelemetryEvent.Actor.ActingHumanId`
  agree (single source of truth).
