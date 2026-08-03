/**
 * features/exerciseLifecycleAdmin/hooks/useOrgExercises.ts
 * ---------------------------------------------------------------------------
 * React Query 5 wrapper around the org-tier exercise list read (feature:
 * exercise-lifecycle-admin, story 02 — COR-075).
 *
 * A query, not a mutation: "which exercises does my organization own" is a
 * plain cacheable read the surface issues on mount.
 *
 * `ORG_EXERCISES_QUERY_KEY` is exported so the creation mutation
 * (`useCreateExercise`) can invalidate exactly this data and nothing else.
 * The key is deliberately NOT namespaced by exercise: this read spans the
 * caller's whole tenant, and the server — not a client-supplied id — decides
 * which tenant that is.
 *
 * World: STAFF. Pure data hook — no UI, no COBRA.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { getOrgExercises, type OrgExerciseError } from '../services/orgExercisesService'
import type { OrgExercise } from '../types'

/** The query key this hook uses. */
export const ORG_EXERCISES_QUERY_KEY = ['org', 'exercises'] as const

/**
 * Lists the exercises the caller's organization owns. Exposes the standard
 * React Query `isPending` / `isSuccess` / `data` / `isError` / `error` state the
 * list surface renders its loading / empty / error / populated states against.
 */
export function useOrgExercises(): UseQueryResult<OrgExercise[], OrgExerciseError> {
  return useQuery<OrgExercise[], OrgExerciseError>({
    queryKey: ORG_EXERCISES_QUERY_KEY,
    queryFn: getOrgExercises,
  })
}
