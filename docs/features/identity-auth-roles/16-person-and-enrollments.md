# Story: Person, StaffUser facet and Enrollments (replaces StaffAssignment)

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** In Progress
**Requirements:** COR-010, COR-011, COR-012, COR-014, COR-077  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §1.1, §1.2, §8.1  ·  **Issue:** #572
**Stack:** backend (+ frozen-type changes on the frontend)  ·  **Review tier:** Tier-2 (schema, isolation)  ·  **Wave:** A1

## Context
Today a staff member is an org-owned `StaffUser` with no password and a free-string role in
`StaffAssignment`; participants are exercise-scoped `Account`s. The signed-off model ([`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §1.1) makes
`Person` the human, adds a real `Enrollment` table as the one record of "this person holds this role in this
exercise" for every role, and re-homes `Account` as the participant sign-in facet. This is the A1 foundation
every other Phase-A story reads. Staff-world plumbing; no participant-visible change.

## Acceptance Criteria
- [ ] **Person.** Given the migration, then `People` exists (`IOrganizationOwned`): `Id`, `OrganizationId`,
      normalized `Email` (unique on `(OrganizationId, Email)`), `DisplayName`, `PasswordHash?`,
      `PasswordChangedAt?`, `FailedLoginCount`, `LockedOutUntil?` (password and lockout columns ship in A1),
      `OrgRole?`, `DisabledAt?`, `CreatedAt`. (`AvatarBlobName` is added by A2 story 23.) Sign-in lookups carry `org-scope-exempt(ResolutionRoot)` markers and the sweep-test count is bumped.
- [ ] **StaffUser facet.** Given every existing `StaffUser`, then one `Person` with the **same Id** is backfilled
      (legacy rows have null Email until invited), `StaffUser.Id` FKs `People.Id`, and every existing FK
      (`Session.StaffUserId`, `ParticipantLink.IssuedByStaffUserId`, `ExerciseDayWord.SetByStaffUserId`,
      telemetry actor ids) stays valid.
- [ ] **Enrollment replaces StaffAssignment.** Given the migration, then `Enrollments` (`IExerciseScoped`:
      `ExerciseId`, `PersonId?`, `Role` in planner|controller|evaluator|participant|pio, `PersonaId?`) holds every
      `StaffAssignment` row with the same Id plus one row per `Account` (Role and PersonaId copied); then
      `StaffAssignments`, `Accounts.Role` and `Accounts.PersonaId` are dropped; `Accounts.EnrollmentId` is
      unique and non-null.
- [ ] **One role per exercise.** Given a unique index on `(ExerciseId, PersonId)` where `PersonId` is not null, when a
      second enrollment (any role) is added for the same person and exercise, then the service returns
      409 `conflicting-enrollment`. A check constraint refuses a `PersonaId` on staff roles; staff-role enrollments
      require a `PersonId` and no `Account`; participant-role enrollments require an `Account`.
- [ ] **orgAdmin migration.** Every existing `orgAdmin` assignment sets `Person.OrgRole = "orgAdmin"` and its
      enrollment becomes `planner`. `orgAdmin` is removed from the exercise role vocabulary.
- [ ] **Slug and FirstLiveAt.** `Organizations.Slug` is unique and backfilled from Name; `Exercises.FirstLiveAt`
      is backfilled from lifecycle telemetry where status is past `staged`; `Sessions.PersonId` and `Sessions.Origin` are added and
      `Sessions.ExerciseId` becomes nullable.
- [ ] **Readers move.** Session minting, roster, persona binding, attribution, the org staff-assignments read and
      the exercise switcher read `Enrollment`. Cross-exercise org reads use explicit `IgnoreQueryFilters()` + an
      `InOrganization` join under a named `TenantChecked` sweep exemption. Finished stories' suites stay green.
- [ ] **OrgAuditEvent (design doc §7.5).** `OrgAuditEvent` (`IOrganizationScoped`, central org filter): `Id`, `OrganizationId`, `Kind`, `Outcome`, `ActorPersonId?`, `SubjectPersonId?`, `ExerciseId?`, `Payload` (JSON), `OccurredAt`. Records org-scope sign-in success/refusal, org choice, enrollment grant/revoke (incl. self-grant), people create/disable, org-admin grant, reset issuance, and exercise create/delete/duplicate/archive from org scope. Exercise-scoped actions stay in `TelemetryEvent`.
- [ ] **Cross-tab world rule (design doc §1.2).** A sign-in posts `{world, at}` on `BroadcastChannel('pulse-world')` (storage-event fallback); every tab of the other world on that origin signs out (`POST /api/auth/logout`) and lands on its sign-in page. Exception (Gate-1 W-1): a staff sign-in removes the shared `localStorage` participant pair before it announces, so participant tabs find no session and do not POST; the signing-in staff tab itself POSTs `/auth/logout` with the outgoing participant access token (fire and forget, errors swallowed). A staff tab whose tokens were cleared ignores the signal (W-2). Server backstop: new `Session.Origin` (from the request `Origin` header); minting a session for person P in world W revokes P's live other-world sessions minted from the same origin. Separate origins (console host vs exercise hosts) may each hold one world.
- [ ] **Org-scope session routes.** `GET /api/staff/assignments` and `POST /api/staff/active-exercise` accept an org-scope session for the caller's own same-org enrollment only; foreign or missing target is the bare 404.
- [ ] **Chained provider in A1.** If the `Person` has a `PasswordHash`, the Pulse provider is authoritative (no fallback); otherwise the Dynamis allowlist is tried via `StaffUser.ExternalSubject`, so backfilled legacy staff sign in as today (see story 05 note). Invites and `CredentialToken` arrive in A2.
- [ ] **Migration is reversible:** hand-written SQL in `EXEC` (OPERATE.md), a working `Down`, and a round-trip
      test on a seeded database.
- [ ] Isolation (XC-001/002, COR-001/002/007; brief C5): every new route has a foreign-exercise test **and** a foreign-org test; a cross-tenant id returns the same bare 404 as a missing id (the bare-404 pattern, design doc §7.2); id-taking org routes join the `CompositionRootWiringTests` allow-list.
- [ ] Telemetry (XC-004): the action emits an event (wall + scenario time, acting `PersonId` and role, channel `system`) per the v0 schema, in the same unit of work as the mutation.
- [ ] User guide (C5 docs-as-done): `docs/guide/planner-guide.md` is updated in the same PR (and the screenshot list in `tools/guide-screenshots` if a screen changed), or the PR states "no guide impact".

### Copilot review 2 fold (2026-10-16)
- [ ] The A1 migration also creates `LoginChoices` and `LoginChoiceCandidates` (ADMIN-IDENTITY-MODEL §1.2, §9).

### Lead controller (Tom, 2026-10-16; ADMIN-IDENTITY-MODEL §1.1)
- [ ] `Enrollment.IsLead` (bit, default 0) is in the A1 migration, with a check constraint (`IsLead = 1` only when `Role = 'controller'`) and a filtered unique index on `(ExerciseId) WHERE IsLead = 1`, so an exercise has at most one lead.
- [ ] `PUT /api/staff/enrollments/{id}/lead` (planner; org admins act through their own enrollment; bare 404 cross-exercise or cross-org) sets the lead and clears the previous one in a single `CASE` UPDATE, maps a unique violation to 409 `lead-conflict`, revokes **no** sessions, and is audited. A non-controller target gets 409 `not-a-controller`.
- [ ] Session/`SessionDto` exposes `isLead` so Session C can gate the swamped-mode UI.

### Orchestrator review fold (2026-10-16, ADMIN-IDENTITY-MODEL §1.1)
- [ ] `isLead` is computed when the DTO is built, from the live `Enrollment.IsLead`, and is never stored on `Session`. It is false for org-scope and participant sessions, and the frontend `Enrollment` type carries it too.
- [ ] Migration backfill: exactly one lead per exercise that has any controller, namely the earliest-created controller enrollment (ties go to the lowest Id). A migration test covers it.
- [ ] Removing the lead's enrollment, or changing its role away from controller, never returns a 500 on the check constraint. **It is allowed (Option A, Tom, 2026-10-16).** The transaction clears `IsLead`, and swamped mode is turned off **after commit** (idempotent; see the M-002 fold below), and both are audited. The exercise then has no lead until a planner sets one. A test covers both the removal and the role-change paths.

### Copilot review 5 fold (2026-10-16)
- [ ] Grant revocation also aborts every SignalR connection bound to a revoked session id and removes it from its groups (a connection-to-session registry). A test covers a client connected before revocation, which stops receiving staff broadcasts.
- [ ] `FirstLiveAt` backfill: for exercises in live, paused, completed or archived, it is COALESCE(first transition to live, the `exercise.bootstrapped` event, earliest post, `CreatedAt`), so it is never null. A migration test covers a bootstrapped live exercise with no lifecycle events.

### Copilot review 6 fold (2026-10-16)
- [ ] Final `FirstLiveAt` fallback: when the exercise's status is past staged and no lifecycle, bootstrap or post timestamp exists and `CreatedAt` is null, the backfill uses the migration's run time (`SYSDATETIMEOFFSET()`, the same instant as `SYSUTCDATETIME()` once stored in the `datetimeoffset` column), so a run is never mistaken for "never ran". A migration fixture covers an exercise with all four sources absent.

### Copilot review 7 fold (2026-10-16)
- [ ] **`FirstLiveAt` is stamped from A1.** Every transition into `live` (StartEx, plus any bootstrap path) sets `FirstLiveAt` if null, in the same transaction. Test: an exercise in build at A1 deploy runs afterwards, then is reset; delete is refused and archive-from-build is allowed.
- [ ] **Existing exercise-scoped `orgAdmin` sessions are revoked** by the migration, because the new contract rejects `orgAdmin` with exercise scope. Test: an access and refresh pair from before the migration gets 401 afterwards, and a fresh sign-in mints an org-scope session.
- [ ] `assignments` and `active-exercise` refuse participant and readonly sessions.

### Orchestrator review fold (2026-10-16, M-002)
- [ ] Swamped mode lives in memory (`EngineAutonomyState`). When the lead is removed or demoted, it is turned off **after** the enrollment change commits, **idempotently**, so a failed flip retries. On rehydrate, an exercise with no lead comes back with swamped mode off (test).
  - *Gate-1 fold (M-1):* `EnrollmentService` now calls `ISwampedModeSwitch.TurnOff` only after `SaveChangesAsync` commits (beside the hub-connection revoke). The `enrollment.lead.released` event + audit stay in the enrollment change's unit of work; the `engine.swamped-mode.turned-off` event + audit are written after the flip (follow-up save, real `wasOn`). A throwing flip or a failed follow-up save is logged and never fails the grant change. The rehydrate clause holds **by construction**: swamped mode is never persisted (`ExerciseRuntimeStateRehydrator` does not touch autonomy), so after a restart every exercise's `EngineAutonomyState` is created fresh with swamped mode off.

## Out of Scope
Password sign-in itself and org choice (story 15 / 05); role enforcement (17); invite and directory UI (19-20);
the A2/A3/A4 columns (their own migrations). No participant-facing change.

## Technical Notes
Staff world. Paths: `Pulse.WebApi/Data/Entities/` (Person, Enrollment), `Features/Identity/`,
`ExerciseCreationService.cs` (creator is enrolled, no longer a `StaffAssignment`). Frontend:
`features/staff/types.ts` `StaffAssignment` becomes `Enrollment` (+ `personId`); `core/auth/roles.ts` drops
`orgAdmin` from `ExerciseRole`. **Orchestrator clearance required first (A1):** the EF migration `AdminIdentityFoundation`, `Program.cs` edits, `App.tsx` / `staffRouteRegistry.tsx` edits and every frozen-type change (`Session`/`SessionDto` incl. the new `world`/`scope`/`role` union below and the `isSessionRole` validator replacing `isExerciseRole` in `core/auth/sessionResolver.ts`, `ExerciseRole`, `StaffAssignment` -> `Enrollment`, the staff login request) go through the orchestrator; post the frozen-type changes on the feature issue before A1 merges (brief C1.4). Builders export one `Add*()`/`Map*()` line each; they do not edit `Program.cs`. Design doc §9 lists the migration contents.

## Dependencies
Wave A1, first. Blocks 15, 17 and every later A story. Sessions B and C: no engine schema change before this migration is on main.

## Tests
Migration up/down test; unique-index and check-constraint tests; sweep test (`TenantChecked`/ResolutionRoot counts);
isolation suite extended with foreign-org Person/Enrollment cases; regression: identity 02/03/05/10/12 and easy-login 02/03/05 suites.

**Backend test linkage (backend-agent, A1 build):**
- `AdminIdentityFoundationMigrationTests` — Person backfill + StaffUser FK (AC Person / StaffUser facet), StaffAssignments → Enrollments same ids + orgAdmin → planner + OrgRole (AC Enrollment, orgAdmin migration), accounts → enrollments with no orphan sentinel / no default constraint (AC Enrollment), `Up_BackfillsUniqueSlugsFromNames`, `Up_BackfillsFirstLiveAt_*` (incl. bootstrapped-live and all-four-sources-absent), `Up_MakesExactlyOneControllerTheLead_*` (lead backfill; Gate-1 L-1: an older account-backed controller is never the lead), `Up_RevokesALiveOrgAdminSession_*` (Copilot 7: access + refresh 401), `DownThenUp_*` (AC reversible).
- `AdminIdentitySchemaTests` — unique (ExerciseId, PersonId), role / persona / lead check constraints, one lead per exercise, Accounts.EnrollmentId unique (AC one role per exercise, lead controller); Enrollment exercise filter + OrgAuditEvent org filter fail closed (AC isolation, OrgAuditEvent).
- `EnrollmentServiceTests` — `SetLead_*` (one statement, no revocation, audit, 409 not-a-controller, bare 404 foreign exercise / foreign org, planner-only), `Grant_*` (409 conflicting-enrollment, self-grant audit kind), `ChangeRole_RevokesThatPersonsSessions_*` (grant-revoke rule + hub cut), `Revoke_OfTheLead_*` / `ChangeRole_OfTheLeadAwayFromController_*` (Option A); Gate-1 M-1: `Revoke_OfTheLead_WhenTheSaveFails_DoesNotTurnSwampedModeOff`, `ChangeRole_OfTheLead_WhenTheSwampedFlipThrows_StillSucceeds_AndRecordsNoFlip`, `Rehydrate_AnExerciseWithNoLead_ComesBackWithSwampedModeOff` (M-002 after-commit, idempotent flip; rehydrate off by construction).
- `EnrollmentHttpTests` — org-scope `SessionDto` (scope/world/role/personId), exercise-scoped route fails closed under org scope, `GET /api/staff/assignments` + `POST /api/staff/active-exercise` own-only and bare 404 (AC org-scope session routes), non-staff sessions refused, `PUT .../lead` 200 + live `isLead` + foreign-exercise / foreign-org bare 404.
- `PulsePasswordIdentityProviderTests` (AC chained provider), `CrossWorldSessionBackstopTests` (AC cross-tab world rule — server backstop; Gate-1 L-3: `TheBackstop_CutsTheRevokedSessionsLiveHubConnections_AfterTheCommit_Only`), `ExerciseRealtimeHubRoleIsolationTests.RevokingTheGrant_CutsAStaffConnectionOpenedBeforeIt_*` (Copilot 5), `ExerciseLifecycleServiceTests.StartEx_StampsFirstLiveAtOnce_*` + `BootstrapServiceTests` FirstLiveAt assertion (Copilot 7), `OrganizationScopeSweepTests` (ResolutionRoot +1, Person swept, pinned Enrollment filter-bypass inventory).
- Guide: no guide impact (no screen changed in this backend build).

### Copilot review 3 fold (2026-10-16)
- [ ] **Session contract: org-scope role representation (frozen type).** `SessionDto` / frontend `Session` / `SessionResponseBody` gain `world: 'staff' | 'participant'` and `scope: 'exercise' | 'org'`. `role` becomes `ExerciseRole | 'orgAdmin'`, where `'orgAdmin'` is valid **only** with `scope: 'org'` and an `ExerciseRole` is valid **only** with `scope: 'exercise'`. The frontend type is a discriminated union on `scope` (`ExerciseSession | OrgSession`; `OrgSession.exerciseId` is null). `ExerciseRole` itself stays orgAdmin-free. A runtime validator `isSessionRole(scope, role)` replaces `isExerciseRole` in `isValidBody` (`sessionResolver.ts` ~114) and fails closed on any other combination. Tests: both variants resolve; rejected: `orgAdmin` with `scope 'exercise'`, an `ExerciseRole` with `scope 'org'`, unknown scope, unknown role, a present `world` contradicting the role. Frontend-before-backend (docs/OPERATE.md): the parser also accepts the pre-A1 body, where an ABSENT `scope` means `exercise`, `world` is derived from the role, `isLead` is `false` and `personId` is `null`; present fields are still validated fail-closed. All three type changes are listed in the frozen-type clearance note above.
