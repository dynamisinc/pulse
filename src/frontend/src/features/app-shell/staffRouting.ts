/**
 * features/app-shell/staffRouting.ts
 * ---------------------------------------------------------------------------
 * The STAFF ROUTE REGISTRY contract — the typed vocabulary + pure resolvers that
 * turn "one staff surface per role" into "many deep-linkable staff surfaces per
 * role" (feature: app-shell, extends story 01; COR-004/COR-005, NFR-001).
 *
 * ## Why this module exists
 * Before this, the app had exactly three URLs (`/login`, `/staff/login`, `*`)
 * and the catch-all rendered whichever single surface the session's ROLE mapped
 * to. That is correct for participants (see COR-004 below) and wrong for staff:
 * a planner got exactly one page, ~40 planned staff surfaces (build workspace,
 * readiness dashboard, inject queue, monitoring board, timeline explorer, replay
 * player, metrics, AAR export, persona library, tuning, participant admin,
 * exercise management, …) had nowhere to mount, and no staff state was
 * deep-linkable or back-button-able.
 *
 * This file holds the SHAPE of that registry; the concrete table (the one place
 * a new staff surface is declared) lives in the staff world at
 * `@/features/staff/staffRouteRegistry`, because it names concrete COBRA
 * surfaces. Keeping the shape here — world-neutral, importing no surface and no
 * theme — is what lets `RoleAwareEntry` / `StaffRouteTree` consume a registry
 * that is INJECTED (IoC, see this feature's README) rather than imported.
 *
 * ## COR-004 — what this module must never become
 * The registry is STAFF-ONLY. Participants have no UI concept of exercise
 * selection and MUST NOT route on a typed path: a participant typing
 * `/staff/console` still lands on their participant surface. That guarantee is
 * structural — `RoleAwareEntry`'s participant branch never reads the location at
 * all, and this registry is only ever consulted after the resolved role has been
 * narrowed to a staff role. Nothing here may be reused to pick a PARTICIPANT
 * surface from a URL.
 *
 * ## Extensibility: adding surface #4
 * Add ONE entry to `STAFF_ROUTE_REGISTRY` (in `@/features/staff`). `allowedRoles`
 * is the single source of truth for BOTH routing (this file's resolvers, applied
 * by `StaffRouteTree`) and, later, launcher visibility — there is deliberately no
 * second gate to keep in sync. `group` sections the surface in that future
 * launcher (Conduct / Plan / Evaluate / Administer). No launcher UI is built
 * here.
 *
 * World: routing glue — world-neutral. No COBRA, no participant skin, no
 * surface imports, no `react-router` imports (the resolvers are pure functions
 * over the table; only `StaffRouteTree` touches the router).
 */

import type { ReactNode } from 'react'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import type { ExerciseRole } from '@/core/auth'

/**
 * The roles that can reach a REGISTERED SURFACE in this route tree:
 * controller / evaluator / planner — and, since COR-076, `orgAdmin`.
 *
 * ## This is NOT the same predicate as `isStaffRole()` (COR-076)
 * `core/auth/roles.ts` keeps `orgAdmin` out of `STAFF_ROLES` **on purpose**, and
 * this module does NOT change that. Those are two different questions and they
 * now have two different answers:
 *
 *  - `isStaffRole(role)` (`@/core/auth`) — "is this one of the three
 *    AUTHORIZATION-family roles that operate INSIDE one exercise?" `orgAdmin`
 *    operates ABOVE the exercise (which runs the customer owns, who is assigned
 *    to them), so it is a third, separate family and stays outside that set.
 *    XC-002 ("a participant role can never reach a staff surface") is enforced
 *    through `STAFF_ROLES` / `PARTICIPANT_ROLES`, and widening `STAFF_ROLES`
 *    would have quietly moved an authorization boundary to buy a route.
 *  - `isStaffSurfaceRole(role)` (here) — "may this role index the staff route
 *    REGISTRY?" That is a routing question, and the answer for `orgAdmin` is
 *    yes: `03-orgadmin-surface-family.md` is explicit that there is no third
 *    *visual* world ("OrgAdmin renders in COBRA, exactly like the other three
 *    staff surfaces"), so its surfaces are ordinary registry entries gated by
 *    `allowedRoles` like everyone else's.
 *
 * The two sets are therefore deliberately UNEQUAL by exactly one member, and
 * `staffRouting.test.ts` pins that relationship (`STAFF_SURFACE_ROLES` ===
 * `STAFF_ROLES` + `orgAdmin`) so neither can drift silently: add a fourth core
 * staff role and this list fails loudly instead of routing that role to the
 * fail-closed login redirect; drop `orgAdmin` and story 03's AC1 regresses.
 *
 * Derived from the core role vocabulary with `Extract` so a rename there is a
 * compile error here rather than a silent divergence. Participant roles
 * (`participant`/`pio`) are — and must stay — absent: that exclusion is the
 * XC-002 half this type carries.
 */
export type StaffSurfaceRole = Extract<
  ExerciseRole,
  'controller' | 'evaluator' | 'planner' | 'orgAdmin'
>

/**
 * The same four roles as a runtime list. See {@link StaffSurfaceRole} for why
 * this is `STAFF_ROLES` **plus** `orgAdmin` rather than equal to it.
 */
export const STAFF_SURFACE_ROLES: readonly StaffSurfaceRole[] = [
  'controller',
  'evaluator',
  'planner',
  'orgAdmin',
]

