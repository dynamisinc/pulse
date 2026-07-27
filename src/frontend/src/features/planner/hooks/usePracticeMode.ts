/**
 * features/planner/hooks/usePracticeMode.ts
 * ---------------------------------------------------------------------------
 * React Query 5 wrappers around the COR-033 practice/sandbox seam (feature:
 * exercise-configuration, story 04; issue #41 / story #70).
 *
 * Two hooks, deliberately split:
 *
 *  - `usePracticeMode()` — a QUERY. The flag is a cacheable read the panel loads
 *    on mount.
 *  - `useSetPracticeMode()` — a MUTATION. Flagging (or un-flagging) an exercise
 *    is an explicit, planner-triggered decision that must never auto-fire,
 *    refetch or dedupe.
 *
 * THE QUERY KEY CARRIES NO EXERCISE ID, on purpose. The endpoint takes no
 * exercise parameter — the scope is server-resolved (COR-001) — and the shipped
 * staff exercise switcher (`features/staff/hooks/useSetActiveExercise.ts`)
 * already `invalidateQueries()`s the WHOLE cache when the active exercise
 * changes, so switching exercises re-fetches this flag rather than showing the
 * previous exercise's. `core/auth/endSession.ts` clears the same client on
 * logout, so no practice state survives into a different user's session.
 *
 * ON SUCCESS THE MUTATION SEEDS THE QUERY CACHE WITH THE SERVER'S RESPONSE
 * (`setQueryData`) rather than invalidating. The `PUT` returns the re-projected
 * state — including `evaluationEligible`, which only the server's eligibility
 * seam can answer — and that response, not the local checkbox, is the truth. It
 * deliberately does not also `invalidateQueries`: the write already returned the
 * authoritative state, so a follow-up GET would be a redundant round trip whose
 * only distinctive outcome is a race.
 *
 * World: STAFF. Pure data hooks — no UI, no COBRA.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import {
  getPracticeMode,
  setPracticeMode,
  type PracticeModeError,
  type PracticeModeState,
  type PracticeModeUpdate,
} from '../services/practiceModeService'

/**
 * The query key the practice-mode read uses. Exported so any staff surface can
 * target or invalidate exactly this data.
 */
export const PRACTICE_MODE_QUERY_KEY = ['staff', 'practice-mode'] as const

/**
 * Loads the resolved exercise's practice/sandbox state. Exposes the standard
 * React Query `isPending` / `isSuccess` / `data` / `isError` / `error` state the
 * panel renders against.
 */
export function usePracticeMode(): UseQueryResult<PracticeModeState, PracticeModeError> {
  return useQuery<PracticeModeState, PracticeModeError>({
    queryKey: PRACTICE_MODE_QUERY_KEY,
    queryFn: getPracticeMode,
  })
}

/**
 * Sets or clears the resolved exercise's practice/sandbox flag.
 *
 * `mutate(update)` / `mutateAsync(update)` run the write. On success the
 * server's re-projected state is written straight into
 * `PRACTICE_MODE_QUERY_KEY`, so every consumer of `usePracticeMode()`
 * immediately re-renders from the RESPONSE.
 */
export function useSetPracticeMode(): UseMutationResult<
  PracticeModeState,
  PracticeModeError,
  PracticeModeUpdate
> {
  const queryClient = useQueryClient()

  return useMutation<PracticeModeState, PracticeModeError, PracticeModeUpdate>({
    mutationFn: setPracticeMode,
    onSuccess: saved => {
      queryClient.setQueryData(PRACTICE_MODE_QUERY_KEY, saved)
    },
  })
}
