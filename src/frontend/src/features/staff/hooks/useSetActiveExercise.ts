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
 * World: STAFF. Pure data hook — no UI, no COBRA.
 */

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { useExerciseScopeRefresh } from '@/core/exerciseContext'
import { setActiveExercise, StaffAssignmentError } from '../services/staffAssignmentsService'
import type { StaffAssignment } from '../types'

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
  StaffAssignment,
  StaffAssignmentError,
  string
> {
  const queryClient = useQueryClient()
  const refreshExerciseScope = useExerciseScopeRefresh()

  return useMutation<StaffAssignment, StaffAssignmentError, string>({
    mutationFn: setActiveExercise,
    onSuccess: async () => {
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
        // (WR-007) — this error is for the machine, not for the human.
        queryClient.removeQueries()
        throw new StaffAssignmentError(
          'Your active exercise was switched, but your session scope could not be re-resolved. '
          + 'Reload the console to continue.',
          { cause: error },
        )
      }

      // 3. The new scope is on the context. Discard the prior exercise's data
      //    and refetch the active queries under the new scope.
      await queryClient.resetQueries()
    },
  })
}
