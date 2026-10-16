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
 * ## The other places an exercise's name shows (rename only)
 *  - The exercise SWITCHER lists the caller's assignments by name
 *    (`['staff', 'assignments']`), so a rename invalidates that query too.
 *  - The staff HEADER shows the ACTIVE exercise's name from the exercise scope
 *    (`ExerciseContextProvider`, not React Query). When the renamed exercise IS
 *    the active one, the scope is re-resolved from the server (its refresh takes
 *    no arguments: the server, not this hook, says what the scope is). A refresh
 *    failure is the provider's own fail-closed path; it is not re-thrown here.
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
 * switcher's assignments re-read, and the scope re-resolves when the renamed
 * exercise is the active one (the header's name). See the module header.
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

/** Archives one completed exercise (takes its id); the list re-reads on success or a stale row. */
export function useArchiveExercise(): UseMutationResult<OrgExercise, OrgExerciseError, string> {
  const queryClient = useQueryClient()

  return useMutation<OrgExercise, OrgExerciseError, string>({
    mutationFn: exerciseId => archiveOrgExercise(exerciseId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ORG_EXERCISES_QUERY_KEY })
    },
    onError: error => invalidateOnStaleRow(queryClient, error),
  })
}
