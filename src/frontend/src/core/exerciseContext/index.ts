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
 */
export { ExerciseContextProvider, useExerciseContext } from './exerciseContext'
export type { ExerciseContextProviderProps } from './exerciseContext'
export type { ExerciseScope, ExerciseStatus } from './exerciseContextResolver'
export { resolveExerciseContext } from './exerciseContextResolver'
