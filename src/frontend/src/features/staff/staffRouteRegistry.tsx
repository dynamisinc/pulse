/**
 * features/staff/staffRouteRegistry.tsx
 * ---------------------------------------------------------------------------
 * THE STAFF ROUTE REGISTRY — the ONE place a staff surface is declared.
 *
 * ## How to add a staff surface (the whole procedure)
 *  1. Build the surface's route composition in ITS OWN feature and export it
 *     (e.g. `features/inject-queue/InjectQueueRoute.tsx` → the feature barrel).
 *     It owns its provider stack and mounts its own `StaffShellFrame` (COBRA).
 *  2. Add ONE entry to `STAFF_ROUTE_REGISTRY` below.
 *  3. There is no step 3. Routing, deep-linking, role gating, the unknown-path
 *     fallback and (later) launcher placement all follow from the entry.
 *
 * ~40 surfaces are planned this way — build workspace, readiness dashboard,
 * inject queue, monitoring board, timeline explorer, replay player, metrics,
 * AAR export, persona library, tuning, participant admin, exercise management —
 * so the cost of adding the 41st must stay one entry.
 *
 * ## Rules the entries must satisfy (all asserted by `staffRouteRegistry.test.tsx`)
 *  - `id` and `path` are unique; `path` starts with `/staff/`;
 *  - no entry claims `/staff/login` — the root router matches that pre-auth
 *    route first, so such an entry would be dead code;
 *  - `isDefaultFor ⊆ allowedRoles`, and each staff role is the default of at
 *    most one entry AND at least one entry (a role with no default has no home
 *    page and fails closed to `/login`);
 *  - `allowedRoles` is the ONLY gate. Do not add a second visibility check in a
 *    launcher or a surface — it will drift from routing.
 *
 * ## `allowedRoles` includes `orgAdmin` (COR-076)
 * The four roles that may appear in `allowedRoles` are controller, evaluator,
 * planner and — since the org-admin surface family landed — `orgAdmin`. That is
 * `StaffSurfaceRole`, which is deliberately NOT the same set as `core/auth`'s
 * `STAFF_ROLES`: org administration is its own authorization family but renders
 * in the same COBRA staff world, so its surfaces are ordinary registry entries.
 * See `app-shell/staffRouting.ts`'s `StaffSurfaceRole` for the full argument.
 * Whatever an entry names here must mirror what the SERVER's gate admits — a
 * role listed here that the API 403s gets a surface that cannot load.
 *
 * ## Two worlds (D0 §2)
 * STAFF world. Every element here is a COBRA surface. This file is imported ONLY
 * by the composition root, which injects it into `RoleAwareEntry`; that entry
 * consults the registry only AFTER the resolved role is a staff role, so no
 * participant path can reach any of it (COR-004/XC-002). Nothing here is, or may
 * become, a participant route table.
 *
 * ## Scenario time
 * No timestamps are rendered here — labels and descriptions only. The surfaces
 * themselves own their time rendering (staff surfaces show dual time; the
 * COR-053 scenario-time-only rule binds the participant world).
 */

import {
  faAddressBook, // #574
  faClipboardCheck,
  faFilePdf,
  faFolderOpen,
  faGear,
  faSliders,
  faUsers,
} from '@fortawesome/free-solid-svg-icons'
import type { StaffRouteRegistry } from '@/features/app-shell'
import { ControllerConsoleRoute } from '@/features/controller'
import { ExerciseReportPage } from '@/features/controller/report'
import { EvaluatorDashboardRoute } from '@/features/evaluator'
import { ExerciseManagementRoute } from '@/features/exerciseLifecycleAdmin'
import { OrgDirectoryRoute } from '@/features/orgDirectory' // #574
import { ParticipantAdminSurface } from '@/features/participantAdmin'
import { PlannerWorkspaceRoute } from '@/features/planner'

/**
 * The declared staff surfaces, in launcher/registry order.
 *
 * `as const satisfies` (rather than a plain annotation) type-checks every field
 * against `StaffRouteEntry` while keeping the literal `id`s inferable, which is
 * what makes {@link StaffRouteId} a useful union. The literal types stay INSIDE
 * this module: the exported {@link STAFF_ROUTE_REGISTRY} is widened to the
 * contract type, because a consumer calling e.g. `entry.allowedRoles.includes
 * (role)` against a union of literal tuples gets a `never` parameter.
 */
