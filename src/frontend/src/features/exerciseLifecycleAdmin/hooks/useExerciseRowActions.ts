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
 * No client telemetry: `exercise.renamed` / `exercise.archived` are emitted
 * server-side in the same unit of work as the write.
 *
 * World: STAFF. Pure data hooks: no UI, no COBRA.
 */

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import {
  archiveOrgExercise,
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

/** Renames one of the organization's exercises; the list re-reads on success. */
export function useRenameExercise(): UseMutationResult<
  OrgExercise,
  OrgExerciseError,
  RenameExerciseInput
> {
  const queryClient = useQueryClient()

  return useMutation<OrgExercise, OrgExerciseError, RenameExerciseInput>({
    mutationFn: ({ exerciseId, name }) => renameOrgExercise(exerciseId, name),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ORG_EXERCISES_QUERY_KEY })
    },
  })
}

/** Archives one completed exercise (takes its id); the list re-reads on success. */
export function useArchiveExercise(): UseMutationResult<OrgExercise, OrgExerciseError, string> {
  const queryClient = useQueryClient()

  return useMutation<OrgExercise, OrgExerciseError, string>({
    mutationFn: exerciseId => archiveOrgExercise(exerciseId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ORG_EXERCISES_QUERY_KEY })
    },
  })
}
