# Story: Per-exercise hostname → exercise resolution [TIER-2]

**Feature:** Exercise isolation  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-008  ·  **Design decisions:** none  ·  **Issue:** #51
**Stack:** fullstack  ·  **Review:** Tier-2 (human sign-off — the scope-resolution seam; always-Critical isolation)

## Context
Each exercise gets its own subdomain (e.g. `atl-cie.{platform-domain}.com`), optionally a
customer-branded domain (the Looking Glass pattern). The hostname scopes the participant session's
exercise, is the participant's only entry point (URL + shared password is the entire onboarding), and
no shared/marketing domain is ever participant-visible (COR-008).

**Phase B2 backend build (`docs/BACKEND_ROADMAP.md` §4).** This story now also builds the server-side
host → exercise resolution and **wires it into the real `ExerciseContext`** that B0 stood up. It is the
**scope-resolution seam**: an ASP.NET Core middleware (`UseExerciseResolution()`) maps the request's
`Host` header / subdomain to an `Exercise` and **sets `ExerciseContext.CurrentExerciseId`** in the
request scope — the settable seam `Data/ExerciseContext.cs` documents stories 08/04/05 as its
populators. It also serves the frozen `GET /exercise-context` resolver
(`src/frontend/src/core/exerciseContext/exerciseContextResolver.ts`). Unknown host **fails closed** (no
scope resolved → the B0 read-side global query filter matches zero rows). This story owns the
**population-precedence** decision (below); it is the crux the whole isolation guarantee rests on.

## Acceptance Criteria
- [ ] A participant reaching an exercise's hostname has their session scoped to that exercise (pairs
      with story 04 — no exercise picker).
- [ ] No shared or marketing domain is participant-visible; the exercise hostname + shared credential
      (COR-015) is the complete onboarding.
- [ ] Hostname/certificate/DNS provisioning is automated (wildcard/automated cert + DNS) with a stated
      lead-time SLA.
- [ ] An optional customer-branded domain is supported per exercise.

### Backend — host resolution wired into `ExerciseContext` (COR-008, COR-001)
- [ ] Given a request whose `Host` header matches a provisioned exercise hostname (subdomain or
      customer-branded domain), when `UseExerciseResolution()` runs, then it resolves the owning
      `Exercise` from a host → exercise map and **sets `ExerciseContext.CurrentExerciseId`** (the
      Scoped `Data/ExerciseContext.cs` setter) for the remainder of the request scope.
- [ ] Given a request whose `Host` header matches **no** provisioned exercise, when the middleware
      runs, then it leaves `CurrentExerciseId` **unset** (fail-closed: `null` → `Guid.Empty` → the B0
      global query filter returns zero rows) — never a default, aggregate, or "first" exercise.
- [ ] **Population precedence (this story defines it):** an authenticated **session** scope (story 03,
      incl. the staff active-exercise selection, story 05) **overrides** host resolution; host
      resolution scopes **anonymous / pre-auth** participant requests (the login page, the first
      `GET /exercise-context` before login); an unresolved scope is the fail-closed floor. Ordering:
      `UseExerciseResolution()` runs **before** the auth/session layer in `Program.cs`, so the session
      layer's write to `CurrentExerciseId` (when a valid session exists) takes precedence. Documented in
      this story and mirrored in `identity-auth-roles/03` and `05`.
- [ ] For a participant, an authenticated session's bound exercise **must equal** the host's resolved
      exercise; a mismatch **fails closed** (401/403, logged) — a session for exercise A presented on
      exercise B's host is never honored.
- [ ] `GET /exercise-context` (frozen resolver contract) returns the resolved scope as the exact
      `ExerciseScope` shape `{ exerciseId, exerciseName, timeZone, status }` for exactly one exercise —
      **no list, no picker, no simulation-status/admin surface** (COR-004, XC-002); it reads the
      resolved `ExerciseContext`, never a client-supplied `exerciseId`.

### Cross-cutting
- [ ] **Isolation (XC-001/COR-001):** this middleware *is* the participant-side realization of the
      central scope. A request on exercise A's host (or an authenticated A session) can never read
      exercise B rows; a spoofed/unknown/omitted `Host` yields zero rows, not all exercises. Extends the
      standing cross-exercise suite (`exercise-isolation/07`) with a host-resolution case:
      A-host session → B rows = empty/403.
- [ ] **Content security (NFR-004):** the `Host` header is validated against the provisioned map (exact
      match, case-normalized); an unmatched or malformed host is rejected/unscoped and never used to
      build a query, a redirect target, or a rendered value (no Host-header injection).
