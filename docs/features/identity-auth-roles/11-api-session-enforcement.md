# Story: Default-deny session enforcement across the API surface

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-012  ·  **Design decisions:** none  ·  **Issue:** #361
**Stack:** backend  ·  **Review:** Tier-2 (auth surface + the isolation seam; always-Critical class)

## Context
COR-012 (`docs/01-platform-core-isolation.md`): *"Sessions are short-lived with refresh; a
participant session is bound to one exercise and one account (or one read-only session per
COR-015)."* Story `identity-auth-roles/03` built the session model, issuance, refresh, and the
`GET /api/session` contract — the half of COR-012 that is *about* the session. It never built the
other half: **a session being required** before any endpoint honors a request. Nothing in
`Pulse.WebApi` enforces that — `grep -rc RequireAuthorization src/Pulse.WebApi` returns **0**.

**The confirmed vulnerability (tracked as #359).** Every endpoint gates only on "has a scope been
resolved" (`if (exerciseContext.CurrentExerciseId is null) return Results.Unauthorized();`), and
`ExerciseResolutionMiddleware` resolves that scope from the request's bare `Host` header for
*any* caller, session or none (COR-008). Confirmed empirically against the deployed UAT host with
plain unauthenticated `curl` — no `Authorization` header, no cookie:

- `GET /api/personas` → 200, the full roster (`id`, `handle`, `displayName` for every persona).
- `GET /api/feed` → 200, the exercise's post feed.
- `POST /api/posts` → 201 Created — a post injected into the live exercise as persona `mvega_fh`,
  with attacker-chosen `origin: engine`, attacker-chosen `scenarioTime` (2033), and
  `actingHumanId` returned as `""`.
- `GET /api/session` → 401 (correctly — this endpoint already requires a live session).
- `GET /api/exercise-context` → 200, and this one is **intentional**
  (`exercise-isolation/08` — the login pages need a resolved scope pre-auth).

**The root cause is a composition, not a middleware bug.** `ExerciseResolutionMiddleware`'s own
doc comment states the intended precedence deliberately: *"authenticated session (`03`, incl.
staff active-exercise `05`) > host resolution (this middleware, anonymous / pre-auth participant)
> unset (fail-closed floor)."* Anonymous host-resolved scope is there on purpose, for a real
reason: `GET /api/exercise-context` and the three login endpoints must work before a session
exists. The flaw is that a mechanism sized for a **handful of pre-auth endpoints** became the
**default scope for every endpoint**, because each endpoint's own guard only ever asks "is a
scope resolved" — never "was that scope resolved *by an authenticated session*". Two
individually-sound decisions (anonymous host scoping for the login/context path; scope-only
endpoint guards) compose into no authentication at all for everything else. It is also why the
existing suite is green: every test authenticates first, so nothing exercises the anonymous path.

This story builds the missing half of COR-012 — a session is *required*, not merely *modeled* —
as a default-deny posture at the composition root, per-endpoint opt-in being exactly the pattern
that produced the gap. It implicates:
- **COR-001** (`docs/01-platform-core-isolation.md`): *"Every content and social-graph entity
  carries an `ExerciseId`; all queries on participant-facing paths filter by the session's
  exercise. Enforced centrally... not per-endpoint."* — an anonymous, host-resolved scope is not
  "the session's exercise"; today's endpoints read it as if it were.
- **COR-015**: the shared read-only session must never write — `ReadOnlySessionWriteFilter`
  correctly denies a *live read-only* session, but an *absent* session sails through it (below).
- **COR-018**: `actingHumanId` attribution is evaluation-critical and must never be blank — today
  it is exactly that for an unauthenticated `origin:'participant'` post.
- **NFR-009**: abuse resistance for posting endpoints assumes a rate-limited, accountable caller;
  an unauthenticated write path has neither.

See `docs/features/identity-auth-roles/feature.md` and the epic section above for the requirement
text and this feature's other stories; see `implementation.md`'s `ExerciseContext.CurrentExerciseId`
precedence note for the seam this story closes the last gap in.

## Acceptance Criteria

