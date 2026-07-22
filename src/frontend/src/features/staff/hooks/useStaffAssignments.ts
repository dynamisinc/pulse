/**
 * features/staff/hooks/useStaffAssignments.ts
 * ---------------------------------------------------------------------------
 * React Query 5 query wrapper around the staff assignments read seam
 * (feature: exercise-isolation, story 05 — staff cross-exercise switcher;
 * COR-005).
 *
 * A query (not a mutation): the assignment list is a straightforward,
 * cacheable read the switcher lists on mount. `STAFF_ASSIGNMENTS_QUERY_KEY` is
 * exported so `useSetActiveExercise`'s success handler (or any other staff
 * surface) can target/invalidate exactly this data.
 *
 * World: STAFF. Pure data hook — no UI, no COBRA.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { getStaffAssignments, type StaffAssignmentError } from '../services/staffAssignmentsService'
import type { StaffAssignment } from '../types'

/** The query key this hook uses. */
export const STAFF_ASSIGNMENTS_QUERY_KEY = ['staff', 'assignments'] as const

/**
 * Lists the authenticated staff user's own exercise assignments. Exposes the
 * standard React Query `isPending` / `isSuccess` / `data` / `isError` /
 * `error` state the switcher renders against.
 */
export function useStaffAssignments(): UseQueryResult<StaffAssignment[], StaffAssignmentError> {
  return useQuery<StaffAssignment[], StaffAssignmentError>({
    queryKey: STAFF_ASSIGNMENTS_QUERY_KEY,
    queryFn: getStaffAssignments,
  })
}
