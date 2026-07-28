# Story: Anonymous-access regression suite — every non-allowlisted route fail-closes

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** COR-012 (with COR-001 implicated)  ·  **Design decisions:** none  ·  **Issue:** #367
**Stack:** backend  ·  **Review:** Tier-2 (auth surface + the isolation seam — always-Critical class)

> **Split from [`11-api-session-enforcement.md`](11-api-session-enforcement.md) (#361), Wave 3 — the
> audit's own "highest-leverage item."** Verifies stories 11 and 12 and 13 together; must land after all
> three.

## Context
`ENDPOINT-AUTH-AUDIT.md`'s root-cause section: *"Why nothing caught it: the SPA always attaches a
bearer token, and every existing test authenticates first. Neither production use nor CI ever
walked the anonymous path. The frontend was the security boundary."* Twelve routes (plus both
`/hubs/exercise` endpoints) were open to a completely unauthenticated caller, in a codebase with a
**747-test** suite, for exactly this reason: no test in the suite has ever presented a request with
no credential at all. This story is the test class that would have caught `#359` before it shipped
— and the same blind spot must be assumed for anything built after this story too, which is why its
central design point is enumeration, not a fixed list (below).

## Acceptance Criteria

### Enumeration from the live host, not a hand-maintained list
- [x] Given a real `WebApplicationFactory<Program>` host (mirroring
      `Pulse.WebApi.Tests/Features/Ops/Bootstrap/CompositionRootWiringTests.cs` and
      `Pulse.WebApi.Tests/Features/Social/CompositionRootWiringTests.cs`, both of which already
      resolve the aggregate `EndpointDataSource` from `factory.Services`), when the suite runs, then
      it enumerates every mapped `RouteEndpoint` from that live `EndpointDataSource` — **never** a
      hand-typed list of route strings — so a newly added endpoint is covered automatically without
      anyone writing a new test for it.
