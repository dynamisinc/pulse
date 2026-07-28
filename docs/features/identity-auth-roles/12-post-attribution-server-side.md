# Story: `POST /api/posts` derives identity server-side, never from the body

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Complete
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

### ⚠️ Two corrections made at build time (2026-07-28) — these supersede the section below

**1. No new accessor was added. `ICurrentSessionPersonaAccessor` already existed.** The section below calls for a
new `ICurrentSessionAccessor`. It had already been built under a different name by `profiles-social-graph`
(#372), which merged *after* this story was written:
`Features/Social/Follows/CurrentSessionPersonaAccessor.cs` exposes exactly the needed facts —
`SessionId`/`PersonaId`/`Kind`/`ExerciseId`/`ActingHumanId` — in the same endpoint-time token-re-resolution
shape, is `TryAdd`-registered, and is already consumed by `PostReadService`, `SuggestionService` and
`FollowService`. Adding another would have made a **fourth** parallel session-lookup seam, which is precisely
what this story's own Out of Scope warns against. The staff arm reuses B2's `ICurrentStaffSessionAccessor`.
**Net new session-lookup seams in this story: zero.**

**2. Attribution is resolved at the ENDPOINT, not inside `PostIngestService`.** The Technical Notes below imply
the funnel derives identity. It cannot: `IngestAsync` has **two** callers — this HTTP boundary, and the
engine's in-process `EnginePublishService.cs:116`, which has no HTTP request and therefore no session at all.
Requiring a session inside the funnel would have broken engine publishing *and* the review-cockpit
approve/edit/batch/auto-send paths that route through it. So `PostAttributionResolver` runs at the HTTP
boundary — the only place an untrusted body exists — and hands a `PostAttribution` to the funnel as a required
parameter, which makes the trust boundary visible in the signature. A regression test asserts the engine's
session-less path still publishes.

**Also settled at build time, where this story's own text was contradictory.** A Tests bullet below asked for a
participant post to *persist* as `origin: participant` "even when the body names `origin: engine`", while the
ACs require a privileged origin from a non-staff session to be **refused**. Resolved by distinguishing what the
body claims: a divergent **persona** or `actingHumanId` is silently ignored (a stale client is a bug, not an
attack → 201 with the session's own values); a privileged **origin** is refused (403 — silently downgrading it
would let the attempt succeed as an ordinary post and leave no trace it was made); an **absent** origin is not
a claim at all (→ 201 as participant). A staff session is additionally held to
`origin: controller-as-persona` only — `engine`/`inject` are in-process provenances no HTTP caller can possess,
and `participant` would make an operator's write indistinguishable from a trainee's in the evaluation record.

### Decided this session — the session-identity blocker (superseded by correction 1 above)

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
- [x] Given a live **participant** session, when that session's account posts, then
      `authorPersonaId` is taken from `ICurrentSessionAccessor`'s resolved `PersonaId` (backed by
      `Account.PersonaId`/`Session.PersonaId`) — **never** from `CreatePostRequest.AuthorPersonaId`
      — and a client-supplied `authorPersonaId` in the body is ignored for that session kind.
      `origin` is forced to `participant` regardless of any body value.
- [x] Given a live participant session, when it posts, then the persisted and telemetered
      `actingHumanId` is populated from the authenticated identity behind the session — **never**
      returned or stored as an empty string (`PostIngestService.cs:139`'s
      `request.ActingHumanId ?? string.Empty` is exactly the bug this AC removes for a
      participant-origin post).

