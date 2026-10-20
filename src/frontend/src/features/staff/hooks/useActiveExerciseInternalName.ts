/**
 * features/staff/hooks/useActiveExerciseInternalName.ts
 * ---------------------------------------------------------------------------
 * The INTERNAL (planner-facing) name of the exercise the staff console is
 * showing, for STAFF-world labels (identity badge, EndEx dialog, Stage dialog).
 *
 * Why this exists (exercise-build-golive story 09): the frozen exercise scope's
 * `exerciseName` is now the PARTICIPANT-facing name and may be null. Staff must
 * never be confused about which exercise they are in, so staff labels read the
 * internal `Name` from the staff assignments (`StaffAssignmentDto.exerciseName`,
 * which stays on the internal name) matched to the scope's `exerciseId`.
 *
 * The last name resolved for the CURRENT exercise id is kept while the
 * assignments refetch (an exercise switch resets the query) or a refetch fails,
 * so an irreversible confirm (EndEx) keeps naming its target. It is dropped the
 * moment the exercise id changes, so another exercise's name is never shown.
 *
 * Returns `null` until a name has resolved for this exercise (or if the active
 * exercise is not among the assignments). Callers render generic copy in that
 * case; they must NEVER fall back to the scope's participant name.
 *
 * World: STAFF. Pure data hook.
 */

import { useState } from 'react'
import { useExerciseContext } from '@/core/exerciseContext'
import { sameExercise } from '../components/switcherShared'
import { useStaffAssignments } from './useStaffAssignments'
import type { Enrollment } from '../types'

/** Pure selector: the internal name of `exerciseId` among `assignments`, or null. */
export function selectInternalName(
  assignments: readonly Enrollment[] | undefined,
  exerciseId: string,
): string | null {
  const match = assignments?.find(a => sameExercise(a.exerciseId, exerciseId))
  return match?.exerciseName ?? null
}

export function useActiveExerciseInternalName(): string | null {
  const { exerciseId } = useExerciseContext()
  const query = useStaffAssignments()
  const [kept, setKept] = useState<{ exerciseId: string; name: string } | null>(null)

  const resolved = selectInternalName(query.data, exerciseId)
  // React's "store information from previous renders" pattern: remember the last name resolved
  // for this exercise so a refetch (or a failed one) does not blank an irreversible confirm.
  if (resolved !== null && (kept?.exerciseId !== exerciseId || kept.name !== resolved)) {
    setKept({ exerciseId, name: resolved })
  }
  if (resolved !== null) return resolved
  return kept !== null && sameExercise(kept.exerciseId, exerciseId) ? kept.name : null
}
