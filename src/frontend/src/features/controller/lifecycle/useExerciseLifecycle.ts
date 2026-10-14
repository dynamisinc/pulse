/**
 * features/controller/lifecycle/useExerciseLifecycle.ts
 * ---------------------------------------------------------------------------
 * The state machine behind the console's **Start exercise** / **End exercise** control
 * (demo-polish C6, docs/features/demo-polish/23-preview-and-startex.md; exercise-configuration/03
 * COR-032; CTL-033, NFR-001). STAFF world -- a hook with no UI, kept apart from the control so
 * the transition logic is testable without a render of the dialog.
 *
 * WHAT IT READS. The resolved exercise's lifecycle `state` and the `allowedTransitions` from it
 * (`GET /api/staff/exercise-lifecycle`, `lifecycleService`). The control offers Start when the
 * exercise is STAGED and `live` is allowed, and End when `completed` is allowed -- the SERVER's
 * table decides what is reachable, so the console never drifts from the state machine. (`paused`
 * also allows `live`, but that is a RESUME, which is the world-steering tier control's job, not
 * a second "Start exercise" button.) Under MOCK DATA the same shape is derived from the exercise
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
 * A FAILED transition shows an error message and, when the failure is DEFINITIVE (400 / 401 /
 * 403 / 404: the server persisted nothing), nothing else -- there is no rollback to do. But
 * some failures leave the state UNKNOWN (`stateMayHaveChanged`): a 409 (the machine refused
 * because another controller got there first -- this console's view was stale) and a request
 * that got no status, a 408 or a 5xx (it may well have been APPLIED, only its answer lost). For
 * those it re-reads the lifecycle (the buttons show the truth, not a guess) AND re-resolves the
 * exercise scope (the header pill follows). If the re-read itself fails the server is
 * unreachable, and the scope is left alone: a failed scope refresh fails the whole provider
 * CLOSED and would take the console down over a network blip.
 *
 * THE RE-READ MAY SHOW THE REQUEST ALREADY DONE (Gate-2 W-1). If the re-read finds the exercise
 * AT the state that was asked for -- our own request was applied and only its answer was lost, or
 * another controller got there first and the machine answered 409 -- then "the state was not
 * changed" would be a lie next to a screen that says it was. That outcome is a SUCCESS: the error
 * is cleared, `lastTransition` is set with `lastTransitionAlreadyDone` (the control announces
 * "already ended", not "ended"), and `transition` resolves `true`. It is not a success when the
 * re-read shows any other state: then the reason stands and the buttons show the truth.
 *
 * THE SERVER'S EXERCISE MUST BE THE ONE SHOWN (Gate-2 S-3). The lifecycle answer echoes the
 * `exerciseId` the SERVER resolved. A second tab whose session switched the active exercise would
 * otherwise let this tab's buttons act on an exercise it is not displaying. When the echo is not
 * the console's exercise the hook offers NOTHING, says so (`loadPhase: 'error'`), and re-resolves
 * the scope so the console catches up. (A switch that happens between the read and the click
 * cannot be seen from here -- the transition body deliberately names no exercise, COR-001 -- which
 * is why the End dialog names the exercise it believes it is ending.)
 *
 * THE SAME CHECK GUARDS A SUCCESS. A transition's 200 answer echoes the `exerciseId` too, and a
 * switch that happened between the read and the click lands the change on the SESSION's exercise,
 * not the one on screen. When that echo is not the console's exercise the answer is not recorded
 * as a success: no `lastTransition` (so nothing is announced as started or ended, and an open End
 * dialog is not closed as a success), `transition` resolves `false`, and the answer goes into the
 * cache under the shown exercise's key -- exactly what a read of it would have done -- so the
 * control falls into the mismatch state above (nothing offered, "different exercise"), and the
 * scope is re-resolved so the console catches up. The words stay truthful (`transitionError`): the
 * request was applied to the session's exercise, it is NOT confirmed for the one on screen. They
 * live until the next attempt or `clearError`, so they survive the scope moving under them.
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { useExerciseContext, useExerciseScopeRefresh } from '@/core/exerciseContext'
import {
  fetchLifecycle,
  postTransition,
  sameExercise,
  stateMayHaveChanged,
  toLifecycleError,
  type ExerciseLifecycle,
  type LifecycleState,
  type LifecycleTarget,
} from './lifecycleService'
import { mockLifecycleFor, simulateTransition } from './lifecycleMock'

/** Shown when the server's lifecycle answer is for a different exercise than the console shows. */
const SCOPE_MISMATCH_MESSAGE =
  'The server is on a different exercise than this console shows, so nothing is offered. ' +
  'The console is refreshing; reload the page if this stays.'

/**
 * Shown when a transition SUCCEEDED but its answer is for a different exercise than the console
 * shows. It is the reason inside the control's own lead-ins ("The exercise state was not changed.",
 * "The exercise was not ended."), so it says where the change went and what is, and is not, known.
 */
