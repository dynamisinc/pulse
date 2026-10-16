/**
 * features/controller/report/hooks/useExerciseReport.ts
 * ---------------------------------------------------------------------------
 * React Query seam for the exercise report (story 29). One query per filter set (sources and
 * time window are in the key), so changing a filter refetches (the previous list stays on screen
 * while it loads). `retry: false`: a 400/401/404/413 will not fix itself, and the page
 * shows the reason. A report is a snapshot, so it is not refetched on focus.
 */

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { orderedSources } from '../services/reportFilters'
import { fetchExerciseReport } from '../services/reportService'
import type { ReportFilters } from '../types/report'

export const EXERCISE_REPORT_QUERY_KEY = 'exercise-report'

export function useExerciseReport(filters: ReportFilters) {
  return useQuery({
    queryKey: [
      EXERCISE_REPORT_QUERY_KEY,
      orderedSources(filters.sources).join(','),
      filters.from,
      filters.to,
    ],
    queryFn: () => fetchExerciseReport(filters),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 0,
    placeholderData: keepPreviousData,
  })
}