### Staff sessions operating a persona are attributed to the operator, not the body
- [x] Given a live **staff** session operating a persona (`origin: controller-as-persona`), when
      it posts, then `actingHumanId` is derived from the staff session's own identity
      (`ICurrentSessionAccessor`'s `StaffUserId` or its resolved human identity) — never trusted as
      free client-supplied text — while `authorPersonaId` stays body-supplied (the console picks
      which persona to operate; the caller's *staff-ness* is what must be proven, not the persona
      choice).

### Non-participant origins are unreachable from a non-staff session
- [x] Given a live session that is **not** staff-kind (participant or read-only), when the
      request's `origin` is `controller-as-persona`, `engine`, or `inject`, then the request is
      rejected (400/403) — a participant or read-only session can never reach a non-`participant`
      origin. (Per story 11's default-deny gate, a request with no session at all cannot reach this
      endpoint in the first place, so that case is covered upstream, not here.)

### Cross-cutting
- [x] **Isolation (XC-001/COR-001):** the session-derived `authorPersonaId` must belong to the
      session's own bound exercise — a participant session cannot post as a persona from another
      exercise even if it somehow names one (defense-in-depth over the persona lookup; the primary
      isolation guarantee is the session's own exercise scope, unchanged by this story).
- [x] **Telemetry (XC-004):** the `post` event's `actor.actingHumanId`
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

All suites drive the REAL `Program` host with REAL seeded sessions and REAL bearer tokens against real SQL
(`[RequiresDockerFact]`) — the harness change this story forced, since attribution now resolves from the
presented token and a principal-only shim would prove nothing about it.

`PostWriteEndpointTests` (`src/Pulse.WebApi.Tests/Features/Social/PostWriteEndpointTests.cs`):
- `ParticipantSession_PostsAsItsOwnSessionPersona_IgnoringADivergentBodyPersonaAndActingHuman` (AC1) —
  the body names another real in-exercise persona and a self-reported `actingHumanId`; both are ignored.
- `ParticipantSession_OmittingOriginEntirely_StillPostsAsParticipant` (AC1) — an absent origin is not a
  claim, so it is derived rather than refused.
- `HappyPath_ParticipantOrigin_Returns201_AndStampsServerScope_EvenWithDifferentBodyExerciseId` (AC1) —
  scope + wall clock stay server-stamped.
- `StaffSession_ControllerAsPersona_AttributesTheStaffIdentity_AndKeepsTheBodyPersonaChoice` (AC2) —
  `actingHumanId` is the staff session's own identity and provably NOT the client-supplied string;
  `authorPersonaId` stays the console's body-supplied choice.
- `StaffSession_WithNoActingHumanIdInTheBody_StillAttributesTheStaffIdentity` (AC2) — the field is no
  longer client-supplied, so it can no longer be omitted.
- `ParticipantSession_ClaimingAPrivilegedOrigin_Returns403_AndPersistsNothing` (AC3) —
  `controller-as-persona` / `engine` / `inject` all refused, nothing persisted.
- `StaffSession_ClaimingANonControllerOrigin_Returns400_AndPersistsNothing` (AC3, tightened) —
  `engine` / `inject` are in-process-only provenances no HTTP caller can claim, and `participant` is not
  a staff origin.
- `StaffSession_NamingAnotherExercisesPersona_IsRejected_AndPersistsNothing` (AC isolation) — the one
  remaining client-supplied identity field is resolved through an explicit in-exercise predicate;
  asserted with `IgnoreQueryFilters` in both exercises.
- `ParticipantPost_LandsOnlyInItsOwnExercise_AndIsInvisibleToAnother` (AC isolation) — the standing
  cross-exercise read-back, fail-closed.
- `LiveSessionWithNoPersonaBinding_AndNotStaff_Returns403_AndPersistsNothing`,
  `SessionWithNoActingHumanAttribution_Returns403_AndPersistsNothing` (COR-018) — the fail-closed
  identity doors; storing `""` is the exact bug removed.
- `UnresolvedExerciseScope_FailsClosed_Returns401_AndNeverPersistsOrBroadcasts` (COR-001) — reached
  through the real pipeline via a staff session bound to the `Guid.Empty` sentinel.
- `SuccessfulIngest_EmitsExactlyOneTelemetryEvent_MatchingV0Envelope`,
  `PersistedActingHumanId_AndTheTelemetryActors_Agree_ForBothParticipantAndStaff` (AC telemetry) — the
  persisted `Post.ActingHumanId` and the event's `Actor.ActingHumanId` are projected from ONE
  server-derived value.

`PostIngestServiceAttributionTests` (`src/Pulse.WebApi.Tests/Features/Social/PostIngestServiceAttributionTests.cs`)
— the in-process half: the funnel does NOT require a session (the engine has no HTTP request), so its
own union / attribution / inject-id guards are asserted directly, including that an empty acting human is
null-OMITTED on the telemetry actor (off the locked v0 envelope) rather than emitted as `""`.

`EnginePublishServiceTests.PublishBurst_IngestsThroughB1_WithEngineOrigin_ScopedToTheBurstExercise` —
extended as the regression guard that the engine's session-less publish path still works.