- [ ] **Frozen-seam flip (fullstack):** flipping `exerciseContextResolver`'s single
      `USE_MOCK_EXERCISE_CONTEXT` point to live makes `GET /exercise-context` return this server scope
      with **no consumer change** — the response shape matches `ExerciseScope` field-for-field. The flip
      is an orchestrator-owned integration edit (see implementation.md Integration seam).

## Out of Scope
The shared credential itself (identity-auth-roles COR-015 / story 06); network-filter readiness (story
09); the landing surface (story 04 / E2); the **session** that overrides host scope (identity-auth-roles
story 03 owns `/session` and session issuance); the **staff** active-exercise population of the same seam
(identity-auth-roles story 05); the backend native scenario clock (COR-050, Phase B3) — `status`/time
metadata in `ExerciseScope` come from the `Exercise` entity's stored config this phase.

## Technical Notes
Foundation/infra + backend (the scope-resolution seam). Wildcard + automated certificate/DNS
provisioning; the host maps to an exercise for session scoping. **Backend:** owns
`src/Pulse.WebApi/Features/ExerciseResolution/` (or `Data/Extensions/`) — the host→exercise map, the
`UseExerciseResolution()` middleware + `AddExerciseResolution()` DI extension, and the
`GET /api/exercise-context` endpoint (minimal-API extension class, mirroring `Features/Social/*`). It
**writes** the B0 `ExerciseContext.CurrentExerciseId` setter and **reads** the `Exercise` DbSet on
`PulseDbContext` — it does not stand up a new context. `Program.cs` gets two orchestrator-owned lines
(`AddExerciseResolution()` + `app.UseExerciseResolution()` early in the pipeline, before auth).
**Frontend:** the frozen resolver stays untouched at the module level; only the `USE_MOCK_EXERCISE_CONTEXT`
flip point turns live. See implementation.md (story 08) + the Integration seam.

## Dependencies
`backend-host/02-persistence-efcore` (the `Exercise` entity + `PulseDbContext`) and `AddExerciseScoping`
(the `ExerciseContext` seam) — Phase B0, landed. Hosting/infra (Azure) for cert/DNS. Feeds
identity-auth-roles story 03 (session precedence) and story 04 (host-scoped participant routing).
COR-015 shared credential (story 06) is the paired onboarding half.

## Tests
- Integration: a request to exercise A's host resolves `CurrentExerciseId` to A and A-scoped queries
  return only A rows; an unknown/spoofed host leaves scope unset and every scoped query returns empty.
- Integration: an authenticated session's exercise overrides host resolution (precedence); a
  participant session presented on the wrong host fails closed.
- Contract: `GET /api/exercise-context` returns `{ exerciseId, exerciseName, timeZone, status }` exactly
  (the frozen `ExerciseScope`); no list/collection is ever returned.
- Part of the standing isolation suite (story 07) — the host-resolution cross-exercise case.

### Backend test linkage (B2 Wave 1 build)
- Host → exercise map + resolver (backend AC: resolves owning `Exercise`, sets scope):
  `HostExerciseResolverTests.Resolves_ByHostname_ToTheOwningExercise`,
  `HostExerciseResolverTests.Resolves_ByBrandedDomain_ToTheOwningExercise`,
  `HostExerciseResolverTests.Resolves_CaseInsensitively_ViaCollation` (real SQL, `[RequiresDockerFact]`);
  `ExerciseResolutionMiddlewareTests.ResolvedHost_SetsScope_AndStashesForSessionLayer`.
- Unmatched/absent host leaves `CurrentExerciseId` unset — fail closed (backend AC):
  `ExerciseResolutionMiddlewareTests.UnresolvedHost_LeavesScopeUnset_AndStashesNothing_FailClosed`,
  `ExerciseResolutionMiddlewareTests.EmptyGuidFromResolver_IsTreatedAsUnresolved_FailClosed`,
  `HostExerciseResolverTests.UnknownHost_ResolvesToNull_FailClosed`.
- Content security — host validated exact/case-normalized, malformed rejected & never used to build a
  query (NFR-004): `ExerciseHostNameTests.*`,
  `HostExerciseResolverTests.MalformedHost_ResolvesToNull_WithoutQuerying`.
- Contract — frozen `ExerciseScope` shape for exactly one exercise (XC-002, no list):
  `ExerciseScopeDtoTests.*` (Wave-0).
- Deferred to `testing-agent` (extends the standing story-07 suite, `[RequiresDockerFact]`): full
  middleware→endpoint `GET /api/exercise-context` integration (200 on a resolved host, 404 fail-closed on an
  unknown host) once the orchestrator wires `UseExerciseResolution()`/`MapExerciseContextEndpoints()` into
  `Program.cs`; the cross-exercise "A-host request → B rows = empty" case; and the cross-wave
  session-vs-host mismatch (needs the story-03 session layer, Wave 2).
