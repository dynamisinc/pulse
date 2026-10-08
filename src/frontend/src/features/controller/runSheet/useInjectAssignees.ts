/**
 * features/controller/runSheet/useInjectAssignees.ts
 * ---------------------------------------------------------------------------
 * The staff assigned to the active exercise (`GET /api/injects/assignees`), plus
 * the caller's own staff id — story 07's source for three things:
 *
 *   - the editor's ASSIGNEE select;
 *   - "Mine": an item is mine when `item.assigneeId === me`. "Mine" is a FILTER,
 *     not a lock (IQ-3) — anyone can fire anything and the server logs who did;
 *   - names: "Already fired by {name}" resolves `firedByHumanId` through this list.
 *
 * STAFF world, React Query, no UI. Cached per exercise (the id is a cache key
 * only — never sent, COR-001). Assignment changes rarely during conduct, so a
 * 60 s staleTime is plenty; the queue poll is what keeps the rows live.
 */

import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useExerciseContext } from '@/core/exerciseContext'
import { injectQueryKeys } from './useInjectQueue'
import { getInjectService } from './injectService'
import type { InjectAssigneesDto } from './types'

export interface UseInjectAssigneesResult {
  /** The caller's staff id, or `undefined` until the first read lands (nothing is "mine" yet). */
  readonly me: string | undefined
  readonly assignees: InjectAssigneesDto['assignees']
  /** Display name for a staff id, or `undefined` when unknown (callers fall back to a generic). */
  readonly nameOf: (id: string | null | undefined) => string | undefined
  readonly isLoading: boolean
  readonly isError: boolean
}

const NO_ASSIGNEES: InjectAssigneesDto['assignees'] = []

export function useInjectAssignees(): UseInjectAssigneesResult {
  const { exerciseId } = useExerciseContext()
  const query = useQuery({
    queryKey: injectQueryKeys.assignees(exerciseId),
    queryFn: () => getInjectService().assignees(),
    staleTime: 60_000,
  })

  const assignees = query.data?.assignees ?? NO_ASSIGNEES
  const nameById = useMemo(() => new Map(assignees.map(a => [a.id, a.displayName])), [assignees])
  const nameOf = useCallback(
    (id: string | null | undefined) => (id ? nameById.get(id) : undefined),
    [nameById],
  )

  return {
    me: query.data?.me,
    assignees,
    nameOf,
    isLoading: query.isPending,
    isError: query.isError,
  }
}
