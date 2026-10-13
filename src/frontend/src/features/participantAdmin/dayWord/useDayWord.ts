/**
 * features/participantAdmin/dayWord/useDayWord.ts
 * ---------------------------------------------------------------------------
 * React Query 5 wrappers around the day-word seam (`./dayWordService`) for the
 * staff "Today's word" panel (easy-login story 11).
 *
 *  - `useDayWordStatus()`  - a QUERY. Whether a word is set for today, who set
 *    it and when, and which later dates have one. NEVER contains a word.
 *  - `useSetDayWord()`     - a MUTATION (`PUT`). Generate / set / rotate.
 *  - `useClearDayWord()`   - a MUTATION (`DELETE`). Turn a day's word off.
 *
 * ISOLATION (XC-001 / COR-001). The endpoints take NO exercise id - the server
 * scopes everything. The query key still carries the active exercise id from
 * `useExerciseContext()` (`dayWordQueryKey`) purely for CACHE separation: when
 * the staff exercise switcher changes the active exercise, the new exercise's
 * status lives under a different key, so the panel can never paint exercise A's
 * "word is set" under exercise B's header while B is loading. The id is never
 * sent anywhere.
 *
 * THE WORD IS A SECRET (cross-cutting AC "Secrets"). The plaintext exists in
 * exactly two places a mutation touches: the `PUT` body (when staff type one)
 * and the `PUT` response. React Query would normally hold BOTH in its
 * MutationCache (`variables` / `data`) for `gcTime` (5 minutes by default) after
 * the mutation settles. So `useSetDayWord` is built to leave nothing behind:
 *
 *   1. `gcTime: 0` - a mutation with no observer is evicted immediately, rather
 *      than lingering for 5 minutes.
 *   2. `setWord()` awaits the result, then calls `reset()` so the observer lets
 *      go of the mutation straight away (triggering that eviction), and returns
 *      the result to the CALLER, who holds it in component state only for the
 *      one result view (see `OneTimeWordResult`).
 *   3. `onSettled` invalidates the STATUS query only; it never writes the
 *      result into the cache (`setQueryData`) and never returns it.
 *
 * WHY `onSettled`, NOT `onSuccess`. A `PUT` / `DELETE` can COMMIT and still look
 * like a failure to the browser: a 2xx whose body is not the contract's shape, a
 * gateway timeout after the server finished, a dropped connection. In all of
 * those the status banner must be re-read from the server, or it keeps saying
 * "No word is set" about a word that is set. `onSettled` runs for every outcome.
 *
 * FRESHNESS. The status is never served from a stale cache (`staleTime: 0`), is
 * re-read when the window regains focus, and is re-read once more just after
 * `todayEndsAt` so a panel left open across the local-midnight rollover moves to
 * the new day by itself instead of showing yesterday as "today".
 *
 * The status query is untouched by any of this: it holds the contract's
 * `DayWordStatusDto`, which has no word field and which the service copies field
 * by field.
 *
 * World: STAFF. Pure data hooks - no UI.
 */

import { useEffect } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useExerciseContext } from '@/core/exerciseContext'
import {
  DayWordError,
  deleteDayWord,
  getDayWordStatus,
  putDayWord,
} from './dayWordService'
import type { DayWordPutRequest, DayWordSetResultDto, DayWordStatusDto } from './types'

/**
 * The status query key. Carries the active exercise id for cache separation
 * only (see the module header); exported so tests and any future staff surface
 * can target or invalidate exactly this data.
 */
export function dayWordQueryKey(exerciseId: string) {
  return ['staff', 'day-word', exerciseId] as const
}

/** A browser timer cannot be longer than this (2^31 - 1 ms, about 24.8 days). */
const MAX_TIMER_MS = 2_147_483_647

/** Wait this long past the rollover instant so the server has certainly rolled. */
export const ROLLOVER_SLACK_MS = 1_000

/**
 * If the instant is already past (a skewed browser clock, or a server that has not
 * rolled yet) re-check on this cadence rather than spinning.
 */
export const ROLLOVER_RECHECK_MS = 30_000

/**
 * How long to wait before re-reading the status because today may have ended:
 * until `todayEndsAt` plus a second of slack, never less than a re-check interval
 * when that instant is not in the future, and never past the browser's timer cap.
 * Pure so it can be tested without timers.
 */