/**
 * Narrows a resolved role to one that can index the staff route registry.
 *
 * Admitting a role here is NOT authorization: it only says the role is allowed
 * to be *looked up* in the registry. What it may actually open is still decided
 * entirely by each entry's `allowedRoles`, and a role the registry has nothing
 * for still resolves to `undefined` in {@link resolveDefaultStaffRoute} and
 * fails closed at the caller (`RoleAwareEntry`).
 */
export function isStaffSurfaceRole(role: ExerciseRole): role is StaffSurfaceRole {
  return (STAFF_SURFACE_ROLES as readonly ExerciseRole[]).includes(role)
}

/**
 * The launcher sections a staff surface can belong to. Chosen to mirror the
 * exercise lifecycle a staff member thinks in, not the codebase's feature
 * folders: **plan** (build the exercise) → **conduct** (run it) → **evaluate**
 * (observe/score it) → **administer** (accounts, personas, platform).
 */
export type StaffRouteGroup = 'conduct' | 'plan' | 'evaluate' | 'administer'

/** Launcher section order (lifecycle order, not alphabetical). */
export const STAFF_ROUTE_GROUP_ORDER: readonly StaffRouteGroup[] = [
  'plan',
  'conduct',
  'evaluate',
  'administer',
]

/** Human labels for the launcher sections. */
export const STAFF_ROUTE_GROUP_LABELS: Readonly<Record<StaffRouteGroup, string>> = {
  plan: 'Plan',
  conduct: 'Conduct',
  evaluate: 'Evaluate',
  administer: 'Administer',
}

/**
 * Every staff route lives under this prefix. It is NOT a route of its own: a
 * bare `/staff` is an unknown staff path and resolves through the same
 * default-surface fallback as any other (see `resolveDefaultStaffRoute`).
 */
export const STAFF_ROOT_PATH = '/staff'

/**
 * ONE staff surface, declared once. This is the extensibility seam: every one
 * of the ~40 planned staff surfaces becomes exactly one of these.
 */
export interface StaffRouteEntry {
  /** Stable machine id — telemetry, focus keys, launcher keys. Never displayed. */
  readonly id: string
  /**
   * The absolute, deep-linkable path (e.g. `/staff/console`). Must start with
   * {@link STAFF_ROOT_PATH} so the participant world can never collide with it,
   * and must not collide with the pre-auth `/staff/login` route (which the root
   * router matches first). Both are asserted by the registry's own test.
   */
  readonly path: string
  /** What a human calls this surface — launcher item AND the focus-scope label. */
  readonly label: string
  /** FontAwesome only (D0 / CLAUDE.md); never `@mui/icons-material`. */
  readonly icon: IconDefinition
  /** The route composition to render. Owned by the surface's own feature. */
  readonly element: ReactNode
  /**
   * The single source of truth for who may reach this surface — used by BOTH
   * the route tree (an unauthorized path redirects to the role's default
   * surface, it never renders) and, later, launcher visibility.
   */
  readonly allowedRoles: readonly StaffSurfaceRole[]
  /** Which launcher section this surface belongs to. */
  readonly group: StaffRouteGroup
  /**
   * Roles that LAND here by default — the destination for a bare `/staff`, for
   * an unknown staff path, and for a path this role may not open. Must be a
   * subset of {@link allowedRoles}; at most one entry per role (asserted by the
   * registry's test). Omitted on a surface that is nobody's home page.
   */
  readonly isDefaultFor?: readonly StaffSurfaceRole[]
  /** One line of launcher copy. Optional; no routing meaning. */
  readonly description?: string
}

/** The registry itself: an ordered, read-only table of staff surfaces. */
export type StaffRouteRegistry = readonly StaffRouteEntry[]

/** True when `role` may open this surface (`allowedRoles` is the only gate). */
export function isStaffRouteAllowed(entry: StaffRouteEntry, role: StaffSurfaceRole): boolean {
  return entry.allowedRoles.includes(role)
}

/** Every surface `role` may open, in registry order (routing + launcher). */
export function staffRoutesForRole(
  registry: StaffRouteRegistry,
  role: StaffSurfaceRole,
): StaffRouteEntry[] {
  return registry.filter(entry => isStaffRouteAllowed(entry, role))
}

/**
 * The role's default surface — where a bare `/staff`, an unknown staff path, or
 * a path this role may not open lands.
 *
 * Resolution order:
 *  1. the first entry that declares `isDefaultFor: [role]` AND allows the role
 *     (an `isDefaultFor` that is not also `allowedRoles` is a declaration bug,
 *     caught by the registry test — it is ignored here rather than trusted);
 *  2. otherwise the first entry the role is allowed to open at all, so a newly
 *     added role always has SOMEWHERE to land;
 *  3. otherwise `undefined` — the role has no built surface, and the caller
 *     fails closed to the login entry (unchanged pre-existing behaviour).
 */
export function resolveDefaultStaffRoute(
  registry: StaffRouteRegistry,
  role: StaffSurfaceRole,
): StaffRouteEntry | undefined {
  const declared = registry.find(
    entry => entry.isDefaultFor?.includes(role) === true && isStaffRouteAllowed(entry, role),
  )
  return declared ?? staffRoutesForRole(registry, role)[0]
}

/**
 * Converts an absolute registry path to the form a DESCENDANT `<Routes>` needs.
 *
 * The staff tree is mounted inside the root `*` catch-all, whose `pathnameBase`
 * is `/`, so descendant routes are matched relative to the app root: the entry
 * `/staff/console` is registered as `staff/console`. Keeping this a named,
 * exported function (rather than an inline `slice(1)`) makes the assumption
 * testable and the failure mode — a silently non-matching route — impossible to
 * introduce by accident.
 */
export function toDescendantRoutePath(path: string): string {
  return path.startsWith('/') ? path.slice(1) : path
}
