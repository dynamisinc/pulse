/**
 * features/planner/hooks/useExerciseSettings.ts
 * ---------------------------------------------------------------------------
 * React Query 5 wrappers around the COR-030 per-exercise settings seam
 * (feature: exercise-configuration, story 01b; issue #41 / story #67).
 *
 * Two hooks, deliberately split:
 *
 *  - `useExerciseSettings()` — a QUERY. The settings block is a cacheable read
 *    the editor loads on mount.
 *  - `useSaveExerciseSettings()` — a MUTATION. A settings write is an explicit,
 *    planner-triggered FULL REPLACE that must never auto-fire, refetch or
 *    dedupe.
 *
 * THE QUERY KEY CARRIES NO EXERCISE ID, on purpose. The endpoint takes no
 * exercise parameter — the scope is server-resolved (COR-001) — and the shipped
 * staff exercise switcher (`features/staff/hooks/useSetActiveExercise.ts`)
 * already `invalidateQueries()`s the WHOLE cache when the active exercise
 * changes, so switching exercises re-fetches these settings rather than serving
 * the previous exercise's block. `core/auth/endSession.ts` clears the same
 * client on logout, so no settings survive into a different user's session.
 *
 * ON SUCCESS THE MUTATION SEEDS THE QUERY CACHE WITH THE SERVER'S RESPONSE
 * (`setQueryData`) rather than invalidating. `PUT` returns the freshly
 * re-projected settings — sanitized free text, canonicalized channel ids,
 * round-trip-formatted instants — and that response, not the submitted form
 * state, is the truth about what was stored. Seeding the cache is what makes the
 * editor re-render from the RESPONSE.
 *
 * It deliberately does NOT also `invalidateQueries`: the write already returned
 * the authoritative projection, so a follow-up GET would be a redundant round
 * trip whose only distinctive outcome is a race — its (older) response landing
 * after the write's and flipping the freshly-saved fields back under the
 * planner's cursor.
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
  getExerciseSettings,
  updateExerciseSettings,
  type ExerciseSettings,
  type ExerciseSettingsError,
  type ExerciseSettingsUpdate,
} from '../services/exerciseSettingsService'

/**
 * The query key the settings read uses. Exported so any staff surface can
 * target or invalidate exactly this data.
 */
export const EXERCISE_SETTINGS_QUERY_KEY = ['staff', 'exercise-settings'] as const

/**
 * Loads the resolved exercise's COR-030 settings. Exposes the standard React
 * Query `isPending` / `isSuccess` / `data` / `isError` / `error` state the panel
 * renders against.
 */
export function useExerciseSettings(): UseQueryResult<ExerciseSettings, ExerciseSettingsError> {
  return useQuery<ExerciseSettings, ExerciseSettingsError>({
    queryKey: EXERCISE_SETTINGS_QUERY_KEY,
    queryFn: getExerciseSettings,
  })
}

/**
 * Full-replaces the resolved exercise's settings block.
 *
 * `mutate(update)` / `mutateAsync(update)` run the write. On success the
 * server's re-projected settings are written straight into
 * `EXERCISE_SETTINGS_QUERY_KEY`, so every consumer of `useExerciseSettings()`
 * immediately re-renders from the RESPONSE.
 */
export function useSaveExerciseSettings(): UseMutationResult<
  ExerciseSettings,
  ExerciseSettingsError,
  ExerciseSettingsUpdate
> {
  const queryClient = useQueryClient()

  return useMutation<ExerciseSettings, ExerciseSettingsError, ExerciseSettingsUpdate>({
    mutationFn: updateExerciseSettings,
    onSuccess: saved => {
      queryClient.setQueryData(EXERCISE_SETTINGS_QUERY_KEY, saved)
    },
  })
}
