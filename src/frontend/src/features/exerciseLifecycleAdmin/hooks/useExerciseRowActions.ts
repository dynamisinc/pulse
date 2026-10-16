/**
 * features/exerciseLifecycleAdmin/hooks/useExerciseRowActions.ts
 * ---------------------------------------------------------------------------
 * React Query 5 mutations behind the org exercise table's row actions
 * (demo-feedback story 22, DF-35): RENAME and ARCHIVE.
 *
 * Both INVALIDATE the org exercise list on success rather than writing the
 * returned row into the cache, for the same reason `useCreateExercise` does: the
 * server owns the organization's portfolio, so after a write the list asks it
 * again (and the stateful mock proves the write happened).
 *
 * ## The other places an exercise's name and status show
 *  - The exercise SWITCHER lists the caller's assignments by name and status
 *    (`['staff', 'assignments']`), so a rename AND an archive invalidate that
 *    query too.
 *  - The staff HEADER shows the ACTIVE exercise's name and status pill from the
 *    exercise scope (`ExerciseContextProvider`, not React Query, which re-reads
 *    only when asked). When the renamed or archived exercise IS the active one,
 *    the scope is re-resolved from the server (its refresh takes no arguments:
 *    the server, not this hook, says what the scope is), so the header stops
 *    saying the old name, or ENDEX for an exercise the table calls Archived. A
 *    refresh failure is the provider's own fail-closed path; it is not
 *    re-thrown here.
 *  - The planner's SETTINGS block (`EXERCISE_SETTINGS_QUERY_KEY`) is the active
 *    exercise's, and its save is a FULL REPLACE that sends `name` back. A cached
 *    block from before a rename would show the old name and, on an unrelated
 *    save, silently write it back over the rename. So renaming the ACTIVE
 *    exercise re-reads that block now (`refetchType: 'all'`: the panel is
 *    normally unmounted while this page is open, and a plain invalidate would
 *    leave the old name on screen until a remount's refetch landed). Renaming
 *    any OTHER exercise cannot reach it: the block is always the active
 *    exercise's, and switching exercise resets the whole cache
 *    (`useSetActiveExercise`).
 *
 * ## A 404 or 409 means the list is stale
 * Another tab (or person) renamed, archived or removed the exercise, so the row
 * this dialog was opened from no longer matches the server. Both error paths
 * re-read the org list as well, so the table catches up while the dialog says
 * what happened.
 *
 * No client telemetry: `exercise.renamed` / `exercise.archived` are emitted
 * server-side in the same unit of work as the write.
 *
 * World: STAFF. Pure data hooks: no UI, no COBRA.
 */

import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from '@tanstack/react-query'
import { useExerciseContext, useExerciseScopeRefresh } from '@/core/exerciseContext'
import { EXERCISE_SETTINGS_QUERY_KEY } from '@/features/planner/hooks/useExerciseSettings'
import { STAFF_ASSIGNMENTS_QUERY_KEY } from '@/features/staff/hooks/useStaffAssignments'
import {
  archiveOrgExercise,
  isExerciseNotFoundError,
  isNotCompletedError,
  renameOrgExercise,
  type OrgExerciseError,
} from '../services/orgExercisesService'
import type { OrgExercise } from '../types'
import { ORG_EXERCISES_QUERY_KEY } from './useOrgExercises'

/** What the rename mutation takes. */
export interface RenameExerciseInput {
  readonly exerciseId: string
  readonly name: string
}

/** Re-reads the org list when the server says the row was stale (404 or 409). */
async function invalidateOnStaleRow(queryClient: QueryClient, error: OrgExerciseError) {
  if (isExerciseNotFoundError(error) || isNotCompletedError(error)) {
    await queryClient.invalidateQueries({ queryKey: ORG_EXERCISES_QUERY_KEY })
  }
}

/**
 * Renames one of the organization's exercises. On success the org list and the
 * switcher's assignments re-read; when the renamed exercise is the active one,
 * its settings block re-reads and the scope re-resolves (the header's name).
 * See the module header.
 */
export function useRenameExercise(): UseMutationResult<
  OrgExercise,
  OrgExerciseError,
  RenameExerciseInput
> {
  const queryClient = useQueryClient()
  const { exerciseId: activeExerciseId } = useExerciseContext()
  const refreshScope = useExerciseScopeRefresh()

  return useMutation<OrgExercise, OrgExerciseError, RenameExerciseInput>({
    mutationFn: ({ exerciseId, name }) => renameOrgExercise(exerciseId, name),
    onSuccess: async (_renamed, { exerciseId }) => {
      const isActive = exerciseId === activeExerciseId
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ORG_EXERCISES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: STAFF_ASSIGNMENTS_QUERY_KEY }),
        // The settings save is a full replace: a cached pre-rename block would write
        // the old name back. Re-read it even while the panel is unmounted.
        ...(isActive
          ? [queryClient.invalidateQueries({
            queryKey: EXERCISE_SETTINGS_QUERY_KEY,
            refetchType: 'all',
          })]
          : []),
      ])
      if (isActive) {
        // The provider handles (and fails closed on) its own refresh failure.
        await refreshScope().catch(() => undefined)
      }
    },
    onError: error => invalidateOnStaleRow(queryClient, error),
  })
}

/**
 * Archives one completed exercise (takes its id). On success the org list and the
 * switcher's assignments re-read, and the scope re-resolves when the archived
 * exercise is the active one (the header's status pill). The list also re-reads
 * on a stale row. See the module header.
 */
export function useArchiveExercise(): UseMutationResult<OrgExercise, OrgExerciseError, string> {
  const queryClient = useQueryClient()
  const { exerciseId: activeExerciseId } = useExerciseContext()
  const refreshScope = useExerciseScopeRefresh()

  return useMutation<OrgExercise, OrgExerciseError, string>({
    mutationFn: exerciseId => archiveOrgExercise(exerciseId),
    onSuccess: async (_archived, exerciseId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ORG_EXERCISES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: STAFF_ASSIGNMENTS_QUERY_KEY }),
      ])
      if (exerciseId === activeExerciseId) {
        // The provider handles (and fails closed on) its own refresh failure.
        await refreshScope().catch(() => undefined)
      }
    },
    onError: error => invalidateOnStaleRow(queryClient, error),
  })
}
