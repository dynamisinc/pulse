/**
 * features/participantAdmin/hooks/useRosterMutations.ts
 * ---------------------------------------------------------------------------
 * React Query 5 mutations for the staff roster (feature: easy-login, story 10):
 * add one participant, import (or dry-run) a CSV, and run one of the four
 * per-participant actions (reissue, revoke, disable, enable).
 *
 * Mutations, not queries: each is an explicit staff-triggered write that must
 * never auto-fire, dedupe or retry.
 *
 * ## The list is refetched BEFORE the mutation resolves
 * Each write's `onSuccess` returns the invalidation promise, so `mutateAsync`
 * settles only once the refreshed roster is in the cache. The screen relies on
 * that to put keyboard focus on the right element AFTER the rows have changed
 * (a Disable button becomes Enable; a new row appears) rather than racing the
 * refetch. A dry run writes nothing, so it does not refetch.
 *
 * The invalidation uses `rosterQueryKey(exerciseId)` — the same exercise-keyed
 * key `useRoster` reads (XC-001). No exercise id is ever sent in a request.
 *
 * World: STAFF. Pure data hooks — no UI.
 */

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query'
import { useExerciseContext } from '@/core/exerciseContext'
import {
  addParticipant,
  importRoster,
  runRosterAction,
  type RosterError,
} from '../services/rosterService'
import type {
  RosterActionKind,
  RosterActionResultDto,
  RosterEntryDto,
  RosterImportResultDto,
  RosterRowWrite,
} from '../types'
import { rosterQueryKey } from './useRoster'

/** A function that refetches the active exercise's roster and resolves when it has. */
function useRefetchRoster(): () => Promise<void> {
  const queryClient = useQueryClient()
  const { exerciseId } = useExerciseContext()
  return () => queryClient.invalidateQueries({ queryKey: rosterQueryKey(exerciseId) })
}

/** Adds one participant. Resolves with the new row once the list has refetched. */
export function useAddParticipant(): UseMutationResult<
  RosterEntryDto,
  RosterError,
  RosterRowWrite
> {
  const refetch = useRefetchRoster()
  return useMutation<RosterEntryDto, RosterError, RosterRowWrite>({
    mutationFn: row => addParticipant(row),
    onSuccess: () => refetch(),
  })
}

/** Variables of {@link useImportRoster}. */
export interface ImportRosterVariables {
  readonly file: File
  /** True = validate only: the server writes nothing. */
  readonly dryRun: boolean
}

/** Validates (`dryRun: true`) or imports (`dryRun: false`) a roster CSV. */
export function useImportRoster(): UseMutationResult<
  RosterImportResultDto,
  RosterError,
  ImportRosterVariables
> {
  const refetch = useRefetchRoster()
  return useMutation<RosterImportResultDto, RosterError, ImportRosterVariables>({
    mutationFn: ({ file, dryRun }) => importRoster(file, { dryRun }),
    onSuccess: result => (result.dryRun ? undefined : refetch()),
  })
}

/** Variables of {@link useRosterAction}. */
export interface RosterActionVariables {
  readonly kind: RosterActionKind
  /** The participant's ACCOUNT id, taken from the list response. */
  readonly participantId: string
}

/**
 * Runs one per-participant action. A 404 means the person is no longer on this
 * roster, so the list is refetched on that failure too and the stale row goes.
 */
export function useRosterAction(): UseMutationResult<
  RosterActionResultDto,
  RosterError,
  RosterActionVariables
> {
  const refetch = useRefetchRoster()
  return useMutation<RosterActionResultDto, RosterError, RosterActionVariables>({
    mutationFn: ({ kind, participantId }) => runRosterAction(kind, participantId),
    onSuccess: () => refetch(),
    onError: error => (error.status === 404 ? refetch() : undefined),
  })
}
