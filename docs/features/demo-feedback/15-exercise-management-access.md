# Story: Exercise management for controllers, and a "not allowed" page

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-074, COR-075 (role set widened)  ·  **Decisions:** DF-20  ·  **Issue:** #516
**Stack:** fullstack  ·  **World:** staff  ·  **Review:** Tier-2 (authorization change)  ·  **Priority:** Must  ·  **Wave:** 3  ·  **Effort:** S

## Context

Bug, 10/15: Tom's UAT account is a controller. `/staff/exercises` admits only planner and org admin, so
`StaffRouteTree` silently redirects a controller to `/staff/console` and nothing says why. Tom decided (DF-20):
controllers may list and create exercises too, at both the route registry and the backend org endpoints; any role
still not admitted to a staff path gets a page that says so instead of a silent bounce.

## Acceptance Criteria

- [ ] **Backend:** `POST /api/org/exercises` and `GET /api/org/exercises` admit `controller` in addition to `planner`
      and `orgAdmin` (`ExerciseAdminRoles.ExerciseAdministrators`, the filter and the services' own re-checks agree).
      An evaluator is still refused with `403`. `GET /api/org/staff-assignments` stays **org admin only**.
- [ ] A controller who creates an exercise gets a `controller` staff assignment on it (the existing "creator's role"
      rule), and the org-tier isolation rules in `features/exerciseLifecycleAdmin/README.md` still hold: no id in an
      org route, the tenant only from the server session, nothing across customers. The doc comments that say
      "a controller is refused" are updated.
- [ ] **Registry (orchestrator seam S-4, already on the integration branch):** the `exercise-management` entry's
      `allowedRoles` is `['planner', 'orgAdmin', 'controller']`; the controller's default stays `/staff/console`, and
      the surface launcher lists Exercise Management for a controller.
- [ ] **Not-allowed page:** in `StaffRouteTree`, a **registered** staff path the signed-in role is not admitted to
      renders a COBRA page, "You need the {roles} role to open {label}" (roles from the entry's `allowedRoles`, in
      words: planner, org admin, controller, evaluator), with a button to the role's own default page. An
      **unknown** `/staff/*` path keeps redirecting to the default as today. The page has a heading, is announced on
      route focus like any surface, and is never shown on a participant path.
- [ ] Docs: the stale "frontend outstanding" lines in `docs/features/exercise-lifecycle-admin/feature.md` and
      `docs/BUILD_PLAN.md` say the UI shipped in #411, and the feature doc records the controller widening (DF-20).

### Cross-cutting

- [ ] **Two worlds:** COBRA only. **Isolation:** the existing org-tier tests (no route parameters, tenant from the
      session) still pass, plus a controller case for create and list in a second tenant.

## Out of Scope

Rename / archive / duplicate (Wave 4). Staff-assignment management.

## Tests

Backend: controller create (201, controller assignment) and list (200, own tenant only); evaluator 403 on both;
controller 403 on staff-assignments. Frontend: a controller reaches `/staff/exercises`; an evaluator opening it sees
the not-allowed page naming the planner, org admin and controller roles, and the button goes to `/staff/evaluate`;
an unknown `/staff/nope` still redirects.

Linked — backend (`src/Pulse.WebApi.Tests/Features/ExerciseLifecycleAdmin/`, DB tests are `[RequiresDockerFact]` over the
real `Program` pipeline and the two-customer `OrgAdminTestWorld`):

- **Role set (filter + services agree):** `ExerciseAdminRolesTests.TheExerciseAdministratorSet_IsPlannerOrgAdminAndController_AndNothingElse`
  (exactly planner + orgAdmin + controller; evaluator refused), `.TheTwoRoleSets_DoNotNest_SoOrgAdminIsASeparateFamilyAndNotABiggerStaffRole`
  (controller is not an org admin), `.NoRoleSet_IsAWildcard_SoNoGlobalSuperAdminExists`
- **Controller create (201, controller assignment, own tenant):**
  `ExerciseCreationEndpointTests.Create_AsController_PersistsAnExerciseInTheCallersOwnTenant_WithAControllerAssignment`
- **Controller list (200, own tenant only, org-wide — an unassigned run of its own tenant is listed) + second tenant:**
  `ExerciseListEndpointTests.List_AsController_ReturnsOnlyTheCallersOwnTenantsExercises`,
  `.List_AsControllerInASecondTenant_NeverSeesWhatAControllerInTheFirstTenantCreated` (a controller in tenant A creates;
  a controller in tenant B lists only its own run)
- **Evaluator 403 on both:** `ExerciseCreationEndpointTests.Create_AsEvaluator_IsRefused`, `ExerciseListEndpointTests.List_AsEvaluator_IsRefused`
- **Staff assignments stay org admin only:** `OrgAdminSurfaceFamilyTests.StaffAssignments_AsController_IsRefused` (403),
  `.StaffAssignments_AsPlanner_IsRefused_SoOrgAdminIsNotJustABiggerStaffRole`, `.StaffAssignments_AsEvaluator_IsRefused`
- **Isolation unchanged:** the existing org-tier suites still pass — `ExerciseListEndpointTests.List_ReturnsOnlyTheCallersOrganizationsExercises_NeverAnotherCustomers`,
  `.List_DoesNotLeakTheOtherCustomersPortfolioSize_ThroughTheRowCount`, `CompositionRootWiringTests.TheOrgTierRoutes_TakeNoRouteParameters_SoThereIsNoIdorSurfaceOnTheOrgAxis`,
  `OrganizationResolutionPipelineOrderTests` (the tenant comes from the session)

Linked — frontend (`src/frontend/src/features/`):

- **Not-allowed page in `StaffRouteTree`:** `app-shell/StaffRouteTree.test.tsx` — "a registered path the role may not open
  says so (DF-20)": renders in place with an `h1` and no surface, names the roles in words, the button goes to the role's
  default, takes route focus labelled "Not allowed: …", exactly one `main`, the COBRA header reads "Not allowed"; unknown paths (`/staff/does-not-exist`, bare
  `/staff`, `/staff/plan/nested`) still redirect
- **Role words:** `app-shell/staffRoleWords.test.ts` (every role has words, "org admin", natural join, empty list)
- **Through the real entry:** `app-shell/RoleAwareEntry.staffRouting.test.tsx` (controller at `/staff/plan` and evaluator
  at `/staff/console` see the page; a participant/PIO on any typed staff path never sees it)
- **Copy:** `exerciseLifecycleAdmin/components/CreateExerciseForm.test.tsx` (a refused create says "Only a planner,
  controller or organization administrator can.")
- **Exercise management with the shipped registry:** `exerciseLifecycleAdmin/orgAdminSurfaceFamily.test.tsx` — a controller
  reaches `/staff/exercises`; an evaluator sees "You need the planner, org admin or controller role to open Exercise
  Management." and the button goes to `/staff/evaluate`; an unknown `/staff/nope` still redirects; a participant/PIO never
  sees the page. `exerciseLifecycleAdmin/exerciseManagementLauncher.test.tsx` (seam S-4) lists it in the controller's launcher
- **Other registered paths:** `participantAdmin/participantAdminRegistryRoute.test.tsx` (an evaluator and an org admin at
  `/staff/participant-admin` see the page, not the roster)
