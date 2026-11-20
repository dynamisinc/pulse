/**
 * features/staff/hooks/useSetActiveExercise.ts
 * ---------------------------------------------------------------------------
 * React Query 5 mutation wrapper around the staff active-exercise switch seam
 * (feature: exercise-isolation, story 05 — staff cross-exercise switcher;
 * COR-005 — extended by staff-navigation/04 — exercise-switcher context
 * refresh; COR-073).
 *
 * A mutation (not a query) because switching is an explicit, staff-triggered
 * write that must NOT auto-fire, refetch, or dedupe.
 *
 * ## The scope transition this hook owns (staff-navigation/04, COR-073)
 * A successful `POST /api/staff/active-exercise` moves the session's scope
 * SERVER-SIDE. Two client-side things must then catch up, and the ORDER between
 * them is the whole correctness argument:
 *
 *   - the RESOLVED SCOPE behind `useExerciseContext()` (exercise name/id/time
 *     zone/status — what the staff header's identity badge renders);
 *   - the REACT QUERY CACHE (every staff surface's data, all of it fetched
 *     under the PRIOR exercise).
 *
 * Get the order wrong and a staff member sees a MIXED FRAME — the surest way to
 * misread which exercise you are operating. Two distinct failures are possible
 * and this hook forbids both:
 *
 *   (a) NEW-exercise data under the OLD scope label — what a bare
 *       `invalidateQueries()` produces: refetches land under the switched
 *       server scope while the provider still reports the previous exercise.
 *   (b) OLD-exercise data under the NEW scope label — what a bare scope
 *       refresh produces: React Query keeps serving the previous exercise's
 *       CACHED rows (stale-while-revalidate) beneath the new exercise's name.
 *
 * ### The ordering guarantee: cancel → re-resolve → commit → reset
 *  1. `cancelQueries()` — abort every in-flight query. Those requests were
 *     issued under the PRIOR scope but would be answered by a server that has
 *     ALREADY switched; letting one land is failure (a).
 *  2. `refreshExerciseScope()` — ask the SERVER what the session's scope now
 *     is (`useExerciseScopeRefresh`, `core/exerciseContext`). The client never
 *     asserts the new exercise, not even though it just POSTed the id: the
 *     switch and the scope read are two separate server truths, and only the
 *     second one is authoritative for what we render. The provider commits the
 *     answer in a SINGLE state update with no intervening unmount.
 *  3. `resetQueries()` — only now discard every cached query (back to
 *     `pending`, no data) and refetch the active ones. Because the reset runs
 *     in the microtask immediately after the commit — before React's scheduled
 *     render — no frame is ever painted with prior-exercise data beneath the
 *     new scope: failure (b) closed.
 *
 * `reset`, not `invalidate`: invalidation keeps serving the previous
 * exercise's data while refetching. On a scope change that data is not stale,
 * it is FOREIGN. It must disappear, not fade.
 *
 * Broad and unfiltered (no key filter) on purpose: a switch re-scopes EVERY
 * staff query server-side (COR-001, built on exercise-isolation/01), and this
 * hook has no visibility into which staff query keys exist across the console
 * today or will exist as more staff surfaces land. (A narrower, namespaced
 * reset can replace this once the console's staff query keys settle into a
 * shared namespace.)
 *
 * ### Fail-closed
 * The switch succeeded but the scope could not be re-resolved? Then we do NOT
 * know what exercise the session is in, so we refuse to keep rendering the old
 * one as if we did: the provider has already gone closed, the now-foreign cache
 * is dropped outright, and the mutation surfaces an error. This handler runs
 * INSIDE the mutation (React Query awaits a hook-level `onSuccess`), so
 * `isPending` stays true across the whole transition and `isSuccess` means
 * "switched AND re-scoped", never just "POST returned 200".
 *
 * WHO SHOWS THAT ERROR (WR-007). Not this hook's caller: the provider going
 * closed unmounts the entire staff tree, INCLUDING the switcher that called
 * `mutate()`, so no `onError` render path here can survive to display anything.
 * The recovery surface is therefore the provider's own world-neutral
 * "Session unavailable — Reload" notice (`core/exerciseContext`), which replaces
 * the unmounted tree. The thrown `StaffAssignmentError` below is still the right
 * thing to throw — it settles `mutateAsync` for any programmatic awaiter and is
 * the record in logs/telemetry — but it is NOT the user-facing message; treat it
 * as the machine's copy of an event the human is already being told about.
 *
 * ### The hub connection (#856)
 * The shared SignalR connection belongs to ONE principal for its life, and a switch changes it
 * server-side (which also cuts the old connection; SignalR's own auto-reconnect would rejoin as
 * the NEW exercise before the console has committed its scope, and the hub refuses long-poll/SSE
 * requests whose user changed). So the hook owns the transition:
 *   - BEFORE the POST: `stop('scope-changed')` - the old exercise's frames stop at once and
 *     nothing can deliver the new exercise's frames early;
 *   - POST fails DEFINITELY (a 4xx: the server answered and did not switch): `resume()` - the
 *     session is still on the old scope, so reconnect on it. An AMBIGUOUS failure (timeout,
 *     network error, 5xx: the switch may have landed) asks the SERVER what the scope is: B ->
 *     the full commit below; A -> `resume()`; the re-resolve fails -> stay stopped;
 *   - scope re-resolved and committed: run the exercise-scope resets of the module stores that
 *     hold exercise data outside React Query, then `resume()` on the current token;
 *   - scope re-resolve FAILS: the hub stays stopped (fail closed, like the provider itself).
 *
 * OVERLAPPING SWITCHES. Switches are SERIALIZED (a second POST waits for the first, so the
 * server's final scope is the last one asked for), and only the LATEST switch resets the stores
 * and resumes the hub: a stale switch finishing while a newer one is queued must not restart
 * the hub (the newer one would only stop it again, on the wrong scope in between).
 *
 * World: STAFF. Pure data hook — no UI, no COBRA.
 */

