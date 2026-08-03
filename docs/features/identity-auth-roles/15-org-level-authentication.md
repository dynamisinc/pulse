# Story: Org-level authentication for OrgAdmin (a session with no exercise scope)

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-077 (new — see below)  ·  **Design decisions:** none  ·  **Issue:** —
**Stack:** backend  ·  **Review:** Tier-2 (the authentication path + the session model — this story asks the
schema to represent a session with an organization scope but **no** exercise scope, which nothing in
`Pulse.WebApi` does today)

## Context
`orgAdmin` shipped this wave as a real server-side role
(`docs/features/exercise-lifecycle-admin/03-orgadmin-surface-family.md`, COR-076): its own authorization
filter (`OrgAdminAuthorizationFilter`) and its own org-scoped reads
(`GET /api/org/exercises`, `POST /api/org/exercises`, `GET /api/org/staff-assignments`). But nothing about
*how an OrgAdmin gets a session in the first place* changed, and that path has a structural hole this
story exists to name and scope (not to silently patch):

- `orgAdmin` is an **organization-tier** role — it exists above the exercise, and one of its own jobs
  (COR-074) is creating the organization's *first* exercise.
- `StaffLoginService.LoginAsync` (`src/Pulse.WebApi/Features/Identity/Staff/StaffLoginService.cs`) rejects
  the request before authentication even runs unless `request.ExerciseId` parses to a **real, persisted**
  `Exercise` (lines 91-111): an unparsable/empty id is a 400 (`Invalid`), an id that resolves to nothing is
  also a 400, and — only past that gate — the caller's `StaffAssignment` **on that specific exercise** is
  looked up (lines 183-197) and a missing assignment is a 403 (`NotAssigned`). There is no request shape
  that reaches a session for a caller whose organization owns **zero** exercises: there is no `Exercise` row
  to name, so step 2 fails before role/assignment are ever considered.
- `StaffCallerContext` (`src/Pulse.WebApi/Features/ExerciseLifecycleAdmin/StaffCallerContext.cs`) reads the
  role verbatim off that minted session's row (`Sessions.Role`) — so today's `orgAdmin` role is only ever
  reachable as a side effect of an `Exercise`-bound `StaffAssignment` existing, exactly like
  controller/evaluator/planner. Nothing in the schema distinguishes "a role that operates above one
  exercise" from "a role that operates inside one."
- **The frontend deepens the same hole, independently.** `staffSignInService.ts`'s own header is explicit:
  `exerciseId` is "HOST-resolved, never user-entered" — the staff sign-in page derives the exercise from the
  hostname the console is served on (COR-008). An organization with zero exercises has never allocated a
  hostname (allocation is part of exercise creation, COR-074), so there is today no staff-console URL an
  empty organization's OrgAdmin could even land on to attempt a login, independent of anything this story
  changes server-side. This story is backend-only (see Out of Scope) and explicitly does not solve that
  half; it is named here so the follow-on frontend work is not lost.

**Consequence:** the role whose purpose includes creating an organization's first exercise cannot itself
authenticate until an exercise already exists. Chicken-and-egg.

**What is already decided, and is NOT this story.** The user chose "seed now, fix the model next": a
parallel effort is building an idempotent, non-production startup seeder that grants a named human
`orgAdmin` assignments across an organization's **existing** exercises. That unblocks local/UAT work today
but explicitly does not touch the empty-organization case — a freshly-created organization with literally
zero exercises still cannot authenticate an OrgAdmin through any path, seeded or not. This story owns that
remaining case. It is filed as a new epic requirement (COR-077, below) rather than folded silently into
COR-076, because COR-076 is about the OrgAdmin **surface** (what an OrgAdmin can reach once signed in) and
says nothing about how the session is minted — this is the prior, distinct problem.

### Why this story lives in `identity-auth-roles`, not `exercise-lifecycle-admin`
Two features could plausibly own this. `exercise-lifecycle-admin` owns COR-076 (the OrgAdmin **surface**)
and its own "Known gaps" section already names half of this problem. But the actual work here — changing
`StaffLoginService.LoginAsync`'s request/validation shape, the `Session`/`SessionIssueRequest`/
`AuthenticatedSession` exercise-scope representation, and `SessionAuthenticationMiddleware`'s precedence
write — is squarely inside `identity-auth-roles`'s owned surface: story 05 built exactly these files
(`StaffLoginService`, `StaffUser`/`StaffAssignment`, the staff login endpoint) and story 03 owns the
`Session` model and issuance seam this story must extend. `exercise-lifecycle-admin/03` is the
**consumer** of the fix (an OrgAdmin session, however it is minted, is what lets that story's routing and
authorization work at all) but does not own the authentication mechanism itself. Cross-referenced from both
`exercise-lifecycle-admin/03-orgadmin-surface-family.md` and its `feature.md`.

