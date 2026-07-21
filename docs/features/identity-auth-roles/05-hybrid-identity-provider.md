# Story: Hybrid identity model behind a provider interface + StaffUser / StaffAssignment [TIER-2]

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** COR-014, COR-005  ·  **Design decisions:** none  ·  **Issue:** #62
**Stack:** backend  ·  **Review:** Tier-2 (human sign-off — the `StaffAssignment` schema + the cross-exercise isolation-filter exemption is a schema/isolation change, the always-Critical review class)

## Context
The decided hybrid model: **staff** (controller/evaluator/planner) authenticate against the Dynamis
identity provider directly in Phase 1; active participants use Pulse-native named accounts; read-only
access via COR-015. The identity provider stays **behind an interface** — Entra ID / AD / SSO is an
anticipated future direction, not a launch requirement; Cadence session federation arrives with E9
(Phase 4) (COR-014).

**Phase B2 backend build.** This story builds the staff arm of identity: the `IIdentityProvider`
abstraction + a Dynamis-IdP implementation, the `StaffUser` and `StaffAssignment` entities, the staff
login endpoint (which issues a story-03 session), and the staff **active-exercise selection** that
populates the shared scope seam (`ExerciseContext.CurrentExerciseId`) — the staff arm of the
scope-resolution seam that story 08 (host, participant) and story 03 (session) also write. It also
serves the assignment list the cross-exercise switcher (`exercise-isolation/05`) consumes.
**COR-005 folds in here:** `StaffAssignment` is the cross-exercise access model the switcher reads.

## Acceptance Criteria
- [x] Staff authenticate against the Dynamis IdP in Phase 1; participants use Pulse-native accounts
      (story 02) or read-only sessions (story 06).
- [x] The identity provider is accessed through an **interface/abstraction** so a future Entra/AD/SSO
      provider can be added without touching call sites.
- [x] No Cadence-federation dependency is required for Phase 1 (that arrives with E9, Phase 4).

### Backend — provider interface, staff identity model, staff login & active-exercise (COR-014, COR-005)
- [x] An `IIdentityProvider` abstraction exists with a Dynamis-IdP implementation registered via its own
      `AddStaffIdentity()` DI extension (orchestrator wires one line in `Program.cs`); swapping the
      provider (future Entra/SSO/Cadence-federation) needs no call-site change.
- [x] A `StaffUser` entity (the staff human identity) and a `StaffAssignment` entity (a staff user's
      role on one exercise) are added to `PulseDbContext` via the B0 create-then-extend pattern (new
      `DbSet`s + `OnModelCreating` config + a migration) — **not** a second `DbContext`.
- [x] **`StaffAssignment` is cross-exercise by design (COR-005) and is therefore NOT `IExerciseScoped`:**
      it does not implement the marker, so the B0 global query filter never confines it to one exercise
      and the write-guard never demands an `ExerciseId` on it (rationale + safety documented in
      implementation.md). `StaffUser` is likewise unscoped (a staff human spans exercises).
- [x] `POST /api/auth/staff/login` authenticates a staff user through `IIdentityProvider` and, on
      success, issues a story-03 session (role = the staff role for the selected active exercise).
- [x] `GET /api/staff/assignments` returns the authenticated staff user's assignments (exercise id +
      name + role), staff-only — the data source for the `exercise-isolation/05` switcher.
- [x] `POST /api/staff/active-exercise { exerciseId }` sets the staff session's active exercise
      (validated against the caller's `StaffAssignment` set — an exercise the staff user is not assigned
      to is rejected) and thereby drives `ExerciseContext.CurrentExerciseId` for that staff user's
      subsequent scoped queries — **the staff arm of the scope seam** (precedence per story 08).

### Cross-cutting
- [x] **Isolation (XC-001/COR-001):** switching active exercise re-scopes all staff queries to the newly
      selected exercise; `StaffAssignment` is the **only** cross-exercise object in the model and its
      read is staff-only (XC-002) and returns access records (ids/names/roles), never participant
      content. A staff user reading assignments only ever sees their own. Extends the standing suite
      (`exercise-isolation/07`) with a switch-re-scopes case (select A → A rows only; select B → B rows
      only).
- [x] **Telemetry (XC-004):** staff login (success **and** failure) and a staff exercise-switch each
      emit an XC-004 event against the locked v0 envelope (wall + scenario time, actor, channel) —
      `actor.kind: 'system'`, `actor.role` = staff role, `actor.actingHumanId` = the `StaffUser` id,
      `channel: 'system'`; event types `login` / `logout` (known vocab) and `exercise.switched` (open
      vocab, additive). Failure carries `payload.outcome = 'failure'` and no session identity. Scenario
      time uses the exercise's stored scenario time until the COR-050 backend clock lands (B3) — see
      Out of Scope.
