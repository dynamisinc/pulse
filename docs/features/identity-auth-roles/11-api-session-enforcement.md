# Story: Default-deny session gate + pre-auth allowlist + SignalR hub (Wave 1)

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** COR-012  ·  **Design decisions:** none  ·  **Issue:** #361
**Stack:** backend + frontend  ·  **Review:** Tier-2 (auth surface + the isolation seam; always-Critical class)

> **📋 Build from [`ENDPOINT-AUTH-AUDIT.md`](ENDPOINT-AUTH-AUDIT.md).** The audit carries the authoritative
> route inventory and the three confirmed exploits — see its superseding note at the top for the corrected
> endpoint count (40, not 38) and allowlist size (11, not 8).
>
> **This story is a rescope, not a rewrite.** It originally spanned three waves in one file (#361). Per the
> one-story-per-file convention it now covers **Wave 1 only** — the composition-root gate, the pre-auth
> allowlist, and the SignalR hub. `POST /api/posts` server-side attribution is
> [`12-post-attribution-server-side.md`](12-post-attribution-server-side.md) (#366); `POST /api/telemetry`
> exercise-scope authority is [`13-telemetry-exercise-scope-authority.md`](13-telemetry-exercise-scope-authority.md)
> (#362, retitled); the anonymous-401 regression suite is
> [`14-anonymous-access-regression-suite.md`](14-anonymous-access-regression-suite.md) (#367). All four are
> settled decisions from this session's triage — do not re-litigate the mechanism choice or the allowlist size
> below; they are recorded as decided, with the reasoning that closed them.

## Context
COR-012 (`docs/01-platform-core-isolation.md`): *"Sessions are short-lived with refresh; a
participant session is bound to one exercise and one account (or one read-only session per
COR-015)."* Story `identity-auth-roles/03` built the session model, issuance, refresh, and the
`GET /api/session` contract — the half of COR-012 that is *about* the session. It never built the
other half: **a session being required** before any endpoint honors a request. Nothing in
`Pulse.WebApi` enforces that — `grep -rc RequireAuthorization src/Pulse.WebApi` returns **0**.

**The confirmed vulnerability (#359).** Every endpoint gates only on "has a scope been resolved"
(`if (exerciseContext.CurrentExerciseId is null) return Results.Unauthorized();`), and
`ExerciseResolutionMiddleware` resolves that scope from the request's bare `Host` header for *any*
caller, session or none (COR-008). Confirmed against the deployed UAT host with no `Authorization`
header and no cookie: `GET /api/personas` → 200 (full roster), `GET /api/feed` → 200,
`POST /api/posts` → 201 (a post injected as persona `mvega_fh`, attacker-chosen `origin: engine`,
`scenarioTime` 2033, `actingHumanId` returned as `""`), and `/hubs/exercise` → negotiate 200 → WS
handshake accepted → a live `PostReceived` frame delivered with no credential at all.

**Root cause is a composition, not a middleware bug** (full analysis in the audit and in story
03's `#60` annotation). `ExerciseResolutionMiddleware`'s anonymous host resolution is deliberate —
`GET /api/exercise-context` and the login endpoints must work pre-auth. The flaw is that a
mechanism sized for a handful of pre-auth endpoints became the default scope for every endpoint,
because each endpoint's guard only ever asks "is a scope resolved," never "was it resolved *by a
session*."

### Decided this session — do not re-open

**1. Mechanism: native ASP.NET authorization `FallbackPolicy`.**
`POST /api/telemetry` is an MVC controller (`Telemetry/TelemetryController.cs:21-23`,
`[ApiController]` + `[Route("api/telemetry")]`, self-registered via `MapControllers()` in
`Program.cs:193`). Minimal-API `IEndpointFilter`s (the audit's option (b), the pattern
`ReadOnlySessionWriteFilter`/`EngineCockpitStaffAuthorizationFilter` already use) are **never
invoked for MVC endpoints** — option (b) could not gate the telemetry controller with the same
mechanism; it would need a second, bespoke MVC filter. `MapHub<ExerciseRealtimeHub>`
(`RealtimeExtensions.cs:45`) likewise never runs minimal-API endpoint filters — a third bespoke
gate would be needed inside `ExerciseRealtimeHub.OnConnectedAsync`. Three parallel mechanisms is
the *same composition failure* that produced this bug (three individually-sound gates that never
compose into one guarantee). `services.AddAuthorization(o => o.FallbackPolicy = ...)` +
`app.UseAuthorization()` covers minimal APIs, MVC controllers, and hub endpoints uniformly through
one `AuthorizationMiddleware`, and it is opt-**out** (`.AllowAnonymous()`), not opt-in.

Blast radius is contained: `SessionAuthenticationMiddleware` (`Features/Identity/Sessions/
SessionAuthenticationMiddleware.cs`) is **NOT** rewritten into an `AuthenticationHandler`. It keeps
its exact position (after `UseExerciseResolution()`), its exact precedence semantics (session >
host > unset), and its exact participant host-binding check (`:92-101`). It is purely *additive*:
in addition to writing `ExerciseContext.CurrentExerciseId` with precedence (`:105-108`), on a live
session it also sets `HttpContext.User` to an authenticated `ClaimsPrincipal` (claims: session id,
kind, exercise id) — the one new write this story adds to that file.

No ASP.NET authentication *scheme* is registered today (`grep AddAuthentication
src/Pulse.WebApi` → nothing; the "opaque-bearer auth scheme" referenced in doc comments is
bespoke, not a registered `IAuthenticationHandler`). The fallback policy carries **no**
authentication schemes, so ASP.NET's `PolicyEvaluator` reads `HttpContext.User` directly rather
than trying to challenge a scheme that doesn't exist. A custom
`IAuthorizationMiddlewareResultHandler` converts a policy failure's Challenge → 401 / Forbid → 403
— and is the natural place to emit the XC-004 `access.rejected` event (below) — so no default
challenge scheme needs registering.

**Ordering constraint (new, alongside the existing host-then-session one):**
`app.UseAuthorization()` **must be called explicitly**, immediately after
`app.UseSessionAuthentication()` (`Program.cs:176`). `WebApplication` auto-inserts
`UseAuthorization()` ahead of all user middleware when it is never called explicitly, which would
evaluate the fallback policy before `SessionAuthenticationMiddleware` has populated
`HttpContext.User` and 401 every request, including the allowlisted ones. Calling it explicitly at
the right point is load-bearing, not a stylistic preference.

**2. The SignalR hub needs a paired frontend change — ship it in this story.**
`src/frontend/src/core/realtime/connection.ts:98-105` (`createDefaultHubConnection`) builds the
hub connection with **no `accessTokenFactory`** — it sends no credential at all today. Gating the
hub therefore requires, in this same story (not a follow-up — shipping them apart leaves the
participant live feed dead between merges):
- **Frontend:** attach the session token via `HubConnectionBuilder().withUrl(hubUrl, {
  accessTokenFactory: () => token })`.
- **Backend:** `SessionTokenExtractor.TryGetBearerToken` (`SessionTokenExtractor.cs:21-42`) reads
  only the `Authorization` header. A browser cannot set an `Authorization` header on a WebSocket
  upgrade — SignalR's own client instead appends `?access_token=<token>` to the negotiate/connect
  URL. `SessionTokenExtractor` needs a second read path for that query parameter, scoped to the hub
  path only (do not accept a token-via-query-string on any REST route — that would be a token-in-URL
  leak on every other endpoint).

**3. The allowlist is corrected to 11 routes — the audit's 8 was incomplete for this mechanism.**
Validated this session against a live `EndpointDataSource` dump from the real
`WebApplicationFactory<Program>` host (the cross-check the audit itself asked for): **40
endpoints**, not the audit's static-grep 38. The delta is not error: `/hubs/exercise` and
`/hubs/exercise/negotiate` are two endpoints (SignalR expands the hub route), and
`POST /api/ops/bind-participant-persona` landed with story 10 (PR #364) after the audit ran. The
audit's inventory is otherwise exactly right.

The three `/api/ops/*` endpoints must be **added** to the allowlist. The audit classified them
"correctly gated" because their own secret gate (`BootstrapSecretGate.IsAuthorized`,
`BootstrapSecretGate.cs:26-38`) answers 404 to an unauthorized caller — but `AuthorizationMiddleware`
runs **before** the handler's secret check executes. Under default-deny, a legitimate,
secret-bearing, session-less bootstrap call — which by definition runs against an **empty
database with no session to present** (`BootstrapEndpoints.cs:17-24`'s own doc comment: "no other
endpoint can [seed the first exercise], since they all require an already-authenticated staff
session") — would 401 before ever reaching the secret gate, breaking the UAT go-live runbook. The
bootstrap secret **is** their credential — the identical rationale the audit already accepts for
`POST /api/auth/refresh` (the refresh token *is* the credential).

**Final allowlist, exactly 11 routes:**
1. `GET /api/exercise-context`
2. `POST /api/auth/login`
3. `POST /api/auth/staff/login`
4. `POST /api/auth/shared`
5. `POST /api/auth/refresh`
6. `POST /api/auth/logout`
7. `GET /health`
8. `GET /health/ready`
9. `POST /api/ops/bootstrap-exercise`
10. `POST /api/ops/seed-engine-content`
11. `POST /api/ops/bind-participant-persona`

**As built (2026-07-28):** the route table is now **53** endpoints, not 40 — `feature/exercise-configuration`
(#374) and `feature/profiles-social-graph` (#372) merged between this story being written and being built,
adding 13 routes (`/api/personas/suggestions`, the four follow-graph routes, and eight `/api/staff/*`
settings/lifecycle routes). Re-validated against a live `EndpointDataSource` dump: **all 13 are correctly
gated and none needs pre-auth, so the allowlist is unchanged at 11.** That the number moved twice during one
story is exactly why the allowlist is enforced against the live route table by test
(`DefaultDenySessionGateTests.EveryMappedEndpoint_IsEitherGated_OrOnTheElevenRouteAllowlist`) rather than by
a count in a document.

Everything else default-denies, **including both hub endpoints**. (The audit's first draft of this
story said the allowlist was 5 and that `POST /api/auth/logout` "already requires a live session" —
that is **false as built**; the audit itself probed it and got 204 with no session. That earlier
claim is corrected here, not carried forward.)

**4. `POST /api/auth/logout` stays allowlisted and stays a no-op 204.**
A client whose token has already expired must still be able to complete logout idempotently;
401-ing it would strand the SPA on a dead session with no way to clear its local state cleanly. It
invalidates nothing when there is nothing to invalidate, discloses nothing about session validity
either way, and is not a write path. This is a deliberate design choice, not an oversight.

**5. `ReadOnlySessionWriteFilter`: option (b) — the doc comment is wrong, the behavior is not.**
The new default-deny gate runs in `AuthorizationMiddleware`, strictly ahead of any endpoint filter
in the pipeline, so an absent session never reaches `ReadOnlySessionWriteFilter`
(`ReadOnlySessionWriteFilter.cs`) at all once this story lands. **Do not change the filter's
behavior.** Its doc comment (`ReadOnlySessionWriteFilter.cs:24-28`) currently claims: *"A request
that presents no session... is NOT denied here — such a request is unauthenticated and the write
endpoint's own fail-closed scope check... handles it."* That claim is **false as built** today
(there was no such check — that is the whole bug); it becomes **true** once this story's gate
lands ahead of it. Correct the comment to say so, referencing this story.

This story also implicates:
- **COR-001** (`docs/01-platform-core-isolation.md`): an anonymous, host-resolved scope is not
  "the session's exercise"; today's endpoints read it as if it were.
- **COR-008**: the host-resolution mechanism this story confines to its true pre-auth purpose.
- **COR-015**: the shared read-only session must never write — see decision 5 above.

See `docs/features/identity-auth-roles/feature.md` and `implementation.md`'s
`ExerciseContext.CurrentExerciseId` precedence note for the seam this story closes the last gap in.

## Acceptance Criteria

### Default-deny posture (the composition-root fix)
- [x] Given the composition root today grants access to any endpoint whose scope resolves (session
      *or* anonymous host), when this story lands, then `builder.Services.AddAuthorization(o =>
      o.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build())` is
      registered, `app.UseAuthorization()` is called explicitly immediately after
      `app.UseSessionAuthentication()` (`Program.cs:176`), and `SessionAuthenticationMiddleware`
      additionally populates `HttpContext.User` with an authenticated `ClaimsPrincipal` on a live
      session — so the default for every mapped endpoint (minimal API, MVC controller, SignalR
      hub) becomes "no live session → 401", expressed as one composition-root mechanism, never a
      per-endpoint opt-in check.
- [x] Given the fallback policy, when a policy failure occurs, then a custom
      `IAuthorizationMiddlewareResultHandler` maps a Challenge outcome to 401 and a Forbid outcome
      to 403 (no default challenge scheme is registered, so the default handler's behavior is not
      relied upon) and emits the XC-004 telemetry event below.
- [x] Given an allowlisted endpoint, when it is mapped, then it carries an explicit, commented
      `.AllowAnonymous()` (or the MVC/hub equivalent) at its own mapping call site — never reachable
      by omission.

### The pre-auth allowlist is exactly 11 routes
- [x] The allowlist is exactly the 11 routes enumerated in Context — no more, no fewer. Anonymous,
      host-resolved scope (`ExerciseResolutionMiddleware`) is consumable **only** by this list.
- [x] Given any other mapped endpoint — `GET /api/feed`, `GET /api/threads/{postId}`,
      `GET /api/personas`, `POST /api/posts`, the six participant-shell config reads
      (`/api/shell-state`, `/api/chrome-config`, `/api/brand-tokens`, `/api/channel-nav-config`,
      `/api/alerts`, `/api/overlay-state`), `POST /api/telemetry`, the `/api/staff/*` and
      `/api/engine/*` surfaces, and `/hubs/exercise` (both the hub connection and its `/negotiate`
      sibling) — when a request presents no live session, then it is rejected (401 for REST; the
      hub connection is aborted before `OnConnectedAsync` joins any group) before any
      handler/hub method runs, regardless of whether the `Host` header would otherwise resolve a
      scope.
- [x] Given the `/api/staff/*` and `/api/engine/*` endpoints, which already fail closed on "no live
      session" via `ICurrentStaffSessionAccessor` / `EngineCockpitStaffAuthorizationFilter`, when
      the new default-deny wrapper lands, then their existing 401/403 semantics are unchanged —
      this is a consistency/defense-in-depth pass over them, not a rewrite (verified by story 14).
- [x] Given `POST /api/auth/logout` (allowlisted), when it is called with no live session, then it
      still returns 204 (unchanged, deliberate — Decision 4).

### The SignalR hub is gated, with its paired frontend fix
- [x] Given an unauthenticated client, when it attempts to connect to `/hubs/exercise`, then the
      connection is refused by the fallback policy before `ExerciseRealtimeHub.OnConnectedAsync`
      ever runs (a stronger guarantee than the hub's own existing empty-scope abort, which still
      stands as defense-in-depth).
- [x] Given a live participant/staff/read-only session, when the frontend opens the shared
      `realtimeConnection` (`core/realtime/connection.ts`), then it is built with an
      `accessTokenFactory` supplying the session's bearer token, and `SessionTokenExtractor` accepts
      that token from the `?access_token=` query parameter on the hub path (and only the hub path)
      in addition to the `Authorization` header.

### Absent session is fail-closed at the gate, not merely "not read-only"
- [x] Given the new default-deny gate runs in `AuthorizationMiddleware` ahead of every endpoint
      filter, when a request with no live session reaches a sim-write endpoint, then it is rejected
      by the fallback policy before `ReadOnlySessionWriteFilter` ever runs; the filter's own doc
      comment (`ReadOnlySessionWriteFilter.cs:24-28`) is corrected to state that an absent session
      is now denied upstream, not "handled by the write endpoint's own fail-closed scope check"
      (which was never true) — no behavior change to the filter itself.

### Cross-cutting
- [x] **Isolation (XC-001/COR-001):** a session is the authenticated anchor of the exercise scope;
      an anonymous, host-resolved scope is no longer sufficient to reach any participant-facing
      read/write. Extends the standing isolation suite (`exercise-isolation/07`) with the
      no-credential-at-all case across the enumerated route list, distinct from the existing
      cross-exercise (A-session-reads-B) cases those stories already cover.
- [x] **Telemetry (XC-004):** a rejected unauthenticated attempt against a non-allowlisted endpoint
      emits an XC-004 event (additive vocabulary, `access.rejected`) — wall + scenario time (the
      exercise's stored scenario time, the B2 placeholder story 03 documents), `actor.kind:
      'system'`, no `personaId`/`actingHumanId` (there is no authenticated identity to attribute
      to), `channel: 'system'`, and the attempted route as the event target — mirroring the
      `outcome: 'failure'` pattern the login endpoints already use (`ParticipantLoginService`'s
      `BuildLoginTelemetry`/`FailureOutcomePayload`). Sized to avoid becoming its own DoS vector (no
      larger a write than the login-failure event already is; rate-limiting itself is Out of Scope).

### As-built behaviour worth recording (discovered in review, PR #384)

- **The gate answers only for a matched `RouteEndpoint`.** A fallback policy is evaluated even when routing
  matched nothing, so an unknown path (and ASP.NET's 405 sentinel, which is an `Endpoint` but not a
  `RouteEndpoint`) would otherwise have become 401 instead of 404/405. Two reasons that is wrong, both real:
  every frontend call to a route the backend does not serve would drive the shared axios interceptor's
  one-shot silent refresh — and for a session with **no** refresh token (the shared read-only login's
  envelope may omit one) that path *clears* the stored tokens, logging a read-only observer out mid-exercise;
  and the rejection telemetry becomes unbounded, because an unmatched request has no route pattern to
  coalesce on. `AccessRejectionResultHandler` therefore passes any non-`RouteEndpoint` request straight
  through. It costs the gate no coverage — all 53 real endpoints are `RouteEndpoint`s.
- **`WWW-Authenticate: Bearer` on the gate's 401 is load-bearing, not decoration.** It is RFC 6750-correct,
  and it is the only thing that distinguishes "the gate refused you" from "the handler ran and refused you" —
  `POST /api/auth/refresh` is allowlisted yet still 401s a request carrying no refresh token, so without a
  discriminator "the allowlist still works" could not be asserted behaviourally at all.
- **Every dimension of the `access.rejected` coalescing key must be bounded.** The route *pattern* was; the
  HTTP method was not (Kestrel accepts any RFC token, and an endpoint declaring no method constraint — the
  hub — matches an invented one), so `curl -X M1 … -X M2 …` walked past the window and wrote a durable row
  per request into the AAR table from a caller with no credential. `NormalizeMethod` collapses it to a fixed
  set.

## Out of Scope
`POST /api/posts` server-side attribution (COR-018) — story
`12-post-attribution-server-side.md` (#366). `POST /api/telemetry`'s client-supplied `exerciseId`
— story `13-telemetry-exercise-scope-authority.md` (#362). The anonymous-401 regression suite
itself — story `14-anonymous-access-regression-suite.md` (#367), though this story's own
ACs are unit/integration-verifiable without it. The same-origin topology work (#322). Removing or
restructuring the ops bootstrap endpoints — they are secret-gated by design and **stay** secret-gated;
this story only adds the `.AllowAnonymous()` mark that lets their existing gate keep working under
default-deny. Rate-limiting changes beyond what already exists (`participant-login`, `staff-login`,
`shared-login`, `session-endpoints` policies) — this story adds a gate, not a new limiter.
Consolidating the several session-lookup mechanisms
(`ISessionAuthenticator`/`ICurrentStaffSessionAccessor`/`IReadOnlySessionProbe`, and the new
`ICurrentSessionAccessor` story 12 adds) into one canonical seam — flagged as a follow-up in story
12, not attempted here. Replacing `EngineCockpitStaffAuthorizationFilter` — it already does the
right thing and is left as-is; it is the in-repo precedent this story's `FallbackPolicy` choice
generalizes.

**`/api/staff/*` and `/api/engine/*` stay exactly as they behave today** — they already fail closed
by their own means; this story's wrapper must not change their observable behavior, only add a
second, uniform layer underneath. Verified by test (story 14), never rewritten here.

## Technical Notes
**Backend + frontend; the composition root is the seam.** This story edits `Program.cs` directly —
**the documented exception to the orchestrator-owned composition-root rule.** It cannot run in
parallel with any other `Program.cs`-touching work; schedule it as a serial wave after every prior
identity-auth-roles wave has merged.

Owns/touches:
- `src/Pulse.WebApi/Program.cs` — `AddAuthorization` fallback-policy registration, the explicit
  `app.UseAuthorization()` call (positioned immediately after `app.UseSessionAuthentication()`,
  `Program.cs:176`), and the `.AllowAnonymous()` mark at each of the 11 allowlisted endpoints' own
  mapping call sites (`ExerciseContextEndpoints.cs`, `AccountEndpoints.cs` — `/api/auth/login`
  only, `StaffAuthEndpoints.cs` — `/api/auth/staff/login` only, `SharedReadOnlyEndpoints.cs` —
  `/api/auth/shared`, `SessionEndpoints.cs` — `/api/auth/refresh` and `/api/auth/logout`,
  `BootstrapEndpoints.cs` — all three ops routes, and the two `MapHealthChecks` calls).
- `Features/Identity/Sessions/SessionAuthenticationMiddleware.cs` — additive `HttpContext.User`
  population on a live session; no change to its existing precedence/host-binding logic.
- A new `IAuthorizationMiddlewareResultHandler` implementation (new file, likely
  `Features/Identity/Sessions/AccessRejectionResultHandler.cs`) — Challenge→401 / Forbid→403 +
  the `access.rejected` telemetry emit.
- `Features/Identity/Sessions/SessionTokenExtractor.cs` — the additional `?access_token=` query
  read, scoped to the hub path.
- `Features/Identity/SharedAccess/ReadOnlySessionWriteFilter.cs` — doc-comment correction only
  (`:24-28`).
- `src/frontend/src/core/realtime/connection.ts` — `accessTokenFactory` on
  `createDefaultHubConnection` (`:99-105`), sourced from the live session (`core/auth/session.tsx`
  / `useSession()`).

**Why not option (b) (`IEndpointFilter` + `MapGroup`), despite it being lower blast-radius per the
audit's own recommendation:** it cannot gate the MVC telemetry controller or the SignalR hub at
all — see Decision 1. This is not a close call once those two surfaces are accounted for.

## Dependencies
`identity-auth-roles/03` (sessions — `ISessionAuthenticator`, `SessionAuthenticationMiddleware`,
`Session.PersonaId`/`ActingHumanId`), `identity-auth-roles/05` (staff identity —
`ICurrentStaffSessionAccessor`), `identity-auth-roles/06` (shared read-only —
`ReadOnlySessionWriteFilter`, `IReadOnlySessionProbe`), `exercise-isolation/08` (host resolution —
the anonymous scope this story confines to the allowlist), `social-api` (`FeedEndpoints`,
`ThreadEndpoints`, `PersonaEndpoints`, `PostWriteEndpoints`, `RealtimeExtensions` — all inherit the
default-deny wrapper unchanged). Extends `exercise-isolation/07`'s standing isolation suite.

## Tests
- Composition: `AddAuthorization`'s fallback policy is registered; `app.UseAuthorization()` is
  positioned after `app.UseSessionAuthentication()` (an ordering regression test analogous to the
  existing host-then-session one).
- The 11 allowlisted routes remain reachable with no credential (spot-checked here; the exhaustive
  sweep is story 14).
- A non-allowlisted route (spot-checked: `GET /api/feed`, `POST /api/posts`) returns 401 with no
  credential.
- `POST /api/telemetry` (MVC controller) returns 401 with no credential — the mechanism-choice
  proof point that an `IEndpointFilter` could not have delivered.
- An unauthenticated SignalR connection to `/hubs/exercise` is refused before
  `OnConnectedAsync` joins any group.
- A live session's `accessTokenFactory`-supplied token is accepted by the hub via
  `?access_token=`; `SessionTokenExtractor` does not accept a query-string token on a non-hub
  route (regression guard against a token-in-URL leak elsewhere).
- `ReadOnlySessionWriteFilter`: unchanged behavior — a live read-only session is still denied
  (403); the doc comment no longer claims the absent-session case is handled elsewhere without
  citing this story's gate.
- Isolation-suite extension (`exercise-isolation/07`): the no-credential-at-all case, distinct from
  the existing cross-exercise (session-A-reads-B) cases.
- Telemetry: a rejected unauthenticated attempt emits the `access.rejected` v0 event with no actor
  identity.
