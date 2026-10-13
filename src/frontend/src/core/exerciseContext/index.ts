/**
 * core/exerciseContext — public barrel.
 *
 * The Wave-0 mock exercise-context seam (COR-001, COR-004; story
 * exercise-isolation/10). Foldered because story 04 EXTENDS it (host/auth
 * resolution + a participant route guard), so it grows past one file.
 *
 * Consumers import from `@/core/exerciseContext`. Note (see `ExerciseScope`):
 * `exerciseId` is a display/telemetry-stamping field, NOT a query-scoping param
 * — query isolation is enforced server-side.
 *
 * `useExerciseScopeRefresh` (staff-navigation/04, COR-073) is the provider's
 * server-authoritative re-resolution seam — a zero-argument "ask the server
 * again", NOT an exercise selector. See `exerciseContext.tsx`'s RE-RESOLUTION
 * section before calling it.
 */
export {
  ExerciseContextProvider,
  useExerciseContext,
  useExerciseScopeRefresh,
} from './exerciseContext'
export type { ExerciseContextProviderProps, ExerciseScopeRefresh } from './exerciseContext'
export type { ExerciseScope, ExerciseStatus } from './exerciseContextResolver'
export {
  resolveExerciseContext,
  // The fail-closed status guard + its vocabulary. Exported so a surface that
  // renders a lifecycle status off ANOTHER endpoint (e.g. the org exercise
  // list, COR-075) checks the literal against the same transitional superset
  // this resolver accepts, instead of coining a second, narrower list that
  // would disagree on a split deploy.
  isExerciseStatus,
  EXERCISE_STATUSES,
} from './exerciseContextResolver'
