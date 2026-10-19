# Story: Staff invite and assign to exercises

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-010, COR-011, COR-077  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §1.1, §3.3, §7.5, §8.2  ·  **Issue:** #575
**Stack:** fullstack  ·  **Review tier:** Tier-2 (isolation, security)  ·  **Wave:** A2

## Context
Today nothing creates staff enrollments except bootstrap and the creator. Org admins invite people to the org, and planners (or org admins) assign staff roles in an exercise ([`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §1.1, §3.3, §7.5). Staff world.

## Acceptance Criteria
- [ ] **Invite.** Given an org admin and an email, when they invite, then a `Person` is created (or the existing one reused) and a single-use `CredentialToken` (purpose `invite`, 7 days) is emailed via `IPulseMailer`; the invitee sets a password (policy §3.2, 12-character staff minimum) and is signed in.
- [ ] **Assign.** Given a planner of exercise X (or an org admin), when they enroll a directory person as planner/controller/evaluator, then an `Enrollment` is created; the same person already holding a participant enrollment in X gets 409 `conflicting-enrollment`.
- [ ] **Last planner.** Removing the last planner of an exercise is refused (409); removing a controller/evaluator succeeds and revokes that person's sessions for that exercise. If the removed controller is the **lead**, the same transaction also clears `IsLead`, swamped mode is turned off after commit (idempotent), and both are audited (Option A, design doc §1.1/§12).
- [ ] **Org admin platform provisioning.** `POST /api/ops/organizations {name, adminEmail}` (bootstrap-secret gated) creates the org, its slug and first org-admin `Person` and sends an invite; an empty org admin can then sign in at `/o/{slug}`.
- [ ] **Self-enroll.** An org admin may enroll themselves; it is audited as `org.enrollment.self-granted`.
- [ ] **Emails** show the participant-facing/org name only, never an internal exercise name (#376).
- [ ] Isolation (XC-001/002, COR-001/002/007; brief C5): every new route has a foreign-exercise test **and** a foreign-org test; a cross-tenant id returns the same bare 404 as a missing id (the bare-404 pattern, design doc §7.2); id-taking org routes join the `CompositionRootWiringTests` allow-list.
- [ ] Telemetry (XC-004): the action emits an event (wall + scenario time, acting `PersonId` and role, channel `system`) per the v0 schema, in the same unit of work as the mutation.
- [ ] Two worlds (D0 §2): the surface uses COBRA (`@/theme/styledComponents`), is desktop-first, FontAwesome only, MUI 9 `sx`-only, and is never confusable with a participant view.
- [ ] Accessibility (NFR-001): WCAG 2.1 AA; keyboard-operable; status/error states are never color-only; async results announced via a live region.
- [ ] User guide (C5 docs-as-done): `docs/guide/planner-guide.md` is updated in the same PR (and `tools/guide-screenshots` if a screen changed), or the PR states "no guide impact". (inviting and assigning staff); remove the matching "ask Dynamis support" line.

### Copilot review 4 fold (2026-10-16, ADMIN-IDENTITY-MODEL §1.1)
- [ ] Removing a staff enrollment, or changing its role, revokes that person's live sessions on that exercise (access and refresh) in the same transaction, because `Session.Role` is persisted and survives refresh. A test covers both tokens.

### Lead controller UI (Tom, 2026-10-16)
- [ ] The staff assignment screen marks the exercise's lead controller and lets a planner change it (an org admin acts through their own enrollment), using the A1 endpoint. The lead is shown with a text label and an icon, never color alone.

### Orchestrator re-review fold (2026-10-16, Option A)
- [ ] Removing or demoting the **lead** controller is allowed. In one transaction it revokes that person's sessions on the exercise and clears `IsLead`. Swamped mode is turned off after commit, idempotently. All three are audited. Tests cover removal and demotion, each with swamped mode on beforehand: afterwards it is off, the exercise has no lead, and the old tokens get 401.

### Copilot review 5 fold (2026-10-16)
- [ ] Redeeming an invite sets the password but mints a session **only if a grant exists** (`OrgRole` or a staff enrollment in the org). Otherwise it shows an **"awaiting assignment"** page in COBRA staff styling, and normal sign-in works once the person is assigned. Tests cover both paths.
- [ ] Enrollment removal or a role change also aborts the person's live SignalR connections on that exercise.

### Copilot review 7 fold (2026-10-16)
- [ ] The "awaiting assignment" rule applies to **staff** invites only. Participant invites (roster "add to directory", promoting a one-off) are redeemed on the issuing exercise's host in the participant skin, and mint a participant session on that enrollment. Tests cover both roster flows.

## Out of Scope
Participant roster import and sign-in (easy-login); password reset (21); the directory page itself (19).

## Technical Notes
Staff world. Paths: `Features/Org/Invites/*`, `Features/Ops/Organizations/*`, `features/orgAdmin/` invite dialog, planner "Staff" tab. Uses `IPulseMailer` (generalized from `AcsParticipantLinkMailer`, shared with 21). **Orchestrator clearance first:** the wave EF migration, `Program.cs` route-group lines, and `App.tsx` / `staffRouteRegistry.tsx` additive lines go through the orchestrator's end-of-wave wiring commit; builders export one `Add*()`/`Map*()` line and do not edit them.

## Dependencies
Wave A2, after A1 and 19. Shares `IPulseMailer` + `CredentialToken` with 21 (serial edge: 21 owns the table, 20 consumes; build 21's token service first or in the same slice).

## Tests
Endpoint tests (foreign-exercise/foreign-org, conflicting-enrollment, last-planner); mailer fake; RTL for invite/assign UI.

## A1b/A1c reality check (2026-10-19)
Checked against what A1b (#608), A1c (#615) and Phase 2 (#642) shipped. The ACs above are history and stay; where this section contradicts one, **this section wins**. No ACs were ticked.

### 1. Already satisfied by shipped code
- **Assign** (service only, not routed): `EnrollmentService.GrantAsync(exerciseId, personId, role)`. Planner of that exercise or org admin; staff roles only; 409 `conflicting-enrollment` via an in-code check and the `(ExerciseId, PersonId)` unique index; bare 404 for foreign exercise/person (`FindReachableExerciseAsync`, `InOrganization`); creates the `StaffUser` facet; XC-004 `enrollment.granted` + org audit; self-grant is audited `org.enrollment.self-granted` (`SelfGrantedAuditKind`). The "Self-enroll" AC is therefore done in the service.
- **Role change**: `ChangeRoleAsync` revokes the person's live sessions on that exercise (`RevokeExerciseSessionsAsync`, access and refresh via `RevokedAt`), cuts connections after commit, and releases the lead (clears `IsLead`, turns swamped mode off after commit, idempotent, audited via `ReleaseLeadIfLost` + `TurnSwampedModeOffAfterCommitAsync`). Covers the Option A removal/demotion ACs for **demotion**.
- **Removal**: `RevokeAsync` does the same for removal (session revoke, lead release, swamped off, audit, connection cut).
- **Lead UI backend**: `PUT /api/staff/enrollments/{id}/lead` (`EnrollmentEndpoints.LeadRoute`, planner only) is routed. Since #642 a lead **transfer** also turns swamped mode off (`reason: lead-transferred`, `SetLeadAsync` -> `TurnSwampedModeOffAfterCommitAsync`; records nothing if it was already off). The lead UI AC needs no backend work, but its copy must warn: "Making someone else the lead turns swamped mode off."
- **Org-wide read for the Staff tab**: `GET /api/org/staff-assignments` (`OrgStaffDirectoryService`, org admin only). A planner has no read of their own exercise's staff list yet (see 3).
- Pulse password sign-in, lockout, org choice and org audit exist (`OrgStaffLoginService`, `PulsePasswordIdentityProvider`, `StaffSignInLockout`, `LoginChoice*`). The invitee's later sign-in needs no new login code.
- Bootstrap/seed: `OrgAdminSeedService` already creates Person + StaffUser + `OrgRole` + planner enrollments for the dev seed; `BootstrapService` creates the default org with a slug.

### 2. Stale or contradicted (reworded)
| Original AC | Problem | Replace with |
|---|---|---|
| **Last planner**: "Removing the last planner is refused (409)" | `EnrollmentService.RevokeAsync`/`ChangeRoleAsync` have **no** last-planner check (grep: none). The matrix (design §8.2) says "cannot remove the last planner". | Keep AC; it is **to build**: 409 `last-planner` on `RevokeAsync` and on `ChangeRoleAsync` away from planner when the target is the exercise's only planner. Count and write in one transaction (race test with two planners). |
| **Last planner** "removing a controller/evaluator succeeds" and the lead sentence | Done in service. The Option A text is correct as written (clear `IsLead`, swamped off after commit, idempotent, audited). | No change. |
| Org-admin Assign: "(or an org admin)" | Matches `GrantAsync.AuthorizeAsync` (org-scope session). But an org admin acting **inside** an exercise acts through a planner enrollment (A1b/A1c). `SetLeadAsync` explicitly refuses org scope. | Add: "An org-scope admin may assign and remove staff across the org's exercises (service-level, already so); setting the lead stays planner-only, so the UI offers it only through the admin's own planner enrollment." |
| **Invite**: "Person is created ... invitee sets a password and is signed in" | Sign-in needs a `StaffUser` facet; a `Person` with no grant has none, so a Pulse-password sign-in is rejected (`PulsePasswordIdentityProvider`: `staffUser is null -> Rejected`). Nothing in the codebase sets `Person.PasswordHash` yet; a password setter + policy (story 21) does not exist. | "Redeeming an invite (a) validates the password policy (story 21's `PasswordPolicy`, staff minimum 12), (b) hashes with `PasswordHasher<Person>` (the same hasher `PulsePasswordIdentityProvider` verifies with), (c) sets `PasswordHash`/`PasswordChangedAt`, clears `FailedLoginCount`/`LockedOutUntil`, (d) invalidates other outstanding tokens and unconsumed `LoginChoiceCandidate`s via `OrgStaffLoginService.StageCredentialChangeInvalidationAsync`, (e) revokes all the person's live sessions, and (f) mints a session only if a grant exists (`OrgRole` or a staff `Enrollment`), else shows 'awaiting assignment'." The 'grant exists' test is `Person.OrgRole` or any `EnrollmentRoles.IsStaffEnrollment` row (the facet is created only by a grant, so facet existence is the same signal). |
| **Invite** token: "single-use `CredentialToken`" | Table does not exist (no `CredentialToken` in code). Story 21 owns it. | Unchanged, but state **sequencing**: story 21's token service and migration land first; 20 consumes. |
| **Org admin platform provisioning**: `POST /api/ops/organizations` | Bootstrap-secret gating exists as a pattern (`BootstrapSecretGate.IsAuthorized`, `X-Bootstrap-Secret`, `AllowAnonymousPreAuth`, `ops-bootstrap` rate-limit policy, 404 on bad secret). Not in the pre-auth allowlist yet. | Add: "Route is added to `PreAuthAllowlist` exactly like `/api/ops/bootstrap-exercise` and 404s on a bad secret. It creates the `Organization` with a collision-safe slug (reuse `OrganizationSlug.FromName` **plus the `-2` suffix logic** from #602 L-5), the first-admin `Person` with `OrgRole = orgAdmin`, **and its `StaffUser` facet at creation** (otherwise the org-scope sign-in cannot mint, even after the invite is redeemed). The sign-in then works at `/o/{slug}`; an empty org (zero exercises) is fine (org-scope session, story 15)." |
| Telemetry: "XC-004 event ... same unit of work" | Fine for enrollment actions (`StaffChangeRecorder` writes both the exercise XC-004 event and the org audit). **Not** possible for invite issue/redeem and org provisioning (no exercise). | "Enrollment actions: XC-004 event + org audit (already so). Invite issue, invite redeem and org provisioning: `OrgAuditEvent` only (`org.invite.issued`, `org.invite.redeemed`, `org.organization.created`), plus `identity.credential.changed` on redeem as design §3.3 requires." |
| Technical Notes: "`features/orgAdmin/` invite dialog, planner 'Staff' tab" | No `features/orgAdmin`. Planner console is `features/planner` (settings page sections via `exerciseSettingsSections.ts`); org surfaces are in `features/exerciseLifecycleAdmin`. | "Planner Staff tab is a section in `features/planner` (new section in `exerciseSettingsSections.ts` or a sibling page); org-admin invite dialog in the org-people surface (story 19). Gate with `can('assignStaff')` (**new** `StaffAction`, planner + orgAdmin) in `core/auth/rolePermissions.ts`; the existing `setLeadController` (planner) already exists for the lead control." |
| Emails: "show participant-facing/org name only" | `AcsParticipantLinkMailer` is participant-only; `IPulseMailer` does not exist. Staff invite has no exercise, so there is no exercise name to leak; the template should show the **organization name**. | "Staff invite email shows the organization name and the org slug sign-in URL only." |
| Dependencies "Shares `IPulseMailer` + `CredentialToken` with 21" | Right, and both are new (no existing code). | Unchanged. |

### 3. Still to build (seams)
- **Routes for the existing service methods** (the A1 comment in `EnrollmentService` says A2 maps them): `POST /api/org/exercises/{exerciseId}/enrollments` (-> `GrantAsync`), `PATCH /api/staff/enrollments/{id}` (-> `ChangeRoleAsync`), `DELETE /api/staff/enrollments/{id}` (-> `RevokeAsync`). Add them in `EnrollmentEndpoints.MapEnrollmentEndpoints` using the existing `ToHttpResult` mapping (it already maps 409 bodies); add them to the role matrix and the isolation/wiring allow-lists.
- **Planner read of the exercise's staff list** (`GET .../enrollments`, planner scoped by the central exercise filter, org admin by `InOrganization`) for the Staff tab and the lead marker (`EnrollmentDto.isLead` exists).
- `last-planner` guard (above).
- `Features/Org/Invites/*`, `IPulseMailer` (generalise `AcsParticipantLinkMailer`, `Features/Identity/LinkEmail/*`), invite redeem page ("awaiting assignment" in COBRA, staff world), `Features/Ops/Organizations/*`.
- Frontend: invite dialog, Staff tab with lead marker (icon + text), `assignStaff` permission.
- **Retire the secret path**: after this lands, `docs/OPERATE.md` "Test staff accounts (role smoke)" and `docs/features/login/06-uat-goLive-config-runbook.md` ("Adding test staff accounts") must say to invite test staff instead of editing `STAFF_IDENTITY_ACCOUNTS_JSON`. **The secret itself stays** as the break-glass allowlist (design §1.3): `DynamisIdentityProvider` remains the fallback for people with no Pulse password, and `PulsePasswordIdentityProvider` already refuses the fallback once a Pulse password exists. Add an AC: "OPERATE.md and login/06 updated; the 'ask Dynamis support' guide lines removed; the allowlist is documented as break-glass only." Do not delete `infrastructure/` secret plumbing.

### 4. Migration (flag)
- **`CredentialToken` table: YES, a new EF migration, owned by story 21** (design §9: A2 row, with `People.AvatarBlobName`, `Exercises.SignInMethods`, `MediaAssets.UploadedByAccountId`). Story 20 adds no schema of its own beyond that.
- **Soft-delete revoke (XC-010): needs a decision, and a migration if yes.** `EnrollmentService.RevokeAsync` hard-deletes the `Enrollment` row (`_dbContext.Enrollments.Remove`). XC-010 says nothing is hard-deleted during a live exercise; the removal is currently retained only as an `OrgAuditEvent`/`TelemetryEvent` record, not as the row. Recommended: add `Enrollment.DeletedAt` (nullable `datetimeoffset`), make revoke set it, and **rebuild the unique index** `(ExerciseId, PersonId)` filter to `[PersonId] IS NOT NULL AND [DeletedAt] IS NULL` (otherwise re-enrolling a removed person hits 409 forever), update the `IsLead` filtered index likewise, and add `DeletedAt IS NULL` to every enrollment reader (`FindReachableAsync`, `MostRecentlyUsedStaffEnrollmentAsync`, `OrgStaffDirectoryService`, `GrantAsync.alreadyEnrolled`, session-attribution readers). The central exercise filter is the right place. If Tom accepts "audit record is the retention", record that decision in this story and skip the migration. Either way it is a **#602 item** (soft-delete revoke).
- Email verification: **no migration** and none in scope. The invite token's delivery to the address is the verification; do not add `EmailVerifiedAt` in A2 (log as a follow-up if wanted).

### 5. Dependencies on #602
- **L-5 (slug collision)** is a hard prerequisite for `POST /api/ops/organizations` (new orgs hit the unique slug index) and should fix `BootstrapService` and the new route with one shared helper.
- **M-2 (timing side channels)** must land **before the first invite is redeemable**: until now nobody has a Pulse password, so the side channels were latent; redeeming an invite is what creates the first `PasswordHash`. Gate the invite-redeem PR on it.
- **L-4 (lockout counter atomicity)** must land before or with redeem (redeem resets the counter; lockout must be race-safe once real passwords exist).
- **LoginChoice IP binding**: `LoginChoice.CreatedFromIpHash` is stored but `OrgStaffLoginService.ChooseAsync` never compares it. Fix before real passwords exist.
- **L-2** (connection registry race) matters for the "abort SignalR connections on removal/role change" AC.
- **Soft-delete revoke**: see 4.
