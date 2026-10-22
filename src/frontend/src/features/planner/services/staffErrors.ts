/**
 * features/planner/services/staffErrors.ts
 * ---------------------------------------------------------------------------
 * Maps a failed staff-assignment call to the plain-language message the Staff section shows
 * (story 20 reality check). Pure. A 404 means the person/role is gone and the caller should also
 * refetch (see {@link needsRefetch}).
 */
import { StaffAssignmentError } from './staffAssignmentService'

const BY_CODE: Readonly<Record<string, string>> = {
  'last-planner': 'An exercise must keep at least one planner.',
  'conflicting-enrollment': 'That person already has a role in this exercise.',
  'lead-changed-retry': 'The lead changed while you were working. Refresh and try again.',
  'lead-conflict': 'The lead changed while you were working. Refresh and try again.',
  'not-a-controller': 'Only a controller can be the lead.',
}

/** The words for `error`; generic fallback for anything unmapped. */
export function staffErrorMessage(error: unknown): string {
  if (error instanceof StaffAssignmentError) {
    const mapped = error.code === undefined ? undefined : BY_CODE[error.code]
    if (mapped !== undefined) return mapped
    if (error.status === 404) return 'That person or role no longer exists here.'
    if (error.status === 403) return 'You do not have permission to change this exercise’s staff.'
  }
  return 'The change could not be saved. Try again.'
}

/** Whether the list is probably stale after this failure. */
export function needsRefetch(error: unknown): boolean {
  return error instanceof StaffAssignmentError
    && (error.status === 404 || error.status === 409)
}