import { useEffect, useRef } from 'react'
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { useExerciseContext, useExerciseScopeRefresh } from '@/core/exerciseContext'
import { realtimeConnection } from '@/core/realtime/connection'
import { runExerciseScopeResets } from '@/core/auth/sessionReset'
import { setActiveExercise, StaffAssignmentError } from '../services/staffAssignmentsService'
import type { Enrollment } from '../types'

/** How long the switch POST may take before it is treated as an AMBIGUOUS failure. */
export const SWITCH_POST_TIMEOUT_MS = 15_000

/** Delay before the one re-read of the scope after an ambiguous failure, before failing closed. */
export const SCOPE_REREAD_RETRY_MS = 2_000

/** Counts switches as they are asked for; only the latest may reset the stores / resume the hub. */
let latestSwitch = 0

/** Switch tail: the next switch's POST waits for the previous switch to finish. */
let switchQueue: Promise<unknown> = Promise.resolve()

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = switchQueue.then(task, task)
  switchQueue = run.catch(() => undefined)
  return run
}

/** Test-only: forgets the generation counter and the queue between tests. */
export function resetSetActiveExerciseForTests(): void {
  latestSwitch = 0
  switchQueue = Promise.resolve()
}

/** Rejects (ambiguously: no status) if `promise` has not settled within `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new StaffAssignmentError('The exercise switch request timed out.')),
      ms,
    )
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * True only when the server ANSWERED with a client error: the switch was refused, so the
 * session is still on the old exercise. Anything else (no response, a timeout, a 5xx) is
 * ambiguous: the switch may have landed.
 */
function isDefiniteRefusal(error: unknown): boolean {
  if (!(error instanceof StaffAssignmentError)) return false
  const status = error.status
  return status !== undefined && status >= 400 && status < 500 && status !== 408
}

/**
 * Switches the caller's active exercise. `mutate(exerciseId)` /
 * `mutateAsync(exerciseId)` run the switch; the returned result exposes
 * `isPending` / `isSuccess` / `data` (the newly-active assignment) /
 * `isError` / `error` for the switcher to render against.
 *
 * Requires an `<ExerciseContextProvider>` ancestor — the scope it re-resolves
 * on success. See the module header for the ordering guarantee.
 */