### Default-deny posture (the composition-root fix)
- [ ] Given the composition root today grants access to any endpoint whose scope resolves (session
      *or* anonymous host), when this story lands, then the default for every endpoint mapped in
      `Program.cs` is **"no live session → 401"**, expressed as one composition-root mechanism (a
      wrapping route group / fallback authorization policy — see Technical Notes for the two
      candidate mechanisms and the one this story picks) — **not** as a per-endpoint opt-in check
      added to each handler. Per-endpoint opt-in is the pattern that produced this gap; the fix
      does not repeat it.
- [ ] Given the default-deny mechanism, when an endpoint is on the pre-auth allowlist below, then it
      is marked as an explicit, commented exception at its own mapping call site (e.g.
      `.AllowAnonymous()` or the group-exclusion equivalent) — never by omission.

### The pre-auth allowlist is small and explicit
- [ ] The allowlist is exactly: `GET /api/exercise-context`, `POST /api/auth/login`,
      `POST /api/auth/staff/login`, `POST /api/auth/shared`, `POST /api/auth/refresh`. Anonymous,
      host-resolved scope (`ExerciseResolutionMiddleware`) is consumable **only** by this list.
- [ ] Given any other mapped endpoint — `GET /api/feed`, `GET /api/threads/{postId}`,
      `GET /api/personas`, `POST /api/posts`, the six participant-shell config reads
      (`/api/shell-state`, `/api/chrome-config`, `/api/brand-tokens`, `/api/channel-nav-config`,
      `/api/alerts`, `/api/overlay-state`), and the `/hubs/exercise` SignalR hub connection — when a
      request presents no live session, then it is rejected (401 for the REST endpoints; the hub
      connection is refused) before any handler/hub method runs, regardless of whether the `Host`
      header would otherwise resolve a scope.
- [ ] The staff and shared-credential-lifecycle endpoints that already fail closed on "no live
      session" via their own service-level check (`GET /api/staff/assignments`,
      `POST /api/staff/active-exercise`, `POST /api/staff/accounts[/import]`,
      `POST /api/staff/shared-credential/{rotate,revoke}`) keep behaving identically under the new
      default-deny wrapper — this is a consistency/defense-in-depth pass over them, not a
      regression, and their existing 401/403 semantics are unchanged.

### `POST /api/posts` derives identity server-side, never from the body (COR-018)
- [ ] Given a live **participant** session, when that session's account posts, then
      `authorPersonaId` is taken from the session's bound persona (`Account.PersonaId`, already
      resolved and stamped onto the session at login — see `Session.PersonaId`) — **never** from
      `CreatePostRequest.AuthorPersonaId` — and a client-supplied `authorPersonaId` in the body is
      ignored (or rejected) for that session kind. `origin` is forced to `participant` regardless
      of any body value.
- [ ] Given a live participant session, when it posts, then the persisted/telemetered
      `actingHumanId` is populated from the authenticated identity behind the session — **never**
      returned or stored as an empty string (`request.ActingHumanId ?? string.Empty` is exactly the
      bug: an absent body field silently becomes `""`, satisfying no one).
- [ ] Given a live **staff** session operating a persona (`origin: controller-as-persona`), when it
      posts, then `actingHumanId` is derived from the staff session's own identity
      (`AuthenticatedSession`/`ICurrentStaffSessionAccessor`'s `StaffUserId` or its resolved human
      identity) — never trusted as free client-supplied text — while `authorPersonaId` stays
      body-supplied (the console picks which persona to operate; the caller's *staff-ness* is what
      must be proven, not the persona choice).
- [ ] Given no live session, or a live session that is **not** staff-kind, when the request's
      `origin` is `controller-as-persona`, `engine`, or `inject`, then the request is rejected — a
      participant or read-only session can never reach a non-`participant` origin, and (per the
      default-deny AC above) an absent session cannot reach this endpoint at all.

