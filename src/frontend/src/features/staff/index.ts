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
 * This feature owns the component + its hooks + its service, never the route
 * table (`App.tsx`).
 */

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
