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
 *   3. `onSuccess` invalidates the STATUS query only; it never writes the
 *      result into the cache (`setQueryData`) and never returns it.
 *
 * The status query is untouched by any of this: it holds the contract's
 * `DayWordStatusDto`, which has no word field and which the service copies field
 * by field.
 *
 * World: STAFF. Pure data hooks - no UI.
 */

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
import type { DayWordPutBody, DayWordSetResultDto, DayWordStatusDto } from './types'

/**
 * The status query key. Carries the active exercise id for cache separation
 * only (see the module header); exported so tests and any future staff surface
 * can target or invalidate exactly this data.
 */
export function dayWordQueryKey(exerciseId: string) {
  return ['staff', 'day-word', exerciseId] as const
}

/** Do not retry a definite answer (400/401/403/404); retry network/5xx twice. */
function shouldRetry(failureCount: number, error: DayWordError): boolean {
  const retryable = error.status === undefined || error.status >= 500
  return retryable && failureCount < 2
}

/** Loads the active exercise's day-word status. Never contains a word. */
export function useDayWordStatus(): UseQueryResult<DayWordStatusDto, DayWordError> {
  const { exerciseId } = useExerciseContext()
  return useQuery<DayWordStatusDto, DayWordError>({
    queryKey: dayWordQueryKey(exerciseId),
    queryFn: getDayWordStatus,
    retry: shouldRetry,
  })
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
  readonly setWord: (body: DayWordPutBody) => Promise<DayWordSetResultDto>
}

/** `PUT /staff/day-word` as a consume-once mutation. See the module header. */
export function useSetDayWord(): UseSetDayWord {
  const queryClient = useQueryClient()
  const { exerciseId } = useExerciseContext()

  const { mutateAsync, reset, isPending } = useMutation<
    DayWordSetResultDto,
    DayWordError,
    DayWordPutBody
  >({
    mutationFn: putDayWord,
    // Evict the finished mutation (and the word in its variables / data) at once.
    gcTime: 0,
    onSuccess: () => {
      // Refresh the status (a word is now set / was replaced). Not awaited, and
      // the result is deliberately not passed anywhere.
      void queryClient.invalidateQueries({ queryKey: dayWordQueryKey(exerciseId) })
    },
  })

  const setWord = async (body: DayWordPutBody): Promise<DayWordSetResultDto> => {
    try {
      return await mutateAsync(body)
    } finally {
      // Success or failure: let the observer release the mutation now.
      reset()
    }
  }

  return { isPending, setWord }
}

/** `DELETE /staff/day-word[?date=]`. `mutate(date?)`; omit the date for today. */
export function useClearDayWord(): UseMutationResult<void, DayWordError, string | undefined> {
  const queryClient = useQueryClient()
  const { exerciseId } = useExerciseContext()

  return useMutation<void, DayWordError, string | undefined>({
    mutationFn: date => deleteDayWord(date),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dayWordQueryKey(exerciseId) })
    },
  })
}
