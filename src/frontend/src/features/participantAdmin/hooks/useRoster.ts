/**
 * features/participantAdmin/hooks/useRoster.ts
 * ---------------------------------------------------------------------------
 * React Query 5 read of the staff roster (feature: easy-login, story 10).
 *
 * ## Exercise isolation (XC-001 / COR-001)
 * The query key INCLUDES the active exercise id from `useExerciseContext()`:
 * `['participantAdmin', exerciseId, 'roster']`. The id is used ONLY to key the
 * cache — it is never sent (the server scopes from the staff session) and never
 * stored anywhere else. So switching exercise (the staff switcher re-resolves
 * the scope) lands on a different cache entry and can never paint the previous
 * exercise's people. The mutations in `useRosterMutations` invalidate through
 * the same {@link rosterQueryKey}.
 *
 * ## Secrets (story 10, "Secrets")
 * The rows carry `link.joinUrl`, a bearer credential, so this query is the only
 * place it lives: `staleTime: 0` (always revalidated when observed) and a SHORT
 * `gcTime` so an unobserved roster does not sit in memory.
 *
 * ## Retry
 * A server answer (401/403/404/5xx) is not retried — retrying a 403 only delays
 * the "no access" state. Only a request that never got a response (network) is
 * retried, once.
 *
 * World: STAFF. Pure data hook — no UI.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useExerciseContext } from '@/core/exerciseContext'
import { getRoster, type RosterError } from '../services/rosterService'
import type { RosterListDto } from '../types'

/** How long an unobserved roster stays in the cache (it holds join URLs). */
export const ROSTER_GC_TIME_MS = 30_000

/** The roster query key for one exercise. Always includes the exercise id. */
export function rosterQueryKey(exerciseId: string) {
  return ['participantAdmin', exerciseId, 'roster'] as const
}

/**
 * The active exercise's roster. Exposes the standard `isPending` / `isError` /
 * `data` / `error` state the page renders its loading, 403, error and populated
 * states against.
 */
export function useRoster(): UseQueryResult<RosterListDto, RosterError> {
  const { exerciseId } = useExerciseContext()
  return useQuery<RosterListDto, RosterError>({
    queryKey: rosterQueryKey(exerciseId),
    queryFn: () => getRoster(),
    staleTime: 0,
    gcTime: ROSTER_GC_TIME_MS,
    refetchOnWindowFocus: true,
    retry: (failureCount, error) => error.status === undefined && failureCount < 1,
  })
}
