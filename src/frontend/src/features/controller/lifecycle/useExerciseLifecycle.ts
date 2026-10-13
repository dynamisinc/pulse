/**
 * features/controller/lifecycle/useExerciseLifecycle.ts
 * ---------------------------------------------------------------------------
 * The state machine behind the console's **Start exercise** / **End exercise** control
 * (demo-polish C6, docs/features/demo-polish/23-preview-and-startex.md; exercise-configuration/03
 * COR-032; CTL-033, NFR-001). STAFF world -- a hook with no UI, kept apart from the control so
 * the transition logic is testable without a render of the dialog.
 *
 * WHAT IT READS. The resolved exercise's lifecycle `state` and the `allowedTransitions` from it
 * (`GET /api/staff/exercise-lifecycle`, `lifecycleService`). The control offers Start when `live`
 * is allowed and End when `completed` is -- the SERVER's table decides, so the console never
 * drifts from the state machine. Under MOCK DATA the same shape is derived from the exercise
 * scope's own `status` (`lifecycleMock`), which is also what the header pill renders.
 *
 * WHAT IT DOES. `transition(to)` calls `POST .../transition { to }` (or simulates it under mock
 * data) and, on success, does the two things that make the console agree with the server:
 *   1. it writes the response (the NEW state and its allowed transitions) into the cache the
 *      control reads, so the buttons change at once; and
 *   2. it RE-RESOLVES the exercise scope (`useExerciseScopeRefresh`). The staff header's state
 *      pill reads `status` from the exercise context (`StaffHeader`), not from this hook, so
 *      refreshing the scope is how the pill reflects the new state (LIVE -> ENDEX) with no
 *      remount. That refresh is server-authoritative and takes no argument -- this hook cannot
 *      tell the scope what the status now is, it only asks again.
 * A FAILED transition changes nothing on screen except an error message: the server persists
 * nothing on any non-200, so there is no rollback to do. A 409 (the machine refused -- another
 * controller got there first, or the state moved) also re-reads the lifecycle so the buttons
 * stop offering what is no longer possible.
 *
 * ONE IN FLIGHT. A second `transition` while one is pending is ignored (a ref guard, because two
 * activations in the same tick both see `idle`): StartEx and EndEx must never race each other.
 *
 * TELEMETRY. None from the client, deliberately: the SERVER records one lifecycle-transition
 * event per applied transition (`ExerciseLifecycleService`, `exercise.lifecycle_transitioned`,
 * with the acting staff member) -- unlike the takedown (DP-9), where the server emits none.
 * A second event from here would double-count the audit trail. Under mock data nothing is
 * recorded at all, like every simulated action.
 *
 * ERRORS are plain text (`LifecycleError.message`): `loadError` when the state cannot be read,
 * `transitionError` when a change was refused or failed. Never colour, never a status code alone.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { useExerciseContext, useExerciseScopeRefresh } from '@/core/exerciseContext'
import {
  fetchLifecycle,
  postTransition,
  toLifecycleError,
  type ExerciseLifecycle,
  type LifecycleState,
  type LifecycleTarget,
} from './lifecycleService'
import { mockLifecycleFor, simulateTransition } from './lifecycleMock'

/** Where the lifecycle read is cached, per exercise (an exercise switch is a different key). */
export function lifecycleQueryKey(exerciseId: string): readonly unknown[] {
  return ['controller', 'exercise-lifecycle', exerciseId]
}

/** Whether the lifecycle could be read: `loading` -> `ready` | `error`. */
export type LifecycleLoadPhase = 'loading' | 'ready' | 'error'