const APPLIED_ELSEWHERE_MESSAGE =
  'The server applied your request to a different exercise than the one this console shows, ' +
  'so it is not confirmed for the one on screen. The console is refreshing; check the exercise ' +
  'it shows now before trying again.'

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
  /**
   * The exercise is STAGED and `live` is reachable: the control offers **Start exercise**.
   * Not merely "`live` is reachable" -- a paused exercise reaches `live` too, but that is a
   * resume (the world-steering tier control), not a start.
   */
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
   * `lastTransition` is a success the SERVER'S STATE proved rather than its answer: the request's
   * answer was lost or refused (409), and a re-read showed the exercise already at the target.
   * The control then announces "already ...", not "ended".
   */
  readonly lastTransitionAlreadyDone: boolean
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

  const [last, setLast] = useState<
    { readonly to: LifecycleTarget; readonly alreadyDone: boolean } | undefined
  >(undefined)
  // The last transition succeeded, but for the session's exercise rather than the one shown.
  const [appliedElsewhere, setAppliedElsewhere] = useState(false)
  const inFlightRef = useRef(false)

  const {
    mutateAsync,
    reset: resetMutation,
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

  const clearError = useCallback(() => {
    resetMutation()
    setAppliedElsewhere(false)
  }, [resetMutation])

  const transition = useCallback(async (to: LifecycleTarget): Promise<boolean> => {
    if (inFlightRef.current) return false
    inFlightRef.current = true
    setAppliedElsewhere(false) // a new attempt starts without the last one's notice
    try {
      const next = await mutateAsync(to)
      if (!sameExercise(next.exerciseId, exerciseId)) {
        // Applied, but to the session's exercise, not the one on screen: NOT a success here (see
        // the module header). Park the answer where a read of it would be, so the control's
        // existing mismatch state takes over, and let the console catch up.
        setAppliedElsewhere(true)
        queryClient.setQueryData(key, next)
        await refreshScope().catch(() => undefined)
        return false
      }
      setLast({ to, alreadyDone: false })
      // 1. The buttons follow the response at once (live; mock derives from the scope below).
      queryClient.setQueryData(key, next)
      // 2. The header pill follows the re-resolved scope. A refresh that fails has already failed
      //    the provider closed (and unmounted this control); there is nothing to add here.
      await refreshScope().catch(() => undefined)
      return true
    } catch (error) {
      // The error is on the mutation (`transitionError`). When the failure leaves the state
      // unknown (a 409, or no status / 408 / 5xx: the server may have applied it), ask the
      // server: re-read the lifecycle so the buttons show the truth, then re-resolve the scope
      // so the header pill follows. See the module header.
      if (stateMayHaveChanged(toLifecycleError(error).status)) {
        let current: ExerciseLifecycle
        if (USE_MOCK_DATA) {
          current = mockLifecycleFor(status)
        } else {
          try {
            current = await queryClient.fetchQuery({
              queryKey: key,
              queryFn: fetchLifecycle,
              staleTime: 0,
            })
          } catch {
            // Unreachable: leave the scope alone (a failed refresh would fail the provider closed).
            return false
          }
        }
        await refreshScope().catch(() => undefined)
        // The exercise is already where the request wanted it (our own request was applied and
        // only its answer lost, or another controller got there first): that is the OUTCOME the
        // controller asked for, so it is a success, not "the state was not changed".
        if (current.state === to && sameExercise(current.exerciseId, exerciseId)) {
          clearError()
          setLast({ to, alreadyDone: true })
          return true
        }
      }
      return false
    } finally {
      inFlightRef.current = false
    }
  }, [mutateAsync, queryClient, refreshScope, key, status, exerciseId, clearError])

  const answer: ExerciseLifecycle | undefined = USE_MOCK_DATA
    ? mockLifecycleFor(status)
    : query.data

  // The server answered for a DIFFERENT exercise than the one this console shows: offer nothing
  // and re-resolve the scope so the console catches up (see the module header).
  const scopeMismatch = answer !== undefined && !sameExercise(answer.exerciseId, exerciseId)
  const lifecycle: ExerciseLifecycle | undefined = scopeMismatch ? undefined : answer
  const dataUpdatedAt = query.dataUpdatedAt
  useEffect(() => {
    // Keyed on the answer's arrival, so a persistent mismatch asks once per read, never in a loop.
    if (scopeMismatch) void refreshScope().catch(() => undefined)
  }, [scopeMismatch, dataUpdatedAt, refreshScope])

  const loadPhase: LifecycleLoadPhase = scopeMismatch || (lifecycle === undefined && query.isError)
    ? 'error'
    : lifecycle !== undefined ? 'ready' : 'loading'
  const loadError = scopeMismatch
    ? SCOPE_MISMATCH_MESSAGE
    : lifecycle === undefined && query.isError
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
    canStart: lifecycle?.state === 'staged' && allowedTransitions.includes('live'),
    canEnd: allowedTransitions.includes('completed'),
    pending,
    transitionError: appliedElsewhere
      ? APPLIED_ELSEWHERE_MESSAGE
      : isError ? toLifecycleError(mutationError).message : undefined,
    lastTransition: last?.to,
    lastTransitionAlreadyDone: last?.alreadyDone ?? false,
    transition,
    reload,
    clearError,
  }
}
