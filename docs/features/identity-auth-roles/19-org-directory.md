# Story: Org directory (people list and org-admin grants)

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-010, COR-077, COR-017  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §1.1, §2.1, §7.1, §8.2  ·  **Issue:** —
**Stack:** fullstack  ·  **Review tier:** Tier-2 (isolation)  ·  **Wave:** A2

## Context
An org admin needs to see and manage the people in their organization without asking Dynamis. This story delivers the `/api/org/people` family and the org console directory page ([`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §1.1, §7.1). Staff world, org scope.

## Acceptance Criteria
- [ ] **List.** Given an org-scope session, when `GET /api/org/people` is called, then it returns only `Person` rows of the caller's organization (name, email, org role, enrollments summary, disabled flag), paged and searchable by name/email.
- [ ] **Grant / revoke org admin.** Given an org admin, when they set or clear `OrgRole = orgAdmin` on a person, then it persists, is audited, and the **last org admin cannot be removed** (409).
- [ ] **Disable / enable.** Given an org admin disables a person, then `DisabledAt` is set, all that person's sessions are revoked, and sign-in returns the uniform 401; enabling reverses it.
- [ ] **Role gating.** Planner, controller, evaluator, participant and readonly sessions are refused (403) on every `/api/org/people*` route (route x role matrix, story 17).
- [ ] **Directory shows people only.** One-off participants (`Enrollment.PersonId` null) never appear in the directory.
- [ ] Isolation (XC-001/002, COR-001/002/007; brief C5): every new route has a foreign-exercise test **and** a foreign-org test; a cross-tenant id returns the same bare 404 as a missing id (the bare-404 pattern, design doc §7.2); id-taking org routes join the `CompositionRootWiringTests` allow-list.
- [ ] **Bare 404 on `personId` routes:** `GET/PATCH /api/org/people/{id}` with a foreign-org id returns the same 404 as a missing id; routes are added to the org-tier allow-list extended to `personId`.
- [ ] Telemetry (XC-004): the action emits an event (wall + scenario time, acting `PersonId` and role, channel `system`) per the v0 schema, in the same unit of work as the mutation.
- [ ] Two worlds (D0 §2): the surface uses COBRA (`@/theme/styledComponents`), is desktop-first, FontAwesome only, MUI 9 `sx`-only, and is never confusable with a participant view.
- [ ] Accessibility (NFR-001): WCAG 2.1 AA; keyboard-operable; status/error states are never color-only; async results announced via a live region.
- [ ] User guide (C5 docs-as-done): `docs/guide/planner-guide.md` is updated in the same PR (and `tools/guide-screenshots` if a screen changed), or the PR states "no guide impact". (new "People" section).

## Out of Scope
Inviting staff (20); resets (21); avatars (23); deleting a person; MFA; SSO.

## Technical Notes
Staff world. Paths: `Features/Org/People/*` (backend), `features/orgAdmin/` directory page (COBRA table, dense). Reuse `InOrganization`, shared axios client, React Query hooks, `StaffCallerContext`. Route lines are wired by the orchestrator. **Orchestrator clearance first:** the wave EF migration, `Program.cs` route-group lines, and `App.tsx` / `staffRouteRegistry.tsx` additive lines go through the orchestrator's end-of-wave wiring commit; builders export one `Add*()`/`Map*()` line and do not edit them.

## Dependencies
Wave A2, after A1 (16, 17). Can run with 22, 24.

## Tests
Endpoint tests (incl. foreign-org, last-admin, disabled sign-in); RTL for the directory page; role-matrix entries.
