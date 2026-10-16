# Story: Person, StaffUser facet and Enrollments (replaces StaffAssignment)

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
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
- [ ] **Cross-tab world rule (design doc §1.2).** A sign-in posts `{world, at}` on `BroadcastChannel('pulse-world')` (storage-event fallback); every tab of the other world on that origin signs out (`POST /api/auth/logout`) and lands on its sign-in page. Server backstop: new `Session.Origin` (from the request `Origin` header); minting a session for person P in world W revokes P's live other-world sessions minted from the same origin. Separate origins (console host vs exercise hosts) may each hold one world.
- [ ] **Org-scope session routes.** `GET /api/staff/assignments` and `POST /api/staff/active-exercise` accept an org-scope session for the caller's own same-org enrollment only; foreign or missing target is the bare 404.
- [ ] **Chained provider in A1.** If the `Person` has a `PasswordHash`, the Pulse provider is authoritative (no fallback); otherwise the Dynamis allowlist is tried via `StaffUser.ExternalSubject`, so backfilled legacy staff sign in as today (see story 05 note). Invites and `CredentialToken` arrive in A2.
- [ ] **Migration is reversible:** hand-written SQL in `EXEC` (OPERATE.md), a working `Down`, and a round-trip
      test on a seeded database.
- [ ] Isolation (XC-001/002, COR-001/002/007; brief C5): every new route has a foreign-exercise test **and** a foreign-org test; a cross-tenant id returns the same bare 404 as a missing id (the bare-404 pattern, design doc §7.2); id-taking org routes join the `CompositionRootWiringTests` allow-list.
- [ ] Telemetry (XC-004): the action emits an event (wall + scenario time, acting `PersonId` and role, channel `system`) per the v0 schema, in the same unit of work as the mutation.
- [ ] User guide (C5 docs-as-done): `docs/guide/planner-guide.md` is updated in the same PR (and the screenshot list in `tools/guide-screenshots` if a screen changed), or the PR states "no guide impact".

### Copilot review 2 fold (2026-10-16)
- [ ] The A1 migration also creates `LoginChoices` and `LoginChoiceCandidates` (ADMIN-IDENTITY-MODEL §1.2, §9).

## Out of Scope
Password sign-in itself and org choice (story 15 / 05); role enforcement (17); invite and directory UI (19-20);
the A2/A3/A4 columns (their own migrations). No participant-facing change.

## Technical Notes
Staff world. Paths: `Pulse.WebApi/Data/Entities/` (Person, Enrollment), `Features/Identity/`,
`ExerciseCreationService.cs` (creator is enrolled, no longer a `StaffAssignment`). Frontend:
`features/staff/types.ts` `StaffAssignment` becomes `Enrollment` (+ `personId`); `core/auth/roles.ts` drops
`orgAdmin` from `ExerciseRole`. **Orchestrator clearance required first (A1):** the EF migration `AdminIdentityFoundation`, `Program.cs` edits, `App.tsx` / `staffRouteRegistry.tsx` edits and every frozen-type change (`Session`/`SessionDto`, `ExerciseRole`, `StaffAssignment` -> `Enrollment`, the staff login request) go through the orchestrator; post the frozen-type changes on the feature issue before A1 merges (brief C1.4). Builders export one `Add*()`/`Map*()` line each; they do not edit `Program.cs`. Design doc §9 lists the migration contents.

## Dependencies
Wave A1, first. Blocks 15, 17 and every later A story. Sessions B and C: no engine schema change before this migration is on main.

## Tests
Migration up/down test; unique-index and check-constraint tests; sweep test (`TenantChecked`/ResolutionRoot counts);
isolation suite extended with foreign-org Person/Enrollment cases; regression: identity 02/03/05/10/12 and easy-login 02/03/05 suites.