export function msUntilRolloverRefetch(todayEndsAt: string, nowMs: number): number {
  const endsAtMs = Date.parse(todayEndsAt)
  if (Number.isNaN(endsAtMs) || endsAtMs <= nowMs) return ROLLOVER_RECHECK_MS
  return Math.min(endsAtMs - nowMs + ROLLOVER_SLACK_MS, MAX_TIMER_MS)
}

/**
 * Retry only what might fix itself: no answer at all (`network`) or a 5xx. A
 * definite 4xx, and a 2xx whose body is not the contract's shape (`malformed`), are
 * answers - asking again gets the same one, and the panel should say so promptly.
 */
function shouldRetry(failureCount: number, error: DayWordError): boolean {
  const retryable = error.kind === 'network' || (error.status !== undefined && error.status >= 500)
  return retryable && failureCount < 2
}

/** Loads the active exercise's day-word status. Never contains a word. */
export function useDayWordStatus(): UseQueryResult<DayWordStatusDto, DayWordError> {
  const { exerciseId } = useExerciseContext()
  const query = useQuery<DayWordStatusDto, DayWordError>({
    queryKey: dayWordQueryKey(exerciseId),
    queryFn: getDayWordStatus,
    retry: shouldRetry,
    // Explicit, not inherited from an app default: this status gates what staff
    // tell a room, so it is never served stale.
    staleTime: 0,
    refetchOnWindowFocus: true,
  })

  // Re-read just after the local-midnight rollover. Re-scheduled each time the
  // data is refreshed, so an unrolled or skewed answer is re-checked, not forgotten.
  const { refetch } = query
  const todayEndsAt = query.data?.todayEndsAt
  const updatedAt = query.dataUpdatedAt
  useEffect(() => {
    if (todayEndsAt === undefined) return undefined
    const timer = window.setTimeout(
      () => void refetch(),
      msUntilRolloverRefetch(todayEndsAt, Date.now()),
    )
    return () => window.clearTimeout(timer)
  }, [todayEndsAt, updatedAt, refetch])

  return query
}

/** What `useSetDayWord` returns: a pending flag plus the consume-and-forget setter. */
export interface UseSetDayWord {
  /** True while the `PUT` is in flight. */
  readonly isPending: boolean
  /**
   * Sets (or rotates) a word and resolves with the plaintext result, then resets
   * the mutation so React Query holds no copy of it. The caller owns the result
   * from this point and must keep it in component state only. A failure REJECTS
   * with a `DayWordError` (the mutation is reset on failure too, so its
   * `variables` - which may hold a typed word - are released); the caller keeps
   * the error in its own state.
   */
  readonly setWord: (body: DayWordPutRequest) => Promise<DayWordSetResultDto>
}

/** `PUT /staff/day-word` as a consume-once mutation. See the module header. */
export function useSetDayWord(): UseSetDayWord {
  const queryClient = useQueryClient()
  const { exerciseId } = useExerciseContext()

  const { mutateAsync, reset, isPending } = useMutation<
    DayWordSetResultDto,
    DayWordError,
    DayWordPutRequest
  >({
    mutationFn: putDayWord,
    // Evict the finished mutation (and the word in its variables / data) at once.
    gcTime: 0,
    onSettled: () => {
      // Re-read the status whatever happened (see the module header). Not awaited,
      // and the result is deliberately not passed anywhere.
      void queryClient.invalidateQueries({ queryKey: dayWordQueryKey(exerciseId) })
    },
  })

  const setWord = async (body: DayWordPutRequest): Promise<DayWordSetResultDto> => {
    try {
      return await mutateAsync(body)
    } finally {
      // Success or failure: let the observer release the mutation now.
      reset()
    }
  }

  return { isPending, setWord }
}

/** `DELETE /staff/day-word?date=`. `mutate(date)`: the date is always sent (Gate-2 W-1). */
export function useClearDayWord(): UseMutationResult<void, DayWordError, string> {
  const queryClient = useQueryClient()
  const { exerciseId } = useExerciseContext()

  return useMutation<void, DayWordError, string>({
    mutationFn: date => deleteDayWord(date),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: dayWordQueryKey(exerciseId) })
    },
  })
}
