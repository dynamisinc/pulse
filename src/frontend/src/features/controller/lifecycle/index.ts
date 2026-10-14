/**
 * features/controller/lifecycle — public barrel (demo-polish C6; staff world).
 *
 * The StartEx / EndEx control for the controller console and the hook behind it. The
 * ORCHESTRATOR mounts `ExerciseLifecycleControl` in `ControllerConsoleRoute.tsx` (by path, as
 * every controller directory is: implementation.md §4.2); this barrel exists for that import and
 * for tests, not for general use.
 */

export { ExerciseLifecycleControl } from './ExerciseLifecycleControl'
export { useExerciseLifecycle, lifecycleQueryKey } from './useExerciseLifecycle'
export type { UseExerciseLifecycleResult, LifecycleLoadPhase } from './useExerciseLifecycle'
export type { ExerciseLifecycle, LifecycleState, LifecycleTarget } from './lifecycleService'
