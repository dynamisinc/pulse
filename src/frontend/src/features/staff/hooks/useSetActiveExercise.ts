/**
 * features/staff/hooks/useSetActiveExercise.ts
 * ---------------------------------------------------------------------------
 * React Query 5 mutation wrapper around the staff active-exercise switch seam
 * (feature: exercise-isolation, story 05 — staff cross-exercise switcher;
 * COR-005).
 *
 * A mutation (not a query) because switching is an explicit, staff-triggered
 * write that must NOT auto-fire, refetch, or dedupe. On success it
 * invalidates the ENTIRE React Query cache (no key filter): the switch
 * re-scopes every staff query SERVER-SIDE (COR-001, built on
 * exercise-isolation/01), and this feature has no visibility into which other
 * staff query keys exist across the console today or will exist once more
 * staff surfaces land — a broad invalidation is the only way to guarantee
 * every one of them re-fetches under the newly active exercise rather than
 * silently continuing to render the PRIOR scope's cached data. (A narrower,
 * namespaced invalidation can replace this once the console's staff query
 * keys settle into a shared namespace.)
 *
 * World: STAFF. Pure data hook — no UI, no COBRA.
 */

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { setActiveExercise, type StaffAssignmentError } from '../services/staffAssignmentsService'
import type { StaffAssignment } from '../types'

/**
 * Switches the caller's active exercise. `mutate(exerciseId)` /
 * `mutateAsync(exerciseId)` run the switch; the returned result exposes
 * `isPending` / `isSuccess` / `data` (the newly-active assignment) /
 * `isError` / `error` for the switcher to render against.
 */
export function useSetActiveExercise(): UseMutationResult<
  StaffAssignment,
  StaffAssignmentError,
  string
> {
  const queryClient = useQueryClient()

  return useMutation<StaffAssignment, StaffAssignmentError, string>({
    mutationFn: setActiveExercise,
    onSuccess: () => {
      // Broad, unfiltered invalidation — see module header for why.
      void queryClient.invalidateQueries()
    },
  })
}