- [x] **Content security (NFR-004 / NFR-009):** staff login inputs are validated/sanitized and the staff
      login endpoint is per-IP rate-limited; the IdP abstraction never logs credentials.

## Out of Scope
Actual Entra/AD/SSO integration (future); Cadence federation (E9, Phase 4); the shared credential
(story 06); the session issuance/refresh mechanism itself (story 03 owns `/session` + the token
lifecycle — this story *calls* it); the switcher **UI** (`exercise-isolation/05` — this story provides
its data + the active-exercise setter); participant login (story 02); the participant-admin panel
(story 08, deferred); org-account operation (story 09, deferred); the backend native scenario clock
(COR-050, Phase B3) — auth telemetry uses the exercise's stored scenario time as a documented B2
placeholder until then.

## Technical Notes
Backend (staff world). Owns `src/Pulse.WebApi/Features/Identity/` (or `Auth/`): `IIdentityProvider` +
`DynamisIdentityProvider`, `StaffAuthEndpoints` (`/api/auth/staff/login`, `/api/staff/assignments`,
`/api/staff/active-exercise`), `AddStaffIdentity()`, and the `StaffUser` / `StaffAssignment` entities +
`PulseDbContext` `OnModelCreating` additions + migration. Follows the `Features/Social/*` endpoint-
extension pattern; route base `/api`. Writes the B0 `ExerciseContext.CurrentExerciseId` seam for staff.
See implementation.md (story 05).

## Dependencies
`backend-host/02-persistence-efcore` (`PulseDbContext`) + `AddExerciseScoping` (Phase B0, landed).
Story 03 (session issuance/`/session`) — staff login issues a session through it; story 08 (the scope
seam + precedence). Consumed by `exercise-isolation/05` (the switcher) and `app-shell/01` (staff entry).
Future E9 federation slots behind the same `IIdentityProvider`.

## Tests
- Unit: the auth layer resolves staff via the `IIdentityProvider` interface; a swapped provider needs no
  call-site change (interface test/mock).
