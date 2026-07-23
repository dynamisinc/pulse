/**
 * features/app-shell — public barrel.
 *
 * The role-aware global nav (feature: app-shell, story 01; COR-004/COR-005).
 * The orchestrator imports `createRoleAwareRoutes` to wire the route table into
 * `App.tsx` (the orchestrator-owned integration seam). `RoleAwareEntry` + its
 * props type are exported for direct composition/tests.
 *
 * World: routing glue — world-neutral (COBRA only at the staff hand-off inside
 * `RoleAwareEntry`, brand skin only inside the injected participant surface).
 */

export { RoleAwareEntry } from './RoleAwareEntry'
export type { RoleAwareEntryProps, StaffSurfaceRole } from './RoleAwareEntry'
export { createRoleAwareRoutes } from './routes'
export { LOGIN_PATH, STAFF_LOGIN_PATH } from './constants'
