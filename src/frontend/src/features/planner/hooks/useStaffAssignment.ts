/**
 * features/planner/hooks/useStaffAssignment.ts
 * ---------------------------------------------------------------------------
 * React Query seam for the planner Staff section (story 20, #575a). One list query keyed by the
 * exercise, four mutations. EVERY successful mutation invalidates the list (refetch from the
 * server); there are no optimistic updates, so the table always shows what the server holds.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  changeStaffRole,
  getStaffRoster,
  grantStaffRole,
  makeStaffLead,
  removeStaff,
  StaffAssignmentError,
} from '../services/staffAssignmentService'
import type { StaffRole, StaffRoster } from '../types/staff'

export const staffRosterKey = (exerciseId: string) => ['staff', 'enrollments', exerciseId] as const

export function useStaffRoster(exerciseId: string) {
  return useQuery<StaffRoster, StaffAssignmentError>({
    queryKey: staffRosterKey(exerciseId),
    queryFn: () => getStaffRoster(exerciseId),
    enabled: exerciseId !== '',
  })
}

/** The four write operations, each refetching the list on success. */
export function useStaffMutations(exerciseId: string) {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: staffRosterKey(exerciseId) })
  const opts = { onSuccess: refresh }
  return {
    refresh,
    grant: useMutation<void, StaffAssignmentError, { personId: string; role: StaffRole }>({
      mutationFn: v => grantStaffRole(exerciseId, v.personId, v.role),
      ...opts,
    }),
    changeRole: useMutation<void, StaffAssignmentError, { id: string; role: StaffRole }>({
      mutationFn: v => changeStaffRole(v.id, v.role),
      ...opts,
    }),
    remove: useMutation<void, StaffAssignmentError, { id: string }>({
      mutationFn: v => removeStaff(v.id),
      ...opts,
    }),
    makeLead: useMutation<void, StaffAssignmentError, { id: string }>({
      mutationFn: v => makeStaffLead(v.id),
      ...opts,
    }),
  }
}
