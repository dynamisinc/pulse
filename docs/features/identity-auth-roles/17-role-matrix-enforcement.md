# Story: Role-matrix enforcement (per-route, per-transition) with a route x role matrix test

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-010, COR-013 (+ P0 #377, #481, #61)  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §8.2, §5.1  ·  **Issue:** #573
**Stack:** backend  ·  **Review tier:** Tier-2 (security)  ·  **Wave:** A1

## Context
The lifecycle transition endpoint is guarded only by "assigned staff", with **no role check** (#377/#481), and
evaluators are not refused every write (#61). Tom signed off the role matrix ([`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §8.2). This story enforces it per
route and per lifecycle transition and proves it with a route x role matrix test. Staff world.

## Acceptance Criteria
- [ ] **Transitions are role-checked.** Given the lifecycle endpoint, then stage/unstage = planner; archive = planner or
      org admin; StartEx, pause/resume, EndEx, reopen, Freeze/pause tiers = controller; unarchive = org admin only (returns to the prior state). Archive is also allowed from `build` when `FirstLiveAt` is set (planner or org admin).
      Any other role gets 403 and the state is unchanged.
- [ ] **Narrowings land.** Create exercise is org admin only (planner/controller refused); settings, chrome, practice mode
      are planner only (controller refused); view-only code rotate/revoke is planner + controller (evaluator refused).
- [ ] **Evaluator writes nothing (#61).** Every mutating route refuses `evaluator` with no state change; evaluator reads the
      exercise (console, feeds, report).
- [ ] **Org admin has no implicit exercise power.** Org-scope session on an exercise-scoped route is refused; "via enrollment"
      rows apply only when the org admin holds that enrollment.
- [ ] **Route x role matrix test.** Given every mapped route enumerated from endpoint metadata, then each is asserted for
      orgAdmin, planner, controller, evaluator, participant/pio and readonly against the §8.2 table; a route with no
      matrix entry fails the build. Includes the lifecycle-gated (L) cases.
- [ ] **Bare-404 pattern:** a foreign-exercise or foreign-org id returns the same 404 as a missing id, before the role check leaks existence.
- [ ] Isolation (XC-001/002, COR-001/002/007; brief C5): every new route has a foreign-exercise test **and** a foreign-org test; a cross-tenant id returns the same bare 404 as a missing id (the bare-404 pattern, design doc §7.2); id-taking org routes join the `CompositionRootWiringTests` allow-list.
- [ ] Telemetry (XC-004): the action emits an event (wall + scenario time, acting `PersonId` and role, channel `system`) per the v0 schema, in the same unit of work as the mutation.
- [ ] User guide (C5 docs-as-done): `docs/guide/planner-guide.md` (role table) and `controller-guide.md` are updated in the same PR, or the PR states "no guide impact".

### Copilot review 2 fold (2026-10-16, ADMIN-IDENTITY-MODEL §8.2)
- [ ] In the matrix, participant sim writes are allowed in `live` **and `staged`** (dry runs), and refused when paused or frozen. The matrix test asserts both.

### Lead controller (Tom, 2026-10-16; ADMIN-IDENTITY-MODEL §8.2)
- [ ] *(Direction semantics PENDING Tom, design doc §12.)* The swamped-mode toggle and the engine autonomy-level write require a **lead** controller. Other controllers, planners and evaluators get 403. The route × role matrix gains a `lead controller` column, and the test asserts it.

### Orchestrator review fold (2026-10-16, ADMIN-IDENTITY-MODEL §8.2)
- [ ] The lead gate is a filter that reads `Enrollment.IsLead` **live** on each request (a sibling of `EngineCockpitControllerRoleFilter`), keyed on the session's `PersonId` and never on a body `actingHumanId`.
- [ ] The routes it covers: `POST /api/engine/autonomy/swamped-mode`, `/api/engine/autonomy/restore`, `/api/engine/settings/autonomy-default`, `/api/engine/settings/tier-policy` and `/api/engine/generation-provider/restore`, with direction semantics per the decision in §12. The kill switch and `cut-to-fake` stay open to any controller.
- [ ] The matrix includes a "set lead controller" row: planner ✅; every other role 403.

## Out of Scope
The new transitions themselves (reset/reopen/delete/unstage bodies: exercise-build-golive 07-08); the lifecycle write gate for participants (A5 #379).

## Technical Notes
Staff world. Build one declarative route-policy attribute / filter, not scattered `if`s. Files: `LifecycleEndpoints.cs`,
`Features/ExerciseLifecycleAdmin/*`, settings/view-only-code endpoints, `Pulse.WebApi.Tests/.../RoleMatrixTests.cs` (new). **Orchestrator clearance required first (A1):** the EF migration `AdminIdentityFoundation`, `Program.cs` edits, `App.tsx` / `staffRouteRegistry.tsx` edits and every frozen-type change (`Session`/`SessionDto`, `ExerciseRole`, `StaffAssignment` -> `Enrollment`, the staff login request) go through the orchestrator; post the frozen-type changes on the feature issue before A1 merges (brief C1.4). Builders export one `Add*()`/`Map*()` line each; they do not edit `Program.cs`.

## Dependencies
Wave A1 after 16 (reads `Enrollment.Role`). Feeds identity 04 and exercise-lifecycle-admin 01/03.

## Tests
`RoleMatrixTests` (the matrix), per-transition tests, the standing isolation suite with foreign-org cases.
