/**
 * features/controller/report/hooks/useExerciseReport.ts
 * ---------------------------------------------------------------------------
 * React Query seam for the exercise report (story 17). One query per `includeNoise` value, so
 * ticking "Include background noise" refetches with `includeNoise=true` (the previous list stays
 * on screen while it loads). `retry: false`: a 401/404/413 will not fix itself, and the page
 * shows the reason. A report is a snapshot, so it is not refetched on focus.
 */

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { fetchExerciseReport } from '../services/reportService'

export const EXERCISE_REPORT_QUERY_KEY = 'exercise-report'

export function useExerciseReport(includeNoise: boolean) {
  return useQuery({
    queryKey: [EXERCISE_REPORT_QUERY_KEY, includeNoise],
    queryFn: () => fetchExerciseReport(includeNoise),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 0,
    placeholderData: keepPreviousData,
  })
}
