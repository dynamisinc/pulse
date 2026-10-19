/**
 * features/staff/hooks/useActiveExerciseInternalName.ts
 * ---------------------------------------------------------------------------
 * The INTERNAL (planner-facing) name of the exercise the staff console is
 * showing, for STAFF-world labels (identity badge, EndEx dialog).
 *
 * Why this exists (exercise-build-golive story 09): the frozen exercise scope's
 * `exerciseName` is now the PARTICIPANT-facing name and may be null. Staff must
 * never be confused about which exercise they are in, so staff labels read the
 * internal `Name` from the staff assignments (`StaffAssignmentDto.exerciseName`,
 * which stays on the internal name) matched to the scope's `exerciseId`.
 *
 * Returns `null` until the assignments resolve (or if the active exercise is not
 * among them). Callers render nothing in that case; they must NEVER fall back to
 * the scope's participant name.
 *
 * World: STAFF. Pure data hook.
 */

import { useExerciseContext } from '@/core/exerciseContext'
import { useStaffAssignments } from './useStaffAssignments'
import type { Enrollment } from '../types'

/** Pure selector: the internal name of `exerciseId` among `assignments`, or null. */
export function selectInternalName(
  assignments: readonly Enrollment[] | undefined,
  exerciseId: string,
): string | null {
  const match = assignments?.find(a => a.exerciseId.toLowerCase() === exerciseId.toLowerCase())
  return match?.exerciseName ?? null
}

export function useActiveExerciseInternalName(): string | null {
  const { exerciseId } = useExerciseContext()
  const query = useStaffAssignments()
  return selectInternalName(query.data, exerciseId)
}
