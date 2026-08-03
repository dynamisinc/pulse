/**
 * features/staff/index.ts
 * ---------------------------------------------------------------------------
 * Public surface of the STAFF-world staff feature (feature:
 * exercise-isolation, story 05 — staff cross-exercise switcher; COR-005).
 *
 * `app-shell/01` imports `ExerciseSwitcher` from here to mount it into a
 * pre-conduct staff route:
 *
 *   import { ExerciseSwitcher } from '@/features/staff'
 *
 * This feature owns the component + its hooks + its service.
 *
 * It ALSO owns `STAFF_ROUTE_REGISTRY` — the one declared table of staff
 * surfaces, which `App.tsx` injects into `RoleAwareEntry`. The registry lives in
 * the STAFF world (it names concrete COBRA surfaces); its typed SHAPE and the
 * pure resolvers over it live in the world-neutral routing glue
 * (`@/features/app-shell/staffRouting`). Adding a staff surface means adding one
 * entry there — see that file's header.
 */

export { STAFF_ROUTE_REGISTRY } from './staffRouteRegistry'
export type { StaffRouteId } from './staffRouteRegistry'
export { ExerciseSwitcher } from './components/ExerciseSwitcher'
export { ExerciseSwitcherSlot } from './components/ExerciseSwitcherSlot'
export { useStaffAssignments, STAFF_ASSIGNMENTS_QUERY_KEY } from './hooks/useStaffAssignments'
export { useSetActiveExercise } from './hooks/useSetActiveExercise'
export {
  getStaffAssignments,
  setActiveExercise,
  StaffAssignmentError,
} from './services/staffAssignmentsService'
export type { StaffAssignmentErrorInit } from './services/staffAssignmentsService'
export type { StaffAssignment } from './types'