### Absent session is fail-closed, not merely "not read-only"
- [ ] `ReadOnlySessionWriteFilter`'s own doc comment states today: *"A request that presents no
      session... is NOT denied here — such a request is unauthenticated and the write endpoint's
      own fail-closed scope check... handles it."* That claim is false as built — the "own
      fail-closed scope check" is scope-only, not session-only, so an absent session was never
      denied anywhere. This story either (a) makes `ReadOnlySessionWriteFilter` itself fail closed
      on an absent session, or (b) relies on the new default-deny gate (above) running *ahead of*
      this filter in the pipeline so an absent session never reaches it in the first place — the
      story states explicitly which of the two it chose and, if (b), corrects the filter's doc
      comment so it no longer claims a guarantee the filter itself does not provide.

### The regression class that would have caught this
- [ ] A test suite exists asserting that every endpoint **not** on the pre-auth allowlist returns
      401 when no credential is presented at all (no bearer token, no cookie) — parameterized over
      the enumerated route list above, run in CI. Note explicitly in the test file/PR why this class
      of test did not already exist: every pre-existing test authenticates first, so none of them
      exercised the anonymous path this story closes.
- [ ] A companion test asserts `POST /api/posts` with a live **participant** session and a
      body-supplied `authorPersonaId`/`origin` different from the session's own persists using the
      *session's* values, not the body's (the COR-018 attribution fix, not just the 401 gate).

### Cross-cutting
- [ ] **Isolation (XC-001/COR-001):** a session is the authenticated anchor of the exercise scope;
      an anonymous, host-resolved scope is no longer sufficient to reach any participant-facing
      read/write. Extends the standing isolation suite (`exercise-isolation/07`) with the
      no-credential-at-all case across the enumerated route list, distinct from the existing
      cross-exercise (A-session-reads-B) cases those stories already cover.
