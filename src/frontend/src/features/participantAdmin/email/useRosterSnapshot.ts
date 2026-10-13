/**
 * features/participantAdmin/email/useRosterSnapshot.ts
 * ---------------------------------------------------------------------------
 * A PASSIVE read of the roster the screen has already loaded (easy-login story 13):
 * `capabilities.emailLinks` decides whether "Email links" exists at all, and the
 * entries let the confirm step say who would be emailed and the summary name who
 * was skipped.
 *
 * It observes the SAME cache entry as `useRoster` (`rosterQueryKey(exerciseId)`,
 * keyed on the active exercise, XC-001) with `enabled: false`, so it NEVER fetches:
 * no second `GET /staff/roster` (a response that carries join URLs) just because
 * the button mounted. With no roster in the cache it reports nothing, and the
 * button renders nothing (fail closed).
 *
 * World: STAFF. Pure data hook.
 */
import { useQuery } from '@tanstack/react-query'
import { useExerciseContext } from '@/core/exerciseContext'
import { ROSTER_GC_TIME_MS, rosterQueryKey } from '../hooks/useRoster'
import { getRoster } from '../services/rosterService'
import type { RosterListDto } from '../types'

/** The cached roster of the active exercise, or `undefined` when none is loaded. */
export function useRosterSnapshot(): RosterListDto | undefined {
  const { exerciseId } = useExerciseContext()
  const { data } = useQuery<RosterListDto>({
    queryKey: rosterQueryKey(exerciseId),
    queryFn: () => getRoster(),
    enabled: false,
    gcTime: ROSTER_GC_TIME_MS,
  })
  return data
}
