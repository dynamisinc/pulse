/**
 * features/participant-shell/components/AlertBar/useAlertsHistory.ts
 * ---------------------------------------------------------------------------
 * The `/alerts` view's data: `GET /alerts/history` (channels-foundation story
 * 11, #707; PRT-012). Every alert of the exercise — cleared and expired
 * included — newest first, one cursor page at a time.
 *
 * Reverse-chronological is the SERVER's order (FC-4); pages are appended in
 * the order they arrive and de-duplicated by id (an alert raised between two
 * page loads can shift a row across the page boundary).
 *
 * Fails closed like the active read: an out-of-shape page errors the query and
 * yields no alerts — never a fabricated one. Kept fresh by `useAlerts()`, which
 * marks this query stale on every `AlertsChanged` push and on a hub resync.
 *
 * World: participant. No COBRA, no UI — a pure data hook.
 */

import { useCallback, useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useExerciseContext } from '@/core/exerciseContext'
import type { Alert } from './alertTypes'
import { alertsHistoryQueryKey, fetchAlertsHistory } from './alertsSource'

export interface AlertsHistoryResult {
  /** Every loaded alert, newest first. Empty while loading and on error. */
  readonly alerts: readonly Alert[]
  /** True until the first page settles. */
  readonly isLoading: boolean
  /** True when the first page failed (or was out of shape). */
  readonly isError: boolean
  /** Whether an older page exists. */
  readonly hasMore: boolean
  /** True while an older page is loading. */
  readonly isLoadingMore: boolean
  /** Loads the next older page. */
  readonly loadMore: () => void
}

export function useAlertsHistory(): AlertsHistoryResult {
  const { exerciseId } = useExerciseContext()

  const query = useInfiniteQuery({
    queryKey: alertsHistoryQueryKey(exerciseId),
    queryFn: ({ pageParam }) => fetchAlertsHistory(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: lastPage => lastPage.nextCursor,
  })

  const pages = query.data?.pages
  const alerts = useMemo(() => {
    if (pages === undefined) return []
    const seen = new Set<string>()
    const merged: Alert[] = []
    for (const page of pages) {
      for (const alert of page.alerts) {
        if (seen.has(alert.id)) continue
        seen.add(alert.id)
        merged.push(alert)
      }
    }
    return merged
  }, [pages])

  const { fetchNextPage } = query
  const loadMore = useCallback(() => {
    void fetchNextPage()
  }, [fetchNextPage])
  return {
    alerts,
    isLoading: query.isPending,
    isError: query.isError && pages === undefined,
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore,
  }
}