export function useSetActiveExercise(): UseMutationResult<
  Enrollment,
  StaffAssignmentError,
  string
> {
  const queryClient = useQueryClient()
  const refreshExerciseScope = useExerciseScopeRefresh()
  // The exercise the provider currently holds. A ref (updated after each commit), not this
  // render's closure: an overlapping earlier switch may have committed a different exercise.
  const currentExerciseId = useExerciseContext().exerciseId
  const heldExerciseIdRef = useRef(currentExerciseId)
  useEffect(() => {
    heldExerciseIdRef.current = currentExerciseId
  }, [currentExerciseId])

  /**
   * A changed scope is committed: ALWAYS reset the module stores (a stale switch's commit must
   * not leave them holding the old exercise if the latest switch then fails), but only the
   * LATEST switch starts the hub.
   */
  const commitScope = (generation: number): void => {
    runExerciseScopeResets()
    if (generation === latestSwitch) void realtimeConnection.resume()
  }

  /** The POST failed. Decide, from what the server says, which scope the hub resumes on. */
  const recoverFromFailedPost = async (error: unknown, generation: number): Promise<void> => {
    if (isDefiniteRefusal(error)) {
      if (generation === latestSwitch) void realtimeConnection.resume()
      return
    }
    // Ambiguous: the switch may have landed. Ask the server; the client never guesses.
    try {
      await queryClient.cancelQueries()
      const scope = await refreshExerciseScope({ retryOnceAfterMs: SCOPE_REREAD_RETRY_MS })
      if (scope.exerciseId !== heldExerciseIdRef.current) {
        // It landed after all: this is a full switch.
        commitScope(generation)
        await queryClient.resetQueries()
      } else if (generation === latestSwitch) {
        void realtimeConnection.resume()
      }
    } catch {
      // The scope is unknown: the provider has failed closed. The hub stays stopped.
      queryClient.removeQueries()
    }
  }

  return useMutation<Enrollment, StaffAssignmentError, string>({
    // The whole transition runs INSIDE the mutation, so `isPending` stays true across it and
    // `isSuccess` means "switched AND re-scoped", never just "POST returned 200".
    mutationFn: async (exerciseId: string) => {
      const generation = ++latestSwitch
      // Old exercise's frames stop NOW, before the server switches (see the header).
      void realtimeConnection.stop('scope-changed')
      return serialize(async () => {
        let enrollment: Enrollment
        try {
          enrollment = await withTimeout(setActiveExercise(exerciseId), SWITCH_POST_TIMEOUT_MS)
        } catch (error) {
          await recoverFromFailedPost(error, generation)
          throw error
        }

        // 1. Nothing issued under the prior scope may still be in flight — the
        //    server has already switched, so its answer would be new-exercise
        //    data arriving under the old scope.
        await queryClient.cancelQueries()

        // 2. Ask the SERVER what the scope now is; the provider commits it
        //    atomically (no remount, no intervening unresolved state).
        try {
          await refreshExerciseScope()
        } catch (error) {
          // The switch landed but the new scope is unknown. Everything cached
          // belongs to an exercise this session has left: drop it rather than
          // leave it reachable. The provider has already failed closed and is
          // rendering its own recovery notice in place of this whole tree
          // (WR-007) — this error is for the machine, not for the human. The
          // hub stays stopped (fail closed).
          queryClient.removeQueries()
          throw new StaffAssignmentError(
            'Your active exercise was switched, but your session scope could not be re-resolved. '
            + 'Reload the console to continue.',
            { cause: error },
          )
        }

        // 2b. The new scope is committed: reset the module stores, start the hub (#856).
        commitScope(generation)

        // 3. The new scope is on the context. Discard the prior exercise's data
        //    and refetch the active queries under the new scope.
        await queryClient.resetQueries()
        return enrollment
      })
    },
  })
}
