/**
 * features/exerciseLifecycleAdmin/hooks/useCreateExercise.ts
 * ---------------------------------------------------------------------------
 * React Query 5 mutation wrapper around org-tier exercise creation (feature:
 * exercise-lifecycle-admin, story 01 — COR-074).
 *
 * A mutation, not a query: creation is an explicit, staff-triggered write that
 * must never auto-fire, refetch or dedupe.
 *
 * ## Why it INVALIDATES rather than pushing the new row into the cache
 * The 201 body carries the created exercise, so writing it straight into the
 * list cache with `setQueryData` would render one fewer round trip. It would
 * also make the list a CLIENT-ASSEMBLED view of the organization's portfolio,
 * which is exactly the shape this wave keeps finding bugs in ("the control
 * asserts a state the server never applied"). The server owns which exercises
 * the caller's tenant has; after a create we ask it again. That also keeps the
 * mock and the live path honest — the mock store really appends the row, so a
 * refetch proves the write happened rather than proving the client remembered
 * what it sent.
 *
 * ## No client telemetry here (deliberate)
 * Story 01's telemetry AC is closed SERVER-side: the creation endpoint emits
 * exactly one audit event attributed to the acting staff human, inside the same
 * unit of work as the write (`Create_EmitsExactlyOneAuditEvent_...`). A second,
 * client-side emit would double-count the action and could report a creation
 * that the server refused.
 *
 * World: STAFF. Pure data hook — no UI, no COBRA.
 */

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { createOrgExercise, type OrgExerciseError } from '../services/orgExercisesService'
import type { CreateExerciseInput, CreateExerciseResult } from '../types'
import { ORG_EXERCISES_QUERY_KEY } from './useOrgExercises'

/**
 * Creates an exercise under the caller's own organization.
 * `mutate(input)` / `mutateAsync(input)` run the create; the result exposes
 * `isPending` / `isSuccess` / `data` (the new exercise + the creator's minted
 * assignment role) / `isError` / `error` for the form to render against.
 *
 * On success the org exercise list is invalidated, so the list below the form
 * re-reads from the server and shows the new run in `build`.
 */
export function useCreateExercise(): UseMutationResult<
  CreateExerciseResult,
  OrgExerciseError,
  CreateExerciseInput
> {
  const queryClient = useQueryClient()

  return useMutation<CreateExerciseResult, OrgExerciseError, CreateExerciseInput>({
    mutationFn: createOrgExercise,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ORG_EXERCISES_QUERY_KEY })
    },
  })
}