export interface UseExerciseLifecycleResult {
  /** The canonical state, once read; `undefined` while loading or when it could not be read. */
  readonly state: LifecycleState | undefined
  /** The states reachable from `state`; empty until it is known. */
  readonly allowedTransitions: readonly LifecycleState[]
  readonly loadPhase: LifecycleLoadPhase
  /** Plain-text reason the state could not be read; `undefined` otherwise. */
  readonly loadError: string | undefined
  /** `live` is reachable from here: the control offers **Start exercise**. */
  readonly canStart: boolean
  /** `completed` is reachable from here: the control offers **End exercise**. */
  readonly canEnd: boolean
  /** The transition in flight, if any. */
  readonly pending: LifecycleTarget | undefined
  /** Plain-text reason the last transition was refused or failed; cleared by the next attempt. */
  readonly transitionError: string | undefined
  /** The last transition that SUCCEEDED in this mount (the control confirms it in text). */
  readonly lastTransition: LifecycleTarget | undefined
  /**
   * Requests `to`. Resolves `true` when the server applied it, `false` when it was refused or
   * failed (see `transitionError`) or was ignored because another is in flight. Never rejects.
   */
  transition(to: LifecycleTarget): Promise<boolean>
  /** Re-reads the lifecycle (the **Retry** after a failed read). */
  reload(): void
  /** Clears `transitionError`. */
  clearError(): void
}

/** Reads and drives the resolved exercise's lifecycle. See the module header. */
export function useExerciseLifecycle(): UseExerciseLifecycleResult {
  const { exerciseId, status } = useExerciseContext()
  const refreshScope = useExerciseScopeRefresh()
  const queryClient = useQueryClient()
  const key = useMemo(() => lifecycleQueryKey(exerciseId), [exerciseId])

  // LIVE: the server's answer, cached per exercise. MOCK: derived from the scope's status
  // below, so no request is made at all.
  const query = useQuery({
    queryKey: key,
    queryFn: fetchLifecycle,
    enabled: !USE_MOCK_DATA,
    // A lifecycle read is only trusted while it is fresh: the buttons are decisions.
    staleTime: 0,
  })

  const [lastTransition, setLastTransition] = useState<LifecycleTarget | undefined>(undefined)
  const inFlightRef = useRef(false)

  const {
    mutateAsync,
    reset: clearError,
    isPending,
    isError,
    error: mutationError,
    variables,
  } = useMutation<ExerciseLifecycle, Error, LifecycleTarget>({
    mutationFn: async to => {
      try {
        return USE_MOCK_DATA ? simulateTransition(status, to) : await postTransition(to)
      } catch (error) {
        throw toLifecycleError(error)
      }
    },
  })

  const transition = useCallback(async (to: LifecycleTarget): Promise<boolean> => {
    if (inFlightRef.current) return false
    inFlightRef.current = true
    try {
      const next = await mutateAsync(to)
      setLastTransition(to)
      // 1. The buttons follow the response at once (live; mock derives from the scope below).
      queryClient.setQueryData(key, next)
      // 2. The header pill follows the re-resolved scope. A refresh that fails has already failed
      //    the provider closed (and unmounted this control); there is nothing to add here.
      await refreshScope().catch(() => undefined)
      return true
    } catch {
      // The error is on the mutation (`transitionError`). A refusal (409) means our view of
      // the state was stale: re-read it so the control stops offering what is no longer possible.
      if (!USE_MOCK_DATA) void queryClient.invalidateQueries({ queryKey: key })
      return false
    } finally {
      inFlightRef.current = false
    }
  }, [mutateAsync, queryClient, refreshScope, key])

  const lifecycle: ExerciseLifecycle | undefined = USE_MOCK_DATA
    ? mockLifecycleFor(status)
    : query.data

  const loadPhase: LifecycleLoadPhase = lifecycle !== undefined
    ? 'ready'
    : query.isError ? 'error' : 'loading'
  const loadError = lifecycle === undefined && query.isError
    ? toLifecycleError(query.error).message
    : undefined

  const allowedTransitions = lifecycle?.allowedTransitions ?? []
  const pending = isPending ? variables : undefined

  const reload = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: key })
  }, [queryClient, key])

  return {
    state: lifecycle?.state,
    allowedTransitions,
    loadPhase,
    loadError,
    canStart: allowedTransitions.includes('live'),
    canEnd: allowedTransitions.includes('completed'),
    pending,
    transitionError: isError ? toLifecycleError(mutationError).message : undefined,
    lastTransition,
    transition,
    reload,
    clearError,
  }
}