- Integration: `StaffAssignment` spans exercises and is exempt from the global query filter (a query for
  a staff user's assignments returns rows across exercises); a scoped **content** query for that same
  staff session still returns only the active exercise's rows.
- Integration: `POST /api/staff/active-exercise` rejects an exercise the caller is not assigned to;
  selecting an assigned exercise re-scopes subsequent content queries.
- Integration: staff login success/failure and exercise-switch emit the expected XC-004 events.

### Test linkage (backend, Wave 1 — `src/Pulse.WebApi.Tests/Features/Identity/Staff/`)
Provider + DI are plain `[Fact]`; DB-touching tests are `[RequiresDockerFact]` (skip locally, run in CI).

- **AC: provider interface + Dynamis impl + swap needs no call-site change**
  - `DynamisIdentityProviderTests.Authenticate_WithMatchingCredentials_ResolvesTheExternalIdentity`
  - `DynamisIdentityProviderTests.Authenticate_WithWrongSecret_ReturnsRejected_AndNoIdentity`
  - `DynamisIdentityProviderTests.Authenticate_WithUnknownUsername_ReturnsRejected`
  - `DynamisIdentityProviderTests.Authenticate_UsernameMatch_IsCaseInsensitive`
  - `DynamisIdentityProviderTests.Authenticate_SecretComparisonIsCaseSensitive`
  - `DynamisIdentityProviderTests.Authenticate_WithEmptyAllowlist_ReturnsRejected_FailClosed`
  - `DynamisIdentityProviderTests.Authenticate_EntryWithEmptyConfiguredSecret_CannotAuthenticate`
  - `DynamisIdentityProviderTests.Authenticate_EntryWithEmptyExternalSubject_CannotAuthenticate`
  - `StaffLoginServiceTests.Login_WorksThroughAnyIIdentityProvider_ProvingTheSwapSeam` (swap seam)
- **AC: `AddStaffIdentity()` DI extension**
  - `StaffIdentityRegistrationTests.AddStaffIdentity_RegistersProviderBehindTheInterface`
  - `StaffIdentityRegistrationTests.AddStaffIdentity_BindsTheAllowlistOptions`
  - `StaffIdentityRegistrationTests.AddStaffIdentity_RegistersAFailClosedCurrentStaffSessionAccessorByDefault`
  - `StaffIdentityRegistrationTests.AddStaffIdentity_RegistersTheLoginAndAssignmentServices`
- **AC: `POST /api/auth/staff/login` authenticates + issues a story-03 session (fail closed on failure)**
  - `StaffLoginServiceTests.Login_Success_ProvisionsStaffUser_IssuesStaffSession_EmitsSuccessTelemetry`
  - `StaffLoginServiceTests.Login_WrongSecret_Rejected_NoSession_EmitsFailureTelemetryWithNoIdentity`
  - `StaffLoginServiceTests.Login_UnknownExercise_Invalid_NoSession_NoTelemetry`
  - `StaffLoginServiceTests.Login_AuthenticatedButNotAssigned_Forbidden_ProvisionsUser_NoSession_EmitsFailure`
  - `StaffAuthEndpointsHttpTests.StaffLogin_NullBody_Returns400` / `_MissingUsername_Returns400` / `_InvalidExerciseId_Returns400`
- **AC: `GET /api/staff/assignments` — own-only, cross-exercise, staff-only**
  - `StaffAssignmentServiceTests.GetAssignments_ReturnsOwnAssignmentsAcrossExercises_WithNamesAndRoles`
  - `StaffAssignmentServiceTests.GetAssignments_NoCurrentStaffSession_ReturnsNull_FailClosed`
  - `StaffAuthEndpointsHttpTests.StaffAssignments_NoAuthenticatedStaffSession_Returns401`
- **AC: `POST /api/staff/active-exercise` — validate assignment set + persist selection (staff arm of scope seam)**
  - `StaffAssignmentServiceTests.SetActiveExercise_AssignedExercise_UpdatesSessionExerciseAndRole_EmitsSwitchedEvent`
  - `StaffAssignmentServiceTests.SetActiveExercise_UnassignedExercise_Forbidden_NoChange_NoTelemetry`
  - `StaffAssignmentServiceTests.SetActiveExercise_AssignmentPointingAtMissingExercise_Invalid` (R6 service-layer FK check)
  - `StaffAssignmentServiceTests.SetActiveExercise_NoCurrentStaffSession_Unauthenticated_FailClosed`
  - `StaffAuthEndpointsHttpTests.StaffActiveExercise_NonGuidBody_Returns400` / `_ValidGuidButNoStaffSession_Returns401`
- **Cross-cutting XC-004 telemetry (login success + failure + exercise-switch, v0 envelope)**
  - `StaffLoginServiceTests.Login_Success_…_EmitsSuccessTelemetry` (actor.kind=system, role, actingHumanId, scenarioTime from stored)
  - `StaffLoginServiceTests.Login_WrongSecret_…_EmitsFailureTelemetryWithNoIdentity` (payload.outcome=failure, no identity)
  - `StaffLoginServiceTests.Login_ScenarioTime_FallsBackToWallClock_WhenExerciseHasNoStoredScenarioTime`
  - `StaffAssignmentServiceTests.SetActiveExercise_AssignedExercise_…_EmitsSwitchedEvent` (`exercise.switched`)

> **Cross-wave test-double note.** The story-03 seams (`ISessionIssuer`, `ICurrentStaffSessionAccessor`) are
> exercised via `RecordingSessionIssuer` / `StubCurrentStaffSessionAccessor` doubles (in
> `StaffIdentityTestDoubles.cs`) so the login/assignment paths are testable now. HTTP happy-path +
> serialization coverage over `WebApplicationFactory<Program>` follows once the orchestrator wires
> `Program.cs` (Wave 2 / testing-agent) — see the report.

## Delivered (Phase B2)
Built and tested on `feature/identity-backend` (the B2 Wave 1/2 merges); both code-review gates
(Gate-1, Gate-2) clean; umbrella green — 0 build warnings, `[RequiresDockerFact]` DB-backed tests run
in CI (Testcontainers.MsSql against the runner's Docker daemon). `Program.cs` now wires
`AddStaffIdentity()` and the staff auth endpoints live (Wave 2 integration), so the Wave-1
test-double seam above is superseded by the real `ISessionIssuer`/`ICurrentStaffSessionAccessor`
registrations.

Deferred follow-ups (tracked, not blockers to this story's Complete status):
- **Per-IP rate limiter needs forwarded-headers.** `POST /api/auth/staff/login` is per-IP
  rate-limited today against the direct connection IP; behind Azure App Service the real client IP
  arrives via a forwarded header, so true per-IP partitioning needs forwarded-headers wiring that
  trusts only the platform proxy. Tracked as a `/security-review` item before the umbrella→main PR.
- **`DynamisIdentityProvider` is a Phase-1 dev config-allowlist stub** behind `IIdentityProvider` (a
  constant-time, fail-closed credential check against configured entries) — not a real Entra/AD/SSO
  integration. That is by design for Phase 1 (see Context/Out of Scope), but is flagged here for
  Tier-2 human sign-off alongside the schema/isolation review this story already carries.
