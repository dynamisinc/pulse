/**
 * features/app-shell — public barrel.
 *
 * The role-aware global nav (feature: app-shell, story 01; COR-004/COR-005) and
 * the staff route registry CONTRACT that extends it (typed shape + pure
 * resolvers + the nested staff route tree). The orchestrator imports
 * `createRoleAwareRoutes` to wire the route table into `App.tsx` (the
 * orchestrator-owned integration seam) and injects the concrete registry from
 * `@/features/staff`. `RoleAwareEntry` + its props type are exported for direct
 * composition/tests.
 *
 * World: routing glue — world-neutral (COBRA only at the staff hand-off inside
 * `RoleAwareEntry`, brand skin only inside the injected participant surface).
 * Nothing exported here imports a surface or a theme.
 */

export { RoleAwareEntry } from './RoleAwareEntry'
export type { RoleAwareEntryProps } from './RoleAwareEntry'
export { createRoleAwareRoutes } from './routes'
export { LOGIN_PATH, STAFF_LOGIN_PATH } from './constants'
export { RouteFocusScope } from './RouteFocusScope'
export { StaffRouteTree } from './StaffRouteTree'
export type { StaffRouteTreeProps } from './StaffRouteTree'

// Carries {registry, role} from the staff route tree down to staff chrome
// rendered inside a surface (the launcher in `StaffHeader`), which cannot
// import the concrete registry without closing an import cycle.
export { StaffNavigationProvider, useStaffNavigation } from './staffNavigationContext'
export type { StaffNavigationScope } from './staffNavigationContext'

// The staff route registry contract — the seam every future staff surface is
// declared against. The concrete table lives in `@/features/staff`.
export {
  STAFF_ROOT_PATH,
  STAFF_SURFACE_ROLES,
  STAFF_ROUTE_GROUP_ORDER,
  STAFF_ROUTE_GROUP_LABELS,
  isStaffSurfaceRole,
  isStaffRouteAllowed,
  staffRoutesForRole,
  resolveDefaultStaffRoute,
  toDescendantRoutePath,
} from './staffRouting'
export type {
  StaffSurfaceRole,
  StaffRouteGroup,
  StaffRouteEntry,
  StaffRouteRegistry,
} from './staffRouting'
