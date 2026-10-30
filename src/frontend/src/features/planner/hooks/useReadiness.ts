/**
 * features/planner/hooks/useReadiness.ts
 * ---------------------------------------------------------------------------
 * React Query 5 wrapper around the go-live readiness seam (feature:
 * exercise-build-golive, story 03; COR-042).
 *
 * THE QUERY KEY CARRIES NO EXERCISE ID, on purpose (see
 * `EXERCISE_SETTINGS_QUERY_KEY`): scope is server-resolved (COR-001), and the
 * staff exercise switcher / `endSession` already clear the whole cache.
 *
 * LIVE AS BUILD PROGRESSES. Readiness is derived from state that other planner
 * saves change, so it is refetched on window focus, on the panel's Refresh
 * button, and invalidated by the settings, chrome, practice-mode and
 * account-import mutations (one `invalidateQueries({ queryKey:
 * READINESS_QUERY_KEY })` line in each hook's `onSuccess`).
 *
 * World: STAFF. Pure data hook - no UI.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import {
  getReadiness,
  type ExerciseReadiness,
  type ReadinessError,
} from '../services/readinessService'

/** The query key the readiness read uses. Exported so mutations can invalidate it. */
export const READINESS_QUERY_KEY = ['staff', 'readiness'] as const

/** Loads the resolved exercise's go-live readiness checklist. */
export function useReadiness(): UseQueryResult<ExerciseReadiness, ReadinessError> {
  return useQuery<ExerciseReadiness, ReadinessError>({
    queryKey: READINESS_QUERY_KEY,
    queryFn: getReadiness,
    // Always fresh: the shared client's 60 s staleTime would otherwise suppress
    // the focus/mount refetch after a planner fixes an item on another screen
    // (roster, run sheet) whose mutations do not invalidate this key.
    staleTime: 0,
    refetchOnWindowFocus: true,
  })
}
