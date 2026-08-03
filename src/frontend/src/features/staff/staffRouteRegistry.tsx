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
  faClipboardCheck,
  faFolderOpen,
  faGear,
  faSliders,
} from '@fortawesome/free-solid-svg-icons'
import type { StaffRouteRegistry } from '@/features/app-shell'
import { ControllerConsoleRoute } from '@/features/controller'
import { EvaluatorDashboardRoute } from '@/features/evaluator'
import { ExerciseManagementRoute } from '@/features/exerciseLifecycleAdmin'
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
    allowedRoles: ['controller'],
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
    // gate EXACTLY — planner OR org-admin. Widening it here would not grant
    // anything (the endpoints 403), it would just show a controller a surface
    // that fails; narrowing it would hide a surface its holder is entitled to.
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
    allowedRoles: ['planner', 'orgAdmin'],
    isDefaultFor: ['orgAdmin'],
    group: 'administer',
    description: 'Create exercises and see every run your organization owns.',
  },
] as const satisfies StaffRouteRegistry

/** The literal ids in the registry — usable as a telemetry/launcher key type. */
export type StaffRouteId = (typeof REGISTRY_TABLE)[number]['id']

/** The registry as consumers see it: the widened contract type. */
export const STAFF_ROUTE_REGISTRY: StaffRouteRegistry = REGISTRY_TABLE
