/**
 * features/participantAdmin/cards/useRosterCards.ts
 * ---------------------------------------------------------------------------
 * The React Query hook behind the card-sheet preview (easy-login story 12).
 *
 * Call it ONLY from a component that is mounted while the preview is open
 * (`CardSheetPreview`). That is what makes "discarded when the preview closes" true:
 * the query has exactly one observer, the preview, so when the preview unmounts the
 * observer goes and `gcTime: 0` removes the entry from the cache at once. Calling it
 * from the always-mounted button instead would keep every join URL in the cache for as
 * long as the roster page is open.
 *
 * WHY THE CACHE IS TURNED OFF. The response is a stack of bearer credentials (a join URL
 * and its QR per person). So:
 *   - `staleTime: 0` + `gcTime: 0`: never served from memory later, gone on close;
 *   - `retry: false`: a 409 or 403 is an answer, not a blip, and a failed attempt should
 *     say so rather than hammer a credential endpoint (the preview offers a manual Retry);
 *   - no refetch on window focus or reconnect: each fetch is a server-side
 *     `roster.cards.generated` telemetry event, and a sheet that re-renders under the
 *     user while they are printing it is a bug, not freshness.
 * No card data is ever written to storage (this hook never touches `localStorage`,
 * `sessionStorage` or the query persister).
 *
 * CANCELLATION. The query function takes React Query's `AbortSignal` and passes it down, so
 * closing the preview mid-load aborts the request in flight and stops the remaining chunks
 * of a large selection (see `cardsService.ts`).
 *
 * ISOLATION (XC-001 / COR-001). The request carries NO exercise id: the server scopes the
 * call. The React Query KEY includes the active exercise id from `useExerciseContext()`,
 * so a staff member who switches exercise can never be handed the previous exercise's
 * cards from a cache entry. The ids in the key are cleaned (blank and repeated ids
 * dropped) and sorted so the same set of people is the same entry whatever order the
 * roster listed them in. An EMPTY selection ("everyone") is keyed `'all'`, distinct from a
 * non-empty selection that holds nothing usable, so the two can never share an entry.
 *
 * World: STAFF (data hook).
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useExerciseContext } from '@/core/exerciseContext'
import { usableIds } from './cardFormat'
import { fetchRosterCards, type RosterCardsError } from './cardsService'
import type { RosterCardsDto } from './types'

/** The key prefix every card query shares. */
export const ROSTER_CARDS_KEY_ROOT = 'participantAdminCards'

/** The query key for one exercise and one set of participant ids (order-insensitive). */
export function rosterCardsKey(
  exerciseId: string,
  participantIds: readonly string[],
): readonly [string, string, 'all' | readonly string[]] {
  return [
    ROSTER_CARDS_KEY_ROOT,
    exerciseId,
    participantIds.length === 0 ? 'all' : usableIds(participantIds).sort(),
  ]
}

/**
 * Loads the printable cards for `participantIds` (empty = every eligible participant).
 * Fetches on mount. See the module header for why it must only be mounted while the
 * preview is open.
 */
export function useRosterCards(
  participantIds: readonly string[],
): UseQueryResult<RosterCardsDto, RosterCardsError> {
  const { exerciseId } = useExerciseContext()
  return useQuery<RosterCardsDto, RosterCardsError>({
    queryKey: rosterCardsKey(exerciseId, participantIds),
    queryFn: ({ signal }) => fetchRosterCards(participantIds, signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
}