- [x] Given the enumerated route list, when a route is **not** one of the 11 allowlisted routes
      (`GET /api/exercise-context`, `POST /api/auth/login`, `POST /api/auth/staff/login`,
      `POST /api/auth/shared`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /health`,
      `GET /health/ready`, `POST /api/ops/bootstrap-exercise`, `POST /api/ops/seed-engine-content`,
      `POST /api/ops/bind-participant-persona`), when it is called with no `Authorization` header
      and no cookie, then it returns 401.
- [x] Given the same enumeration, when a route **is** one of the 11 allowlisted routes, then it
      remains reachable with no credential (i.e. does not 401 for that reason — a 400 for a missing
      body, or a 404 for the ops secret gate, is a different and acceptable outcome; only a 401
      caused by the new default-deny gate is the regression this checks for).
- [x] The allowlist itself is the **only** hand-maintained artifact in this suite — expressed as a
      single, explicitly reviewed constant (ideally the same one story 11's `.AllowAnonymous()`
      marks reference, so the two cannot drift apart) — and extending it is a deliberate, visible
      diff, never an accidental new opt-out. *(`PreAuthAllowlist`, unchanged by this story. The one
      other hand-maintained list is a single-entry, self-policing exception — see Decision 3.)*

### The hub and the staff/engine surfaces
- [x] Given an unauthenticated client, when it attempts to connect to `/hubs/exercise`, then the
      connection is aborted and it joins no SignalR group (extends
      `ExerciseRealtimeHub.OnConnectedAsync`'s existing empty-scope-abort test with the
      no-credential-at-all case). *(Plus a plain-HTTP probe of `/hubs/exercise/negotiate` — the
      exploit's actual first step, and the endpoint a SignalR client alone does not isolate.)*
- [x] Given the `/api/staff/*` and `/api/engine/*` surfaces (already gated by
      `ICurrentStaffSessionAccessor` / `EngineCockpitStaffAuthorizationFilter` before this feature's
      stories 11-13 existed), when the default-deny wrapper lands, then they return their existing
      401/403 — unchanged — including the three previously **un-probed**
      `/api/engine/review/{draftId}/edit`, `/re-roll`, `/veto` routes (the audit inferred their
      behavior from the shared `MapGroup` filter rather than probing them individually; this suite
      asserts them directly). *(Asserted in BOTH directions — see Decision 2, which is the half that
      keeps this AC from being vacuous.)*

## Decisions made during the build

**1. One `[Fact]` with an `AssertionScope`, not a `[MemberData]` theory.** The AC asks for
"parameterized over the live `EndpointDataSource`". A theory would have to build the host during xUnit's
**discovery** phase, where the process-wide `ConnectionStrings__DefaultConnection` mutation the factory needs has
no ordering guarantee against other classes' hosts (`AssemblyInfo.cs` disables *execution* parallelization, not
discovery). A single fact wrapped in `AssertionScope` gives what the theory was for — every failing route reported
in one run, not just the first — with one host build and no discovery-time hazard.

**2. The sweep asserts staff/engine authorization in BOTH directions, and the second one is the point.** Story 11's
gate now answers first for an anonymous caller, which means an anonymous-only probe of `/api/staff/*` and
`/api/engine/*` would pass **even if `EngineCockpitStaffAuthorizationFilter` and the staff endpoints' own
`ICurrentStaffSessionAccessor` checks were deleted outright**. A suite that only probed anonymously would therefore
have gone non-discriminating about the staff-only guarantee (XC-002) the moment the gate landed — which is exactly
what happened to a test in another feature after story 12 (WR-003 on #388). So the suite also presents a **live
non-staff session**, gets past the gate, and requires the pre-existing filters to be the ones that refuse. Absence
of `WWW-Authenticate` is the proof of authorship.

**3. Two mechanisms make a route unprobeable for *authorization*; one is handled by enumeration, one is a filed
finding.** Minimal-API **parameter binding runs before endpoint filters**, so a body the binder rejects means the
authorization filter never executes — and the test would look green while proving nothing.
- *Content-type binding* (`POST /api/staff/accounts/import` binds an `IFormFile`, so JSON gets 415 before any
  filter): solved by enumeration, not a list — the probe reads each endpoint's own inferred `IAcceptsMetadata` and
  sends multipart where the endpoint asks for it. Same principle as the route set itself.
- *Body-validated-before-identity* (`POST /api/staff/active-exercise` returns its own
  `BadRequest("exerciseId must be a GUID.")` before calling the only service that can report
  `Unauthenticated`/`NotAssigned`): a genuine finding, **filed as #393 rather than folded in**, per this story's
  own Out of Scope. Not a vulnerability — an anonymous caller never reaches it and the handler never reaches the
  service — but it is the same *shape* as the pattern that caused #359. It is the suite's single named exception,
  and the exception is self-policing: every listed route must still be mapped, and every route **not** listed must
  return a real 401/403, so a future endpoint acquiring this shape fails the suite and forces a decision.

**4. The guard was verified to bite, not assumed to.** The `FallbackPolicy` was temporarily replaced with a
permissive `RequireAssertion(_ => true)`: **4 of the 10 tests failed**, and the file was restored. A sweep that
cannot fail is a sweep that proves nothing, and this one had to be shown to fail for the right reason.

## Out of Scope
Fixing any newly-discovered gap beyond what stories 11/12/13 already close — a genuinely new
finding from running this suite gets its own issue, not a silent fix folded into this one.
Rate-limiting behavior (covered by the existing per-policy tests). Load/performance testing of the
`AuthorizationMiddleware` path. `#322` (same-origin topology).

## Technical Notes
**Backend only, test project.** New file, likely
`Pulse.WebApi.Tests/Features/Identity/Sessions/AnonymousAccessRegressionTests.cs`, following the
`WiringProbeFactory` pattern both existing `CompositionRootWiringTests.cs` files use (a dummy,
never-connecting connection string set as a process env var in the factory constructor, cleared on
dispose — enumerating/calling endpoints for a 401 check needs the host to *build* and *route*, not
to reach a live database for most of them; where a route's own logic needs a DB before it would
401, prefer asserting the 401 arrives before that logic runs at all, per story 11's gate ordering).

**Two known traps, both worth calling out explicitly in the PR description:**
1. **Naming a service method `BindAsync` (or `TryParse`) breaks the *entire* minimal-API route
   table.** `ParameterBindingMethodCache` assumes the custom-binding convention those method names
   trigger and throws while building the `EndpointDataSource` — a completely unrelated-looking
   naming choice anywhere in the codebase can make this suite (and every other endpoint test) fail
   to even construct the factory. If the host fails to build, check for this before assuming the
   new gate broke something.
2. **A slice can merge fully green with its `Program.cs` wiring never executed** (#310/#317) because
   self-mapped `TestServer` tests mask it — a slice's own HTTP tests map the endpoint in their own
   `TestServer` and stay green even if the real host never maps it. This suite must assert against
   the **real** `WebApplicationFactory<Program>` host exclusively, never a self-hosted one, or it
   would silently validate nothing.

**Baseline to preserve:** 747 passing / 0 skipped on `main` with `PULSE_TEST_SQL_CONNECTION` set to
LocalDB (`[RequiresDockerFact]` tests included). This suite adds to that count; it must not reduce
it or introduce a new skip.

> **As built.** The baseline had moved a long way by the time this landed: **1506** on `main` after story 13
> (#392), **1516** with this suite's 10 tests, 0 skipped, `[RequiresDockerFact]` suites executing against LocalDB.
> One file, test-project only: `Pulse.WebApi.Tests/Features/Identity/Sessions/AnonymousAccessRegressionTests.cs`.
> No production code changed — which is the honest outcome for a regression-suite story, and the reason the two
> findings it surfaced went to #393 rather than into this diff.

Cross-reference `implementation.md`'s per-story tech notes and Wave Plan — this story is scheduled
after 11, 12, and 13 have all merged, since it asserts their combined behavior.

## Dependencies
`identity-auth-roles/11` (the default-deny gate + 11-route allowlist this suite verifies),
`identity-auth-roles/12` (`POST /api/posts` attribution — asserted incidentally by the "not
allowlisted → 401" sweep, though its attribution-specific ACs are story 12's own tests),
`identity-auth-roles/13` (`POST /api/telemetry` — likewise). `Pulse.WebApi.Tests/Features/Ops/
Bootstrap/CompositionRootWiringTests.cs` and `Pulse.WebApi.Tests/Features/Social/
CompositionRootWiringTests.cs` (the `EndpointDataSource`-enumeration pattern this story follows).

## Tests
This story *is* the test suite — its own ACs are the tests. Summarized:
- Every enumerated, non-allowlisted `RouteEndpoint` returns 401 with no credential (parameterized
  over the live `EndpointDataSource`, not a hand list).
- Every one of the 11 allowlisted routes remains reachable with no credential.
- An unauthenticated `/hubs/exercise` connection is aborted, joins no group.
- `/api/staff/*` + `/api/engine/*` (incl. `edit`/`re-roll`/`veto`) return their pre-existing
  401/403, unchanged.
- Suite runs green in the same CI lane as the existing 747, with `PULSE_TEST_SQL_CONNECTION` set to
  LocalDB, adding to (never reducing) that count.