- [ ] **Telemetry (XC-004):** a rejected unauthenticated attempt against a non-allowlisted endpoint
      emits an XC-004 event (additive vocabulary, e.g. `access.rejected`) — wall + scenario time
      (scenario time per the exercise's stored value, the same B2 placeholder story 03 documents),
      `actor.kind: 'system'`, no `personaId`/`actingHumanId` (there is no authenticated identity to
      attribute to), `channel: 'system'`, and the attempted route as the event target — mirroring
      the `outcome: 'failure'` pattern the login endpoints already use (`ParticipantLoginService`'s
      `BuildLoginTelemetry`/`FailureOutcomePayload`). Sized to avoid becoming its own DoS vector
      (e.g. no larger a write than the login-failure event already is; rate-limiting itself is Out
      of Scope, below).

## Out of Scope
The same-origin topology work tracked separately (#322). Removing or restructuring the ops
bootstrap endpoints (`POST /api/ops/bootstrap-exercise`, `POST /api/ops/seed-engine-content`) —
they are secret-gated by design (`Authentication:Bootstrap:Secret`, 404 when unconfigured) and are
**not** part of this story; nobody should "fix" them as a side effect of this pass. Rate-limiting
changes beyond what already exists (`participant-login`, `staff-login`, `shared-login`,
`session-endpoints` policies) — this story adds a gate, not a new limiter. Consolidating the
several session-lookup mechanisms that already exist in parallel
(`ISessionAuthenticator`/`ICurrentStaffSessionAccessor`/`IReadOnlySessionProbe`, and whatever new
accessor this story adds) into one canonical seam — flagged as a follow-up, not attempted here.
Replacing the bespoke `EngineCockpitStaffAuthorizationFilter` pattern (which already independently
requires a live *staff* session + exercise assignment for the review-cockpit group) — it already
does the right thing and is left as-is, though its existence is worth noting as the one place in
the codebase that already solved this class of problem correctly, ahead of this story.

**Flagged, not fixed here:** `POST /api/telemetry` (`Telemetry/TelemetryController.cs`) accepts an
`exerciseId` traveling in the client-supplied envelope itself, with no session check at all — its
own doc comment says so explicitly ("Out of scope (by story): per-session/hostname authority of the
`exerciseId` claim"). That is a related but distinct gap (an unauthenticated writer can attribute a
fabricated telemetry event to any exercise it names), predates this story, and is not folded into
these ACs — raised here so it is not lost, and given its own issue rather than being silently absorbed
into #359's fix: **#362**. **CONFIRMED against the sandbox** (both probes `HTTP 202`, no credential):
a write naming the real exercise is accepted, and so is one naming
`deadbeef-0000-4000-8000-000000000001` — an exercise that does not exist — with a forged
`actor.kind: participant` / `actingHumanId`. So there is no scope authority, **no FK constraint on
`TelemetryEvent.ExerciseId`** (orphan rows are storable), and actor identity is entirely caller-asserted.
`202` is a synchronous durable write (`SaveChangesAsync` precedes it), not a queue.

**Why it is deliberately not in scope here:** #359's fix is "require a live session before the handler
runs". #362's fix is "stop trusting a field in the body and stamp it server-side" — and it has a genuine
open question this story should not prejudge, namely what to do about legitimately pre-auth emitters (a
login-failure event has no session by definition). Folding them together would let the harder question
ride along unexamined.

## Technical Notes
**Backend only; the composition root is the seam.** Owns/touches:
`src/Pulse.WebApi/Program.cs` (orchestrator-owned — this story's Program.cs edit is the whole point,
not a side effect, so it does not slot into a normal parallel wave); the new default-deny gate
component (new file(s), likely `Features/Identity/Sessions/`); the pre-auth `.AllowAnonymous()`
(or equivalent) mark at each of the five allowlisted endpoints'
own mapping call sites — `Features/ExerciseResolution/ExerciseContextEndpoints.cs`,
`Features/Identity/Accounts/AccountEndpoints.cs` (`/api/auth/login` only —
`/api/staff/accounts[/import]` stay gated), `Features/Identity/Staff/StaffAuthEndpoints.cs`
(`/api/auth/staff/login` only), `Features/Identity/SharedAccess/SharedReadOnlyEndpoints.cs`
(`/api/auth/shared`), `Features/Identity/Sessions/SessionEndpoints.cs` (`/api/auth/refresh` only —
`GET /api/session` and `POST /api/auth/logout` already require a live session and stay as-is);
`Features/Social/PostWriteEndpoints.cs` + `PostIngestService.cs` (server-side attribution);
`Features/Social/PersonaEndpoints.cs` + `FeedEndpoints.cs` + `ThreadEndpoints.cs` (no code change
expected — they inherit the default-deny wrapper); `Features/Identity/SharedAccess/
ReadOnlySessionWriteFilter.cs` (doc-comment correction, and possibly the fail-closed change per the
AC above).

**Two viable default-deny mechanisms — this is a real fork the builder must resolve, not a detail:**
1. **Promote `SessionAuthenticationMiddleware` to populate `HttpContext.User`** with an
   authenticated `ClaimsPrincipal` (claims: session id, kind, exercise id) instead of only writing
   `IExerciseContext.CurrentExerciseId` directly. This unlocks ASP.NET Core's own
   `services.AddAuthorization(o => o.FallbackPolicy = new AuthorizationPolicyBuilder()
   .RequireAuthenticatedUser().Build())` + `.AllowAnonymous()` on the five allowlisted endpoints —
   the idiomatic, framework-native "default-deny with explicit opt-outs" mechanism, and it composes
   cleanly with a future `[Authorize(Roles=...)]` need. Larger blast radius: touches the
   session-authentication contract every other B2 story built against.
2. **A new `IEndpointFilter` + `MapGroup` wrapper**, mirroring the codebase's own established
   pattern (`ReadOnlyWriteDenialExtensions.DenyReadOnlySessions<T>()`,
   `EngineCockpitStaffAuthorizationFilter`) — a `RequireLiveSessionExtensions.RequireLiveSession<T>()`
   filter that checks a session was authenticated (stashed via a new `HttpContext.Items` flag from
   `SessionAuthenticationMiddleware`, the same mechanism `SetHostResolvedExerciseId` already uses)
   and 401s otherwise, wrapped around every `Map*Endpoints()` call in `Program.cs` except the
   allowlist. Smaller blast radius; consistent with the filter-group idiom already used twice in
   this codebase; does not give a future story `[Authorize(Roles=...)]` for free.

Recommendation for the builder: (2) is lower-risk given how much B2 already depends on the current
middleware contract, but this is exactly the kind of decision that belongs to whoever picks up the
story, not baked in here — call it out explicitly in the PR description either way.

**`POST /api/posts` needs a session-identity read that does not exist yet.** `AuthenticatedSession`
(`ISessionAuthenticator`'s result type) today carries only `SessionId`/`ExerciseId`/`Kind`/
`StaffUserId` — no `PersonaId`/`AccountId`/`ActingHumanId`, because nothing has needed them outside
the middleware's own scope-write. `Account.PersonaId` and `Session.PersonaId`/`ActingHumanId` are
already persisted (they populate `GET /api/session`'s response today), so the data exists — a new
accessor is needed to read it from a request-scoped service at endpoint-handler time. The
established codebase pattern for exactly this (`CurrentStaffSessionAccessor`, `ReadOnlySessionProbe`)
is a small service that independently re-resolves the presented bearer token against
`PulseDbContext.Sessions` (the middleware's own lookup ran in a throwaway scope and is gone by
handler time) — follow that pattern rather than inventing a new one; a general
`ICurrentSessionAccessor` (any kind) is the natural shape, and is plausibly useful to a future story
beyond this one, but do not scope-creep into replacing the two accessors that already exist.

**Wave split (this is broad enough to be one story but not one commit):**

| Wave | Scope | Files | Depends-on |
|------|-------|-------|------------|
| 1 | Default-deny gate + the five-item allowlist + telemetry-on-reject | `Program.cs` (orchestrator); the new gate component; one `.AllowAnonymous()`-equivalent mark per allowlisted endpoint's own file | none — extends existing session/host-resolution infra |
| 2 | `POST /api/posts` server-side attribution (COR-018) | `PostWriteEndpoints.cs`, `PostIngestService.cs`, the new session-identity accessor, `ReadOnlySessionWriteFilter.cs` doc/behavior fix | Wave 1 (needs a live-session-required endpoint to build the identity read against) |
| 3 | Regression suite: anonymous-401 sweep + attribution assertions | test project only | Waves 1 and 2 (asserts both) |

## Dependencies
`identity-auth-roles/03` (sessions — `ISessionAuthenticator`, `SessionAuthenticationMiddleware`,
`Session.PersonaId`/`ActingHumanId`), `identity-auth-roles/05` (staff identity —
`ICurrentStaffSessionAccessor`, the pattern this story's new accessor follows),
`identity-auth-roles/06` (shared read-only — `ReadOnlySessionWriteFilter`, `IReadOnlySessionProbe`),
`exercise-isolation/08` (host resolution — the anonymous scope this story confines to the
allowlist), `social-api` (`PostWriteEndpoints`/`PostIngestService`, `FeedEndpoints`,
`PersonaEndpoints`, `ThreadEndpoints` — all inherit the default-deny wrapper). Extends
`exercise-isolation/07`'s standing isolation suite.

## Tests
- Parameterized: every non-allowlisted route (the enumerated list above, incl. `/hubs/exercise`)
  returns 401 (or refuses the hub connection) with no credential presented.
- The five allowlisted routes remain reachable with no credential.
- `POST /api/posts`: a participant session's post persists with the session's own
  `authorPersonaId`/`origin: 'participant'` regardless of a divergent body value; `actingHumanId` is
  never empty.
- `POST /api/posts`: a participant or read-only (or absent) session cannot reach
  `origin: controller-as-persona | engine | inject`.
- `ReadOnlySessionWriteFilter`/the default-deny gate: an absent session is denied before the
  read-only-specific check runs (whichever of the two AC options was chosen).
- Isolation-suite extension (`exercise-isolation/07`): the no-credential-at-all case, distinct from
  the existing cross-exercise (session-A-reads-B) cases.
- Telemetry: a rejected unauthenticated attempt emits the `access.rejected` (or equivalent) v0
  event with no actor identity.
