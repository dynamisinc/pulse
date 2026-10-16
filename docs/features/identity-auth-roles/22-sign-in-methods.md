# Story: Per-exercise sign-in methods

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-011, COR-017, COR-015  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §3.4, §5.3, §8.2  ·  **Issue:** #577
**Stack:** fullstack  ·  **Review tier:** Tier-2 (security)  ·  **Wave:** A2

## Context
Planners choose which participant sign-in methods an exercise allows: `PersonalLink | DayWord | Password` ([`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §3.4). Default all three. Staff-world setting, effect on the participant sign-in.

## Acceptance Criteria
- [ ] **Setting.** `Exercises.SignInMethods` (flags) defaults to all three; only a planner can change it (controller refused, matrix).
- [ ] **At least one on.** When participant accounts exist, switching off the last method is refused (409); with no accounts it is allowed but flagged by readiness (build-golive 03).
- [ ] **Password off.** Given Password is off, when `POST /api/auth/login` is called for that exercise, then it returns the uniform 401; forgot-password from that host returns 202 and sends nothing, revealing nothing.
- [ ] **Link/day word off** respectively refuse `/join` and day-word sign-in with the existing uniform failure.
- [ ] The view-only code is a separate switch and is unchanged (COR-015/016).
- [ ] Isolation (XC-001/002, COR-001/002/007; brief C5): every new route has a foreign-exercise test **and** a foreign-org test; a cross-tenant id returns the same bare 404 as a missing id (the bare-404 pattern, design doc §7.2); id-taking org routes join the `CompositionRootWiringTests` allow-list.
- [ ] Telemetry (XC-004): the action emits an event (wall + scenario time, acting `PersonId` and role, channel `system`) per the v0 schema, in the same unit of work as the mutation.
- [ ] Two worlds (D0 §2): the surface uses COBRA (`@/theme/styledComponents`), is desktop-first, FontAwesome only, MUI 9 `sx`-only, and is never confusable with a participant view.
- [ ] Accessibility (NFR-001): WCAG 2.1 AA; keyboard-operable; status/error states are never color-only; async results announced via a live region.
- [ ] The participant sign-in page hides disabled methods, in the exercise brand skin, without naming the internal exercise (no-enterprise-look).
- [ ] User guide (C5 docs-as-done): `docs/guide/planner-guide.md` is updated in the same PR (and `tools/guide-screenshots` if a screen changed), or the PR states "no guide impact". (sign-in methods).

## Out of Scope
Per-person overrides; SSO; changing the view-only code.

## Technical Notes
Staff settings panel (COBRA) + participant sign-in page (brand skin). Paths: `Features/Exercises/Settings/*`, `Features/Identity/ParticipantLoginService.cs`. **Orchestrator clearance first:** the wave EF migration, `Program.cs` route-group lines, and `App.tsx` / `staffRouteRegistry.tsx` additive lines go through the orchestrator's end-of-wave wiring commit; builders export one `Add*()`/`Map*()` line and do not edit them.

## Dependencies
Wave A2, after A1 (17 for planner-only settings). Can run with 19, 24.

## Tests
Method x setting matrix tests; uniform-401 and no-leak tests; RTL for the settings control and the sign-in page.