const REGISTRY_TABLE = [
  {
    id: 'planner-workspace',
    path: '/staff/plan',
    label: 'Exercise Settings',
    icon: faGear,
    element: <PlannerWorkspaceRoute />,
    allowedRoles: ['planner'],
    isDefaultFor: ['planner'],
    group: 'plan',
    description: 'Configure the exercise: identity, schedule, channels, theming and chrome.',
  },
  {
    id: 'controller-console',
    path: '/staff/console',
    label: 'Controller Console',
    icon: faSliders,
    element: <ControllerConsoleRoute />,
    // Seam S-3 (demo-feedback DF-14): evaluators may open the console READ-ONLY. Story 11's
    // `useCanControl()` removes every write control for them; the console is still nobody's
    // home page but the controller's (the evaluator keeps `/staff/evaluate`). The API lets an
    // evaluator read every console endpoint; the server enforces every write through the
    // role-matrix filters (`Features/Identity/RoleMatrix/*`, `LeadControllerRaiseFilter`,
    // write-time lead checks), and the UI gates only mirror it.
    // Planners (identity-auth-roles/17, Tom 2026-10-17) enter to author injects/personas and to
    // post/pin in build; every controller-only and lead-only control is gated by `can()` and fails
    // closed, and the server role matrix refuses those routes for planners.
    allowedRoles: ['controller', 'evaluator', 'planner'],
    isDefaultFor: ['controller'],
    group: 'conduct',
    description: 'Drive the simulated world: personas, injects, steering and the review queue.',
  },
  {
    id: 'evaluator-dashboard',
    path: '/staff/evaluate',
    label: 'Evaluator Dashboard',
    icon: faClipboardCheck,
    element: <EvaluatorDashboardRoute />,
    allowedRoles: ['evaluator'],
    isDefaultFor: ['evaluator'],
    group: 'evaluate',
    description: 'Observe and score the exercise: annotations, expected actions and AAR export.',
  },
  {
    // SURFACE #4, and the first one TWO roles may open (COR-074/075/076).
    //
    // `allowedRoles` mirrors the server's `ExerciseAdminRoles.ExerciseAdministrators`
    // gate EXACTLY — planner, org-admin or (DF-20) controller. Widening it beyond
    // the server would not grant anything (the endpoints 403), it would just show
    // a surface that fails; narrowing it would hide a surface its holder is
    // entitled to.
    //
    // `isDefaultFor: ['orgAdmin']` is what finally gives the org-admin family a
    // home page. Until COR-076, `RoleAwareEntry` fail-closed EVERY org-admin
    // session to `/login`; a role with no default here would put it straight
    // back there. The planner keeps `/staff/plan` as their default and gains
    // this as a second destination — which is also what takes `SurfaceLauncher`
    // out of its permanent single-surface degrade.
    id: 'exercise-management',
    path: '/staff/exercises',
    label: 'Exercise Management',
    icon: faFolderOpen,
    element: <ExerciseManagementRoute />,
    // Seam S-4 (demo-feedback DF-20, Tom 10/15): controllers list and create exercises too.
    // Story 15 widens the server's `ExerciseAdminRoles.ExerciseAdministrators` to match.
    allowedRoles: ['planner', 'orgAdmin', 'controller'],
    isDefaultFor: ['orgAdmin'],
    group: 'administer',
    description: 'Create exercises and see every run your organization owns.',
  },
  {
    // SURFACE #5 (easy-login, Gate-2 W-3): the roster, "Today's word" and the printable
    // card sheet. It was built and tested but UNREACHABLE until this entry existed.
    //
    // `allowedRoles` mirrors the server gate for the roster / day-word / cards endpoints
    // exactly: `controller` OR `planner` assigned to the exercise. An evaluator or an
    // org-admin would get a 403 on every call, so the surface is simply not offered
    // (a typed URL shows the "not allowed" page, like any other gated path; DF-20).
    //
    // No `isDefaultFor`: it is nobody's home page. The planner and controller keep
    // `/staff/plan` and `/staff/console`; they gain this as a second destination
    // under Administer in the surface launcher.
    //
    // `element` is `ParticipantAdminSurface`, NOT `ParticipantAdminRoute`: the surface
    // is the route with the day-word and print-cards slots composed in. The bare route
    // renders the roster alone (see `participantAdmin/ParticipantAdminSurface.tsx`).
    id: 'participant-admin',
    path: '/staff/participant-admin',
    label: 'Participants',
    icon: faUsers,
    element: <ParticipantAdminSurface />,
    allowedRoles: ['planner', 'controller'],
    group: 'administer',
    description: 'Who can sign in: the roster, personal links, today\'s word and printable cards.',
  },
  {
    // SURFACE #6 (demo-feedback 29, #550): the printable exercise report, opened in a NEW TAB by
    // the console's "Exercise report" button. Same guard as the console (`controller`), the role
    // that sees the button. A printed document: the page mounts its own COBRA toolbar and a
    // neutral sheet in a portal, so there is no StaffShellFrame here. Nobody's home page.
    id: 'exercise-report',
    path: '/staff/console/report',
    label: 'Exercise Report',
    icon: faFilePdf,
    element: <ExerciseReportPage />,
    allowedRoles: ['controller', 'evaluator'],
    group: 'conduct',
    description: 'A printable record of the posts, metrics and charts, to save as a PDF.',
  },
  { // #574 org people directory (org admin only)
    id: 'org-people-directory',
    path: '/staff/people',
    label: 'People',
    icon: faAddressBook,
    element: <OrgDirectoryRoute />,
    allowedRoles: ['orgAdmin'],
    group: 'administer',
    description: 'See your organization\'s people, grant org admin, disable and reset passwords.',
  },
] as const satisfies StaffRouteRegistry

/** The literal ids in the registry — usable as a telemetry/launcher key type. */
export type StaffRouteId = (typeof REGISTRY_TABLE)[number]['id']

/** The registry as consumers see it: the widened contract type. */
export const STAFF_ROUTE_REGISTRY: StaffRouteRegistry = REGISTRY_TABLE