## The new requirement (COR-077)
No existing requirement states that a role can authenticate without an exercise-bound `StaffAssignment`.
COR-010 names the role; COR-014 says staff authenticate against the Dynamis IdP; COR-076 says the surface
exists once signed in — none of the three says anything about the shape of the session an org-level role
needs. Filed at `docs/01-platform-core-isolation.md` §4 F1.7, alongside COR-070–076, per that section's
own stated practice (coin new IDs in the epic first, not in a downstream doc) — see that file's diff.

## Acceptance Criteria
- [ ] **Org-level login succeeds with zero `StaffAssignment` rows.** Given an `orgAdmin`-designated
      `StaffUser` whose organization owns zero exercises (and who therefore holds zero `StaffAssignment`
      rows, since every existing row is `Exercise`-scoped), when they present valid credentials through a
      login request that names no exercise, then the funnel authenticates them and mints a live, org-scoped
      session with role `orgAdmin` — succeeding where `StaffLoginService.LoginAsync` fails closed for this
      caller today under every request shape (empty/absent `exerciseId` → 400 at validation; a fabricated
      GUID → 400 at the `Exercises` lookup; a real but foreign exercise → 403 at the assignment check).
- [ ] **The session shape represents "no exercise" structurally, not via the existing sentinel.** Given a
      minted org-level session, then its exercise-scope value is distinguishable, at every consumer, from
      both a real `Exercise.Id` and `Guid.Empty` (today's "unresolved scope" sentinel, which the write-guard
      already forbids on every scoped row and which the central query filter already treats as "match
      nothing"). Reusing `Guid.Empty` to *also* mean "this session deliberately has no exercise" is not an
      acceptable implementation of this AC — it collapses two different facts ("scope not yet resolved" vs.
      "scope deliberately absent") onto one value, in a codebase where the entire isolation guarantee rests
      on that sentinel meaning exactly one thing. This is the crux of the story; see Technical Notes for the
      shapes considered.
- [ ] **Every exercise-scoped path still fails closed under an org-level session — never widens.** Given an
      org-level session (no exercise scope), when any `IExerciseScoped` read or write is attempted under it
      (feed, personas, posts, or any other participant-facing endpoint reachable via a staff-kind session),
      then the request fails closed exactly as an unresolved scope does today (401/403, or zero rows,
      per the endpoint's existing behavior) — it must never be honored as "every exercise." Extends the
      standing isolation suite (`exercise-isolation/07`) with an explicit "staff session, no exercise scope"
      case, distinct from the existing "no session at all" case.
- [ ] **`OrganizationResolutionMiddleware`'s tenant resolution is proven under this session shape, not
      assumed.** Given an org-level session, when `OrganizationResolutionMiddleware` runs, then it resolves
      the caller's tenant from `StaffUser.OrganizationId` exactly as it does for an exercise-bound staff
      session today — its lookup is already keyed on `StaffUserId` alone
      (`OrganizationResolutionMiddleware.ResolveTenantAsync`) and reads no exercise scope, so this AC is a
      proof obligation (an explicit integration test with no exercise anywhere in the request) rather than
      new production code in that middleware.
- [ ] **The two already-built COR-074/075/076 endpoints keep working, unchanged, under this session
      shape.** Given an org-level session, when `GET /api/org/exercises`, `POST /api/org/exercises`, and
      `GET /api/org/staff-assignments` are called, then all three succeed exactly as they do for an
      exercise-bound `orgAdmin` session today, because `StaffCallerContext.ResolveAsync` reads role off
      `Sessions.Role` and tenant off `IOrganizationContext` and never reads `Session.ExerciseId`. This story
      does not need to touch `ExerciseLifecycleAdminEndpoints`, `StaffCallerContext`, or
      `OrgAdminAuthorizationFilter` for this AC — it is a regression proof, not new behavior, but it has not
      been tested against a session with no exercise at all until this story exists.
- [ ] **The existing exercise-bound staff login path is unchanged.** Given a `StaffUser` (any role,
      including `orgAdmin` for an organization that already has an assigned exercise) who logs in through
      today's request shape (naming a real exercise, with a matching `StaffAssignment`), then behavior is
      byte-for-byte identical to today — this story adds a second, additive path; it does not alter,
      branch inside, or weaken the first.

### Cross-cutting
- [ ] **Isolation (XC-001/COR-001):** an org-level session's tenant scope (COR-010) is proven correct and
      its exercise scope is proven absent-and-fail-closed (both covered by the ACs above) — attached
      explicitly because this is the first session shape in the codebase that is deliberately org-scoped
      and exercise-unscoped at once, and the standing suite has never had a case for it.
- [ ] **Telemetry (XC-004) — flagged unresolved, not answered by this story.** A successful or failed staff
      login already emits exactly one XC-004 event (`StaffLoginService.BuildLoginTelemetry`), stamped with
      the login's `ExerciseId`. `TelemetryEvent` (`src/Pulse.WebApi/Data/Entities/TelemetryEvent.cs`) itself
      implements `IExerciseScoped` with a **non-nullable, write-guard-enforced** `ExerciseId` — so an
      org-level login attempt has no exercise to stamp its own audit event with under the current schema.
      This AC requires that the event is not silently dropped (a login attempt — success or failure — must
      still be auditable); it deliberately does not prescribe the fix (a nullable/organization-scoped
      telemetry axis, a distinct org-tier event store, or something else) — that decision belongs to
      whoever picks this story up, informed by whatever shape Acceptance Criterion 2 above lands on.

## Out of Scope
- **The dev/UAT-only idempotent seeder** granting a named human `orgAdmin` assignments across an
  organization's *existing* exercises — built in parallel, explicitly out of this story's scope, and
  explicitly does not solve the empty-organization case this story owns.
- **Any change to the participant login path** (`Account`/participant sessions are untouched — this story
  is entirely inside the `staff`-kind session).
- **Widening `isStaffRole()` / `STAFF_ROLES` / `PARTICIPANT_ROLES`** in
  `src/frontend/src/core/auth/roles.ts` — `orgAdmin` stays deliberately outside both sets (XC-002); this
  story does not touch that module.
- **The frontend staff sign-in form / `staffSignInService.ts`'s host-resolved `exerciseId`.** As noted in
  Context, the current sign-in page cannot reach an org-level login at all (no hostname exists for an
  empty organization to serve a console from) — that is real follow-on frontend work, tracked here as a
  named gap, not built by this story. This story's own AC1 is satisfiable by any request shape the backend
  accepts (e.g. a new endpoint, or the existing one with an optional `exerciseId`); it does not require or
  imply a particular UI.
- **Provisioning the FIRST `orgAdmin` of a brand-new organization in a real (non-seeded) production
  deployment.** This remains unanswered after this story lands. `BootstrapService.CanonicalStaffRoles`
  (`src/Pulse.WebApi/Features/Ops/Bootstrap/BootstrapService.cs`, line ~82) accepts only
  `controller`/`evaluator`/`planner` — adding `orgAdmin` to that map is a one-line change nothing in this
  story's ACs asks for, and the bootstrap seam is explicitly documented elsewhere as unreachable in a real
  customer-facing deployment (`exercise-lifecycle-admin/feature.md`), so it is not this story's job to make
  it the production answer either. This story makes org-level **authentication** possible once an
  `orgAdmin` grant exists; it does not decide how that first grant is created in production.
- **Assignment administration (granting/revoking an org-level role)** — no AC here asks for a write path;
  `exercise-lifecycle-admin/03`'s own "Known gaps" already tracks that "administer" is read-only today.
- **`RoleAwareEntry`'s frontend routing branch for `orgAdmin`** — tracked entirely in
  `exercise-lifecycle-admin/03`; this story only makes the session that branch would route on possible to
  mint for an empty organization.

## Technical Notes
Staff world (COBRA) — no participant surface, no UI in this story. Backend only.

**Where the non-nullable `ExerciseId` lives today (the schema surface AC2 must change or wrap):**
- `Data/Entities/Session.cs` — `public Guid ExerciseId { get; set; }` (plain column, deliberately not
  `IExerciseScoped` per its own remarks, but still a non-nullable `Guid`).
- `Features/Identity/Sessions/ISessionIssuer.cs` — `SessionIssueRequest.ExerciseId` is `required Guid`.
- `Features/Identity/Sessions/ISessionAuthenticator.cs` — `AuthenticatedSession.ExerciseId` is `required Guid`.
- `Features/Identity/Sessions/SessionAuthenticationMiddleware.cs` — unconditionally writes
  `settableExerciseContext.CurrentExerciseId = authenticated.ExerciseId` on every live session; an org-level
  session needs this write to either not happen or to write an explicit "no scope" value, without
  regressing the precedence contract the middleware's own remarks describe in detail (session > host >
  unset).
- `Data/PulseDbContext.cs` — the exercise-axis global filter already fails closed to `Guid.Empty` for an
  *unresolved* scope; this story must not make "deliberately absent" indistinguishable from that at the
  point any test or future reviewer needs to tell them apart (AC2).

**Two shapes were visible while reading the code; this story does not pick one — it is the Tier-2
decision the reviewer signs off on:**
1. **A new org-level grant, independent of `StaffAssignment`.** E.g. a `StaffUser`↔`Organization`↔`Role`
   record with no `ExerciseId` at all, resolved by a login path that accepts no exercise. Cleanest
   separation of concerns, but a second grant table alongside `StaffAssignment` for the codebase to keep in
   sync with COR-005/`exercise-isolation/11`'s existing cross-tenant checks.
2. **`StaffAssignment.ExerciseId` becomes nullable** — a row with `ExerciseId == null` and
   `Role == "orgAdmin"` is an org-level grant, reusing the existing lookup/table. Minimal new surface, but
   loosens `StaffAssignment`'s current invariant ("an access record naming one real exercise") that the
   switcher (`exercise-isolation/05`), the assignment list, and `exercise-isolation/11`'s cross-tenant
   checks all currently assume holds for every row.

Whichever shape is chosen, `StaffLoginService.LoginAsync` needs a second entry path (or a widened first
one) that does not reject at steps 1-2 (lines 91-111) when no exercise is named, and
`SessionAuthenticationMiddleware` needs an explicit branch for a session whose exercise scope is absent
rather than assuming `AuthenticatedSession.ExerciseId` is always meaningful. See implementation.md (once
this story is picked up) for the wave/reuse map.

## Dependencies
`identity-auth-roles/05` (`StaffLoginService`, `StaffUser`/`StaffAssignment`, the staff login endpoint —
Complete; this story extends it). `exercise-isolation/11` (the `Organization` tenant tier +
`OrganizationResolutionMiddleware` — Built, awaiting Tier-2 sign-off; this story's AC4 depends on that
middleware's existing behavior, unchanged). `exercise-lifecycle-admin/03` (the OrgAdmin surface family —
Backend built; this story is what lets an empty organization ever reach it, but does not depend on its
frontend routing work). Not dependent on, and explicitly disjoint from, the dev/UAT seeder described in
Context.

## Tests
No tests exist yet (Not Started). Each AC above will need a case in these existing suites (real files,
confirmed by reading the current test tree) rather than a new top-level test project:
- **AC1/AC6** — `StaffLoginServiceTests` (`src/Pulse.WebApi.Tests/Features/Identity/Staff/`): a new
  org-level-login success case alongside the existing `Login_Success_…`/`Login_UnknownExercise_Invalid_…`/
  `Login_AuthenticatedButNotAssigned_Forbidden_…` cases, plus a regression assertion that the existing
  exercise-bound cases are unchanged.
- **AC2** — a model-only test (no `[RequiresDockerFact]` needed) asserting the chosen "no exercise"
  representation round-trips distinctly from both a real `Guid` and `Guid.Empty` through
  `Session`/`SessionIssueRequest`/`AuthenticatedSession`.
- **AC3** — `OrganizationIsolationTests` / `QueryFilterIsolationTests`
  (`src/Pulse.WebApi.Tests/Data/`): a new "org-level staff session attempts an exercise-scoped read" case,
  alongside the existing unresolved-scope cases, proving zero rows rather than every exercise's rows.
- **AC4** — `StaffOrganizationBoundaryTests` (`src/Pulse.WebApi.Tests/Features/Identity/Staff/` or
  `exercise-isolation`'s equivalent): a case authenticating with no exercise present anywhere in the
  request and asserting `IOrganizationContext.CurrentOrganizationId` still resolves to the caller's own
  organization.
- **AC5** — `OrgAdminSurfaceFamilyTests` (`src/Pulse.WebApi.Tests/Features/ExerciseLifecycleAdmin/`): the
  three existing "orgAdmin reaches both Phase-1 reads" cases, re-run under an org-level (no-exercise)
  session rather than an exercise-bound one, asserting identical success.
- **XC-004** — a new case in `StaffLoginServiceTests` proving an org-level login attempt (success and
  failure) still emits exactly one telemetry event, under whatever schema change AC2/the telemetry
  cross-cutting AC lands on.
