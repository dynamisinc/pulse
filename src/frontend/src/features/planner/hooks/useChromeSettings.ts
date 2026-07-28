/**
 * features/planner/hooks/useChromeSettings.ts
 * ---------------------------------------------------------------------------
 * React Query 5 wrappers around the COR-031 compliance-chrome config seam
 * (feature: exercise-configuration, story 02; issue #41 / story #68).
 *
 * Two hooks, deliberately split:
 *
 *  - `useChromeSettings()` — a QUERY. The chrome block is a cacheable read the
 *    editor loads on mount.
 *  - `useSaveChromeSettings()` — a MUTATION. A chrome write is an explicit,
 *    planner-triggered FULL REPLACE that must never auto-fire, refetch or
 *    dedupe.
 *
 * THE QUERY KEY CARRIES NO EXERCISE ID, on purpose. The endpoint takes no
 * exercise parameter — the scope is server-resolved (COR-001) — and the shipped
 * staff exercise switcher (`features/staff/hooks/useSetActiveExercise.ts`)
 * already `invalidateQueries()`s the whole cache when the active exercise
 * changes, so switching exercises re-fetches this config rather than serving the
 * previous exercise's chrome. `core/auth/endSession.ts` clears the same client
 * on logout, so no config survives into a different user's session.
 *
 * ON SUCCESS THE MUTATION SEEDS THE QUERY CACHE WITH THE SERVER'S RESPONSE
 * (`setQueryData`) rather than invalidating. `PUT` returns the freshly
 * re-projected config — sanitized banner text — and that response, not the
 * submitted form state, is the truth about what was stored. It deliberately does
 * NOT also `invalidateQueries`: the write already returned the authoritative
 * projection, so a follow-up GET would be a redundant round trip whose only
 * distinctive outcome is a race.
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
  getChromeSettings,
  updateChromeSettings,
  type ChromeSettings,
  type ChromeSettingsError,
  type ChromeSettingsUpdate,
} from '../services/chromeSettingsService'

/**
 * The query key the chrome read uses. Exported so any staff surface can target
 * or invalidate exactly this data.
 */
export const CHROME_SETTINGS_QUERY_KEY = ['staff', 'chrome-settings'] as const

/**
 * Loads the resolved exercise's compliance-chrome config. Exposes the standard
 * React Query `isPending` / `isSuccess` / `data` / `isError` / `error` state the
 * panel renders against.
 */
export function useChromeSettings(): UseQueryResult<ChromeSettings, ChromeSettingsError> {
  return useQuery<ChromeSettings, ChromeSettingsError>({
    queryKey: CHROME_SETTINGS_QUERY_KEY,
    queryFn: getChromeSettings,
  })
}

/**
 * Full-replaces the resolved exercise's compliance-chrome block.
 *
 * `mutate(update)` / `mutateAsync(update)` run the write. On success the
 * server's re-projected config is written straight into
 * `CHROME_SETTINGS_QUERY_KEY`, so every consumer of `useChromeSettings()`
 * immediately re-renders from the RESPONSE.
 */
export function useSaveChromeSettings(): UseMutationResult<
  ChromeSettings,
  ChromeSettingsError,
  ChromeSettingsUpdate
> {
  const queryClient = useQueryClient()

  return useMutation<ChromeSettings, ChromeSettingsError, ChromeSettingsUpdate>({
    mutationFn: updateChromeSettings,
    onSuccess: saved => {
      queryClient.setQueryData(CHROME_SETTINGS_QUERY_KEY, saved)
    },
  })
}
