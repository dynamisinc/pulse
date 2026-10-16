/**
 * features/exerciseLifecycleAdmin/components/exerciseRowStatus.ts
 * ---------------------------------------------------------------------------
 * The status rules behind the org exercise table's row actions (demo-feedback
 * story 22, DF-35). Pure functions, kept out of the component files so React
 * Fast Refresh keeps working there.
 *
 *  - Archive is offered from COMPLETED only (`completed`, or its legacy
 *    `complete` alias): the COR-032 edge `completed → archived`.
 *  - Archived rows sort LAST, as a stable partition of the server's order.
 */

import type { OrgExercise } from '../types'

/** True for the canonical `completed` literal and its legacy `complete` alias. */
export function isCompletedStatus(status: string): boolean {
  return status === 'completed' || status === 'complete'
}

/** True for an archived exercise. */
export function isArchivedStatus(status: string): boolean {
  return status === 'archived'
}

/**
 * Archived exercises last, everything else in server order. A stable partition
 * rather than a re-sort, so the server's name order holds in each group.
 */
export function sortArchivedLast(exercises: readonly OrgExercise[]): OrgExercise[] {
  return [
    ...exercises.filter(exercise => !isArchivedStatus(exercise.status)),
    ...exercises.filter(exercise => isArchivedStatus(exercise.status)),
  ]
}
