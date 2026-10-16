# Story: Staff invite and assign to exercises

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-010, COR-011, COR-077  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §1.1, §3.3, §7.5, §8.2  ·  **Issue:** #575
**Stack:** fullstack  ·  **Review tier:** Tier-2 (isolation, security)  ·  **Wave:** A2

## Context
Today nothing creates staff enrollments except bootstrap and the creator. Org admins invite people to the org, and planners (or org admins) assign staff roles in an exercise ([`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §1.1, §3.3, §7.5). Staff world.

## Acceptance Criteria
- [ ] **Invite.** Given an org admin and an email, when they invite, then a `Person` is created (or the existing one reused) and a single-use `CredentialToken` (purpose `invite`, 7 days) is emailed via `IPulseMailer`; the invitee sets a password (policy §3.2, 12-character staff minimum) and is signed in.
- [ ] **Assign.** Given a planner of exercise X (or an org admin), when they enroll a directory person as planner/controller/evaluator, then an `Enrollment` is created; the same person already holding a participant enrollment in X gets 409 `conflicting-enrollment`.
- [ ] **Last planner.** Removing the last planner of an exercise is refused (409); removing a controller/evaluator succeeds and revokes that person's sessions for that exercise.
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

## Out of Scope
Participant roster import and sign-in (easy-login); password reset (21); the directory page itself (19).

## Technical Notes
Staff world. Paths: `Features/Org/Invites/*`, `Features/Ops/Organizations/*`, `features/orgAdmin/` invite dialog, planner "Staff" tab. Uses `IPulseMailer` (generalized from `AcsParticipantLinkMailer`, shared with 21). **Orchestrator clearance first:** the wave EF migration, `Program.cs` route-group lines, and `App.tsx` / `staffRouteRegistry.tsx` additive lines go through the orchestrator's end-of-wave wiring commit; builders export one `Add*()`/`Map*()` line and do not edit them.

## Dependencies
Wave A2, after A1 and 19. Shares `IPulseMailer` + `CredentialToken` with 21 (serial edge: 21 owns the table, 20 consumes; build 21's token service first or in the same slice).

## Tests
Endpoint tests (foreign-exercise/foreign-org, conflicting-enrollment, last-planner); mailer fake; RTL for invite/assign UI.
