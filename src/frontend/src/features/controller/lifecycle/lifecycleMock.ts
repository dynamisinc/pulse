/**
 * features/controller/lifecycle/lifecycleMock.ts
 * ---------------------------------------------------------------------------
 * The MOCK-DATA stand-in for the lifecycle endpoints (demo-polish C6): under
 * `USE_MOCK_DATA` (`npm run dev`, the backend-less UAT) there is no server, so the console
 * simulates the state machine locally and the demo is still demonstrable end to end.
 * STAFF world -- pure functions, no UI.
 *
 * WHERE THE MOCK STATE LIVES. Not in a second store: the mock exercise's state IS its scope's
 * `status` (`core/exerciseContext`), the same value the staff header's state pill renders.
 * `mockLifecycleFor(status)` derives the lifecycle from it; {@link simulateTransition} changes
 * it through `setMockExerciseStatus`, and the hook then re-resolves the scope
 * (`useExerciseScopeRefresh`) exactly as it does against a real server -- so the pill follows a
 * simulated StartEx / EndEx by the SAME path it follows a real one, with no mock-only branch in
 * the UI. A reload resets it (the mock scope starts `live`), like every other mock here.
 *
 * THE MACHINE is the backend's `ExerciseLifecycleStates` table, copied: a simulated refusal is
 * the same 409 with the same sentence the server sends, so the error path is demonstrable too.
 */

import { setMockExerciseStatus, type ExerciseStatus } from '@/core/exerciseContext'
import {
  LifecycleError,
  type ExerciseLifecycle,
  type LifecycleState,
  type LifecycleTarget,
} from './lifecycleService'

/** The allowed transitions, keyed by state -- the backend table, verbatim. */
const ALLOWED: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  build: ['staged'],
  staged: ['live'],
  live: ['paused', 'completed'],
  paused: ['live', 'completed'],
  completed: ['archived'],
  archived: [],
}

/** Folds the legacy status literals onto their COR-032 equivalents (the backend's `TryParse`). */
export function canonicalLifecycleState(status: ExerciseStatus): LifecycleState {
  switch (status) {
    case 'scheduled':
      return 'build'
    case 'active':
      return 'live'
    case 'complete':
      return 'completed'
    default:
      return status
  }
}

/** The lifecycle the mock reports for a scope whose status is `status`. */
export function mockLifecycleFor(status: ExerciseStatus): ExerciseLifecycle {
  const state = canonicalLifecycleState(status)
  return { state, allowedTransitions: ALLOWED[state] }
}

/**
 * Simulates `POST .../transition` from `status` to `to`: refuses with the server's own 409
 * sentence when the machine has no such edge, otherwise moves the mock scope's status (see the
 * module header) and returns the lifecycle of the new state.
 */
export function simulateTransition(status: ExerciseStatus, to: LifecycleTarget): ExerciseLifecycle {
  const from = canonicalLifecycleState(status)
  const allowed = ALLOWED[from]
  if (!allowed.includes(to)) {
    const allowedText = allowed.length === 0
      ? `'${from}' is a terminal state`
      : `allowed from '${from}': ${allowed.join(', ')}`
    throw new LifecycleError(
      `'${from}' -> '${to}' is not an allowed lifecycle transition (${allowedText}).`,
      409,
    )
  }
  setMockExerciseStatus(to)
  return mockLifecycleFor(to)
}
