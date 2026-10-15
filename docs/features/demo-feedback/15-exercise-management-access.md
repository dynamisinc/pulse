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
