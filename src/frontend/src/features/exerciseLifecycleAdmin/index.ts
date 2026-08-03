/**
 * features/exerciseLifecycleAdmin — public barrel.
 *
 * The ORG-TIER exercise administration feature (E1 exercise-lifecycle-admin,
 * stories 01/02/03 — COR-074 creation, COR-075 list, COR-076 the org-admin
 * surface family). STAFF world throughout: COBRA, desktop-first, never
 * confusable with a participant view (XC-002).
 *
 * `@/features/staff/staffRouteRegistry` imports `ExerciseManagementRoute` from
 * here — one registry entry, no other wiring. Everything else exported is for
 * tests and for the later stories that will compose this surface's parts.
 */

export { ExerciseManagementRoute } from './ExerciseManagementRoute'
export { ExerciseManagementPage } from './pages/ExerciseManagementPage'
export { CreateExerciseForm } from './components/CreateExerciseForm'
export { OrgExerciseTable } from './components/OrgExerciseTable'
export { ExerciseStatusBadge } from './components/ExerciseStatusBadge'
export { useOrgExercises, ORG_EXERCISES_QUERY_KEY } from './hooks/useOrgExercises'
export { useCreateExercise } from './hooks/useCreateExercise'
export {
  getOrgExercises,
  createOrgExercise,
  isHostnameTakenError,
  resetOrgExerciseMocks,
  OrgExerciseError,
} from './services/orgExercisesService'
export type { OrgExerciseErrorInit } from './services/orgExercisesService'
export type { CreateExerciseInput, CreateExerciseResult, OrgExercise } from './types'
