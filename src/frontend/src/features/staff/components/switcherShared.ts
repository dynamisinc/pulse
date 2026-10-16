/**
 * features/staff/components/switcherShared.ts
 * ---------------------------------------------------------------------------
 * Pure helpers shared by every staff exercise-switching UI: the standalone
 * `ExerciseSwitcher` panel and the staff header's identity-badge menu
 * (`features/staffShell/components/ExerciseIdentityBadge.tsx`). Extracted so the
 * two can never drift on how an active exercise is matched or how a failed
 * switch is worded. STAFF world only; no React, no I/O.
 */
import type { StaffAssignmentError } from '../services/staffAssignmentsService'

/** Maps a thrown assignment-seam error to clear, status-aware staff-facing copy. */
export function friendlyErrorMessage(error: StaffAssignmentError, fallback: string): string {
  switch (error.status) {
    case 401:
      return 'Your staff session is not active. Sign in to the console and try again.'
    case 403:
      return 'You are not assigned to that exercise.'
    case 400:
      return error.serverMessage
        ? `That exercise could not be selected: ${error.serverMessage}`
        : 'That exercise could not be selected.'
    default:
      return error.status === undefined
        ? 'Could not reach the server. Check your connection and try again.'
        : (error.serverMessage ?? fallback)
  }
}

/**
 * Compares two exercise ids for identity, CASE-INSENSITIVELY. Exercise ids are
 * opaque GUID strings that the API has historically emitted in mixed casing
 * (SQL Server uppercase vs .NET lowercase); comparing case-insensitively is a
 * defensive backstop so the active exercise is never mis-marked as switchable.
 */
export function sameExercise(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}
