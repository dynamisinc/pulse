# Story: Org directory (people list and org-admin grants)

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-010, COR-077, COR-017  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §1.1, §2.1, §7.1, §8.2  ·  **Issue:** #574
**Stack:** fullstack  ·  **Review tier:** Tier-2 (isolation)  ·  **Wave:** A2

## Context
An org admin needs to see and manage the people in their organization without asking Dynamis. This story delivers the `/api/org/people` family and the org console directory page ([`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §1.1, §7.1). Staff world, org scope.

## Acceptance Criteria
- [ ] **List.** Given an org-scope session, when `GET /api/org/people` is called, then it returns only `Person` rows of the caller's organization (name, email, org role, enrollments summary, disabled flag), paged and searchable by name/email.
- [ ] **Grant / revoke org admin.** Given an org admin, when they set or clear `OrgRole = orgAdmin` on a person, then it persists, is audited, and the **last org admin cannot be removed** (409 `last-org-admin`). The safeguard counts **enabled** org admins (`OrgRole = orgAdmin` and `DisabledAt` null) and applies to revoking the role and to disabling a person.
- [ ] **Disable / enable.** Given an org admin disables a person, then `DisabledAt` is set, all that person's sessions are revoked, and sign-in returns the uniform 401; enabling reverses it. Disabling the last enabled org admin is refused with 409 `last-org-admin` (a disabled admin does not count toward the minimum).
- [ ] **Role gating.** Planner, controller, evaluator, participant and readonly sessions are refused (403) on every `/api/org/people*` **directory and administration** route (route x role matrix, story 17). **Exception:** `GET /api/org/people/{id}/avatar` stays readable by any **staff-world** session in the same org (story 23, design §4.2). It is still refused to participant and readonly sessions, with a bare 404 across orgs.
- [ ] **Directory shows people only.** One-off participants (`Enrollment.PersonId` null) never appear in the directory.
- [ ] Isolation (XC-001/002, COR-001/002/007; brief C5): every new route has a foreign-exercise test **and** a foreign-org test; a cross-tenant id returns the same bare 404 as a missing id (the bare-404 pattern, design doc §7.2); id-taking org routes join the `CompositionRootWiringTests` allow-list.
- [ ] **Bare 404 on `personId` routes:** `GET/PATCH /api/org/people/{id}` with a foreign-org id returns the same 404 as a missing id; routes are added to the org-tier allow-list extended to `personId`.
- [ ] Telemetry (XC-004): the action emits an event (wall + scenario time, acting `PersonId` and role, channel `system`) per the v0 schema, in the same unit of work as the mutation.
- [ ] Two worlds (D0 §2): the surface uses COBRA (`@/theme/styledComponents`), is desktop-first, FontAwesome only, MUI 9 `sx`-only, and is never confusable with a participant view.
- [ ] Accessibility (NFR-001): WCAG 2.1 AA; keyboard-operable; status/error states are never color-only; async results announced via a live region.
- [ ] User guide (C5 docs-as-done): `docs/guide/planner-guide.md` is updated in the same PR (and `tools/guide-screenshots` if a screen changed), or the PR states "no guide impact". (new "People" section).

### Copilot review 4 fold (2026-10-16, ADMIN-IDENTITY-MODEL §1.1)
- [ ] Revoking `OrgRole` revokes, in the same transaction, every live org-scope session (access and refresh) of that person. Disabling a person revokes all of their sessions. Tests prove that the old access token and the old refresh token both get 401 afterwards.

### Copilot review 5 fold (2026-10-16)
- [ ] Disable and OrgRole revocation also abort the person's live SignalR connections (shared registry from story 16). A test uses a connection opened before the change.

## Out of Scope
Inviting staff (20); resets (21); avatars (23); deleting a person; MFA; SSO.

## Technical Notes
Staff world. Paths: `Features/Org/People/*` (backend), `features/orgAdmin/` directory page (COBRA table, dense). Reuse `InOrganization`, shared axios client, React Query hooks, `StaffCallerContext`. Route lines are wired by the orchestrator. **Orchestrator clearance first:** the wave EF migration, `Program.cs` route-group lines, and `App.tsx` / `staffRouteRegistry.tsx` additive lines go through the orchestrator's end-of-wave wiring commit; builders export one `Add*()`/`Map*()` line and do not edit them.
- *Amended 2026-10-19 (#668 Gate-1 S1):* for this PR the orchestrator approved the 3 additive `Program.cs` lines (the `using Pulse.WebApi.Features.Org.PeopleDirectory;` directive, `builder.Services.AddOrgPeople();`, `app.MapOrgPeopleEndpoints();`); they ship in #668 rather than in an end-of-wave wiring commit.

## Dependencies
Wave A2, after A1 (16, 17). Can run with 22, 24.

## Tests
Endpoint tests (incl. foreign-org, last-admin: revoke-role and disable of the last enabled admin both 409 `last-org-admin`; with two admins, one already disabled, revoking/disabling the other is refused; disabled sign-in); RTL for the directory page; role-matrix entries.

**Backend test linkage (#574).** All in `src/Pulse.WebApi.Tests` (`OrgPeopleEndpointTests` is `[RequiresDockerFact]`, real SQL):
- `OrgPeopleEndpointTests.List_ReturnsOnlyTheCallersOrgPeople_WithTheEnrollmentsSummary_AndNeverAOneOffParticipant` (AC List, Directory shows people only, Isolation)
- `OrgPeopleEndpointTests.List_IsPaged_AndSearchableByNameAndEmail_AndShowsAnActiveLockout` (AC List)
- `OrgPeopleEndpointTests.PersonIdRoutes_ForAnotherCustomersPerson_AreTheSameBare404AsAMissingId_AndChangeNothing` (AC Isolation, Bare 404 on `personId` routes)
- `OrgPeopleEndpointTests.EveryRoute_RefusesEveryNonOrgAdminSession_IncludingAnExerciseBoundSessionOfTheSameOrg` (AC Role gating, Isolation foreign-exercise)
- `RoleMatrixTests` row `PATCH /api/org/people/{personId:guid}` = org admin only (AC Role gating)
- `OrgPeopleEndpointTests.Grant_CreatesTheMissingStaffFacet_Audits_AndTheNewAdminSignsInOrgScope` (AC Grant, reality-check facet + no-enrollment rows, org-audit replacement of XC-004)
- `OrgPeopleEndpointTests.Grant_VoidsEveryOutstandingCredentialTokenOfThePerson_SoAPrePromotionLinkCannotBeRedeemed` (#665 adversarial review W5)
- `OrgPeopleEndpointTests.Revoke_RevokesOnlyTheOrgScopeSessions_TheirAccessAndRefreshTokens401_AndKeepsEnrollments` (AC Grant/revoke, Copilot 4)
- `OrgPeopleEndpointTests.LastOrgAdmin_RevokeAndDisableOfTheLastEnabledAdmin_Are409_AndADisabledAdminDoesNotCount` (AC Grant/revoke, Disable last-admin)
- `OrgPeopleEndpointTests.LastOrgAdmin_TwoAdminsDemotingOrDisablingEachOtherConcurrently_NeverLeaveZero` (reality-check race test)
- `OrgPeopleEndpointTests.Disable_RevokesEverySession_SignInIsTheUniform401_AndEnableReverses` (AC Disable/enable, Copilot 4)
- `OrgPeopleEndpointTests.Disable_OfAnOrgAdmin_AlsoRevokesTheirOrgScopeSession_AndSelfDisableIsRefused` (AC Disable; `409 cannot-disable-self`)
- `OrgPeopleEndpointTests.Patch_WithNeitherOrBothFields_Is400_AndANoOpWritesNothing`
- `ExerciseRealtimeHubRoleIsolationTests.DisablingThePerson_CutsAStaffConnectionOpenedBeforeIt_SoItReceivesNoFurtherStaffBroadcast` (Copilot 5)
- `CompositionRootWiringTests.TheOrgTierRoutes_TakeOnlyAllowListedExerciseIds` + `OrgPeopleCompositionRootWiringTests` (AC Isolation allow-list, wiring)
- **Hub cut is tested on disable only (Gate-1 S5).** The Copilot 5 AC names both disable and `OrgRole` revocation, but revoking `OrgRole` revokes only org-scope sessions (`ExerciseId` null), and an org-scope session cannot join an exercise hub (`ExerciseRealtimeHub.OnConnectedAsync` aborts it), so there is no live connection for a revoke to cut. The revoke path still calls the same post-commit cut; the hub test drives disable, which revokes exercise-bound sessions that can hold a connection.

**Frontend test linkage (#574).** All in `src/frontend/src/features/orgDirectory/` (Vitest + RTL):
- `pages/OrgDirectoryPage.test.tsx` — AC **Two worlds** (rendered under `cobraTheme` with the COBRA components, FontAwesome icons, sx-only; no participant skin), AC **Accessibility** (real `<table>` with caption and column headers; status badges are icon + text, never colour-only; result count in a polite `role="status"` region; a completed action announced in a second polite `role="status"` region, e.g. "Pat Plain was disabled." (Gate-1 W-003); load and action failures in `role="alert"` with an icon; Cancel has initial focus; Reset link disabled with a visible text reason on org-admin and disabled rows (Gate-1 S3)), AC **Role gating** (planner/controller/evaluator/no session see a notice and make no request; the page gates on `can('manageOrgPeople')`, Gate-1 W-004), AC **Grant / revoke**, **Disable / enable** and **last org admin** (409 mappings, refetch after settle, own-row "You will be signed out of the organization view." line on Remove admin, Gate-1 S4), and the reset-link copy flow.
- `services/orgPeopleService.test.ts` — AC **Isolation** client half (no organization id is ever sent; the person id is URL-encoded into the path; an empty search is omitted) and AC **Accessibility** error half (non-axios failures are wrapped without leaking server detail, so the dialog maps only status + code to plain words).
- `src/frontend/src/core/auth/rolePermissions.test.tsx` — `manageOrgPeople` is a ROLE_ONLY row: org admin only, every other role refused, no session refused (fail closed).

**Story 21 linkage.** The per-row "Reset link" action (`PersonActionDialog`, `useIssuePasswordReset`, `POST /api/org/people/{personId}/password-reset`) is **story 21's admin-reset UI half** (AC "Admin reset", staff half), shipped in this PR because the #576 backend already exists. Story 21 records the same linkage.

### Copilot review 3 fold (2026-10-16)
- Changed: last-admin safeguard now also covers disabling a person, counts enabled org admins only, and returns 409 `last-org-admin`; tests added.

## PR notes (#668)
- **Person-disable scope (Gate-1 W-001, follow-up).** Disabling a person blocks the **staff and org sign-in paths** (`StaffSignInLockout.IsBlocked`, `PulsePasswordIdentityProvider`, `OrgStaffLoginService`) and revokes every live session. The **participant sign-in paths check only `Account.DisabledAt`**, not `Person.DisabledAt`: `ParticipantLoginService` (password), `WordLoginService` (day word), `JoinLoginService` (personal link) and `SessionService.IsEnabledAccountOfExerciseAsync` (participant refresh). This is latent: nothing creates a person-linked participant enrollment today. **Follow-up:** gate those four paths on the linked `Person.DisabledAt` once person-linked participant enrollments exist.
- **Wiring (Gate-1 S1).** The 3 additive `Program.cs` lines (`using`, `AddOrgPeople()`, `MapOrgPeopleEndpoints()`) were approved by the orchestrator for this PR. No `App.tsx` edit and no migration.
- **Reset link is story 21's UI half (Gate-1 W-005).** See "Story 21 linkage" under Tests.
- **Post-commit hub cut (Gate-1 W-002).** The connection cut after a committed revoke/disable runs on `CancellationToken.None`, so a dropped request cannot leave a connection out of the registry but still in the staff group.
- **Hub cut tested on disable only (Gate-1 S5).** See the note under Backend test linkage.

## A1b/A1c reality check (2026-10-19)
Checked against what A1b (#608), A1c (#615) and Phase 2 (#642) shipped. The ACs above are history and stay; where this section contradicts one, **this section wins**. No ACs were ticked.

### 1. Already satisfied by shipped code (reuse, do not rebuild)
- `Person.OrgRole` / `Person.IsOrgAdmin` / `Person.OrgAdminRole`, `DisabledAt`, `LockedOutUntil`, `FailedLoginCount` exist (`Data/Entities/Person.cs`). **No migration is needed for the directory itself.**
- Sign-in already honours `DisabledAt` (uniform 401): `StaffSignInLockout.IsBlocked`, `PulsePasswordIdentityProvider.AuthenticatePulsePasswordAsync` (`Features/Identity/...`), and `OrgStaffLoginService.ChooseAsync` ("choice-stale"). The "disabled sign-in returns the uniform 401" half of the Disable AC needs only a test, not code.
- Org-admin-only gate: `OrgAdminAuthorizationFilter.OrgAdminOnly` (`Features/ExerciseLifecycleAdmin`), over `StaffCallerContext` (`IsOrgScope`, `OrganizationId`, `Role`). Planner/controller/evaluator get 403 from it today (it already guards `GET /api/org/staff-assignments`).
- Tenant bound: `InOrganization(...)` on `People`/`StaffUsers`; bare-404 pattern as in `EnrollmentService.FindReachableAsync`.
- Audit: `OrgAuditEvent` + `StaffChangeRecorder`. Live-connection cut: `ISessionConnectionRevoker` (`AddEnrollments` registers it with `TryAdd`).
- Read seam to extend: `OrgStaffDirectoryService.ListAsync` (`GET /api/org/staff-assignments`) already returns the org's staff enrollments across exercises; the "enrollments summary" column can reuse its join.
- Frontend home exists: `features/exerciseLifecycleAdmin` (the org-admin surface family, route `/staff/exercises`, `staffRouteRegistry.tsx`, `isDefaultFor: ['orgAdmin']`) and `core/auth/rolePermissions.ts` (`can()`/`usePermissions()`). Gate new controls through it.

### 2. Stale or contradicted (reworded)
| Original AC | Problem | Replace with |
|---|---|---|
| Technical Notes: "`features/orgAdmin/` directory page" | No such folder. The org-admin surface family lives in `features/exerciseLifecycleAdmin/` (A1c). | "Directory page lives in `features/exerciseLifecycleAdmin/` (or a sibling `features/orgPeople/` registered as a second `administer`-group surface in `staffRouteRegistry.tsx` with `allowedRoles: ['orgAdmin']`). Gate controls with `can()`." Add `manageOrgPeople` (orgAdmin only) to the `StaffAction` table in `rolePermissions.ts`. |
| Telemetry (XC-004) "emits an event ... in the same unit of work" | A `TelemetryEvent` requires a non-empty `ExerciseId` (write guard); an org-level people change has no exercise. `StaffChangeRecorder.Stage` is exercise-bound. | "Org-level changes (grant/revoke `OrgRole`, disable/enable) write an `OrgAuditEvent` (`ExerciseId` null, `ActorPersonId`, `SubjectPersonId`, kinds `org.person.org-role-granted`, `org.person.org-role-revoked`, `org.person.disabled`, `org.person.enabled`) in the same unit of work. No XC-004 `TelemetryEvent` is emitted unless the change touches an exercise (it does not here). Add an org-level overload to `StaffChangeRecorder` rather than a fake exercise id." |
| Grant / revoke org admin | Sign-in mints an org-scope session only if the person has a `StaffUser` facet (`OrgStaffLoginService.MintAsync`; `PulsePasswordIdentityProvider` rejects a person with no facet). `GrantAsync` creates the facet only on an enrollment. | Add: "Granting `OrgRole = orgAdmin` creates the person's `StaffUser` facet when missing (same Id as the `Person`, `ExternalSubject = pulse\|{id:N}`, as `EnrollmentService.GrantAsync` does), in the same transaction. Test: a freshly granted admin with a password can sign in org-scope." |
| Grant / revoke: "org admin sets/clears `OrgRole`" | Org admin is `Person.OrgRole`, not an exercise role (A1b). An org-admin's in-exercise access is a **planner enrollment** (migration + `OrgAdminSeedService`). | Add: "Clearing `OrgRole` does **not** remove the person's exercise enrollments. Granting does not create any. The org admin enrolls themselves (story 20, audited `org.enrollment.self-granted`) to act inside an exercise." |
| Last org admin (`409 last-org-admin`) | Not implemented anywhere (grep: no `last-org-admin`). Existing seed query counts `OrgRole` without `DisabledAt`. | Keep the AC, but state the count is `OrgRole = orgAdmin AND DisabledAt IS NULL`, evaluated in the same transaction as the write with a serializable/`UPDLOCK` read (two concurrent revokes of two admins must not leave zero). Add a race test. |
| Disable: "all that person's sessions are revoked" | `EnrollmentService.RevokeExerciseSessionsAsync` is per-exercise. Org-scope sessions have `ExerciseId` null. | "Revoke every live `Session` where `PersonId` or `StaffUserId` is the person (any `ExerciseId`, including null), then cut connections via `ISessionConnectionRevoker` after commit." New shared helper (e.g. `PersonSessionRevoker`); do not copy the exercise-bound one. |
| Role gating: "Planner ... refused (403) on every `/api/org/people*` route" | Correct, and now enforced by the A1c declarative role matrix. | Add: "Each route is registered in the route x role matrix (`RoleMatrixTests`, story 17) as orgAdmin-only; the avatar-read exception stays." |

### 3. Still to build (seams)
- Backend: `Features/Org/PeopleDirectory/*` slice (list/search/page, `PATCH` org-role, `PATCH` disabled), `AddOrgPeople()/MapOrgPeopleEndpoints()` one-liners for the orchestrator, `OrgAdminOnly` filter, `PersonSessionRevoker`, org-audit overload. The route family is `/api/org/people` (the existing `/api/org/*` routes are the pattern: mapped in `ExerciseLifecycleAdminEndpoints`).
- Frontend: directory table (COBRA, dense), React Query hooks over the shared axios client, service in the `orgExercisesService` style.
- Wiring: the 3 additive `Program.cs` lines were approved by the orchestrator for this PR (#668, Gate-1 S1); the `staffRouteRegistry.tsx` line and the `CompositionRootWiringTests` allow-list ride in the same PR.

### 4. Migration
**None for this story.** (`Person.AvatarBlobName` belongs to story 23's A2 migration, not here.) Do not add columns here; if the PR split puts the single A2 migration in the first A2 PR, this story merely rides on it.

### 5. Dependencies on #602 (must-fix hardening)
- **Hard dependency, serial:** the lockout counter atomicity fix (L-4) must land first or together. Disable/enable and the directory's "unlock" interact with `FailedLoginCount`/`LockedOutUntil`; building on the read-modify-write `StaffSignInLockout.RecordFailure` would copy the undercount.
- Soft: M-2 (timing side channels) is not touched by this story, but a list/search endpoint that confirms an email exists is an org-admin-only, authenticated read, so no oracle is added.
- L-2 (race between `Register` and `RevokeAsync`) matters for the "abort live SignalR connections on disable" AC: the test must open the connection before the change, as the AC says, and the connection re-check after `Register` should land before this story's disable is called safe.
