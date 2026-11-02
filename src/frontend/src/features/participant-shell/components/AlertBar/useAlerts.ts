/**
 * features/participant-shell/components/AlertBar/useAlerts.ts
 * ---------------------------------------------------------------------------
 * The alert bar's LIVE active set (participant-shell story 02; channels-
 * foundation story 11, #707; PRT-010/011/012, FC-4/FC-5, weather FU-5).
 *
 * READ. `GET /alerts` once per exercise (React Query, keyed by `exerciseId`
 * for caching only — see `alertsSource.ts`). An out-of-shape body fails
 * closed: the query errors and this hook returns `[]`, so the bar stays in
 * its `none` state. Loading and error also return `[]`: the EAS-analog
 * surface never shows a fabricated alert.
 *
 * PUSH. Subscribes to `AlertsChanged` on the SHARED `realtimeConnection` (the
 * pattern of story 09's `useChannelStream`: no second hub, no second
 * connection) and starts it if nothing has yet. Each frame carries the FULL
 * active set, so it REPLACES the cached set — never merged — and a late or
 * reconnecting client converges on the server's truth. An identical frame
 * changes nothing (React Query's structural sharing keeps the same array), so
 * the bar re-renders nothing and announces nothing. A malformed frame is
 * dropped and the set is refetched. A frame that lands while the GET is in
 * flight wins: the GET is cancelled first, so an older response can never
 * overwrite a newer push. Every push also marks the `/alerts` history stale.
 *
 * RESYNC. When the hub comes back after a gap (or connects for the first
 * time after mount), pushes may have been missed: the set is refetched. A
 * DELIBERATE stop (`'stopped'`: the session's identity changed) restarts the
 * shared connection when a token is stored, as `useChannelStream` does.
 *
 * ORDER. The returned set is sorted severity-then-recency
 * (`sortAlertsBySeverityThenRecency`) whatever order the server or a push
 * used, so the ticker rotation and the emergency band's stack are stable.
 *
 * MOCK. With `USE_MOCK_DATA` on, the read is served by the canned adapter and
 * NO hub connection is opened (the social feed's rule), so the shell and its
 * tests need no backend.
 *
 * Signature unchanged from story 02: `useAlerts(): readonly Alert[]`.
 *
 * World: participant. No COBRA, no UI — a pure data hook.
 */

import { useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useExerciseContext } from '@/core/exerciseContext'
import { getAccessToken } from '@/core/auth/tokenStore'
import { HubConnectionState, realtimeConnection } from '@/core/realtime/connection'
import type { Alert } from './alertTypes'
import {
  USE_MOCK_ALERTS,
  alertsHistoryQueryKey,
  alertsQueryKey,
  fetchAlerts,
  isAlertsBody,
} from './alertsSource'
import { sortAlertsBySeverityThenRecency } from './sortAlerts'

/** The FC-5 frame carrying the full active set (`CHANNEL_REALTIME_EVENTS`). */
export const ALERTS_CHANGED_EVENT = 'AlertsChanged'

/** Shared empty result, so an empty bar never sees a fresh array per render. */
const NO_ALERTS: readonly Alert[] = []

/** Module-level so React Query memoizes the sorted result per cached array. */
function selectSorted(alerts: readonly Alert[]): readonly Alert[] {
  return alerts.length === 0 ? NO_ALERTS : sortAlertsBySeverityThenRecency(alerts)
}

/**
 * Resolves the current exercise's active alerts, live. See the module header.
 */
export function useAlerts(): readonly Alert[] {
  const { exerciseId } = useExerciseContext()
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => alertsQueryKey(exerciseId), [exerciseId])

  const { data } = useQuery({
    queryKey,
    queryFn: fetchAlerts,
    select: selectSorted,
  })

  useEffect(() => {
    if (USE_MOCK_ALERTS) return undefined

    const connection = realtimeConnection
    const historyKey = alertsHistoryQueryKey(exerciseId)
    let disposed = false
    // Mounting before the hub is Connected is a gap too: a frame sent between the GET and the
    // connection coming up is missed, so the first Connected refetches.
    let hadGap = connection.state !== HubConnectionState.Connected
    // Frames are applied strictly in arrival order, each after the in-flight GET is cancelled.
    let applying: Promise<void> = Promise.resolve()

    // Queued behind any frame still being applied, so a read it starts can never be
    // overtaken by (and then overwrite) an earlier frame's set.
    const refetch = (): void => {
      applying = applying.then(() => {
        if (disposed) return
        void queryClient.invalidateQueries({ queryKey, exact: true })
        void queryClient.invalidateQueries({ queryKey: historyKey, exact: true })
      })
    }

    const offChanged = connection.subscribe(ALERTS_CHANGED_EVENT, payload => {
      if (disposed) return
      if (!isAlertsBody(payload)) {
        // Fail closed on the frame, but the push still says "the set changed": read it again.
        refetch()
        return
      }
      applying = applying
        .then(() => queryClient.cancelQueries({ queryKey, exact: true }))
        .then(() => {
          if (disposed) return
          queryClient.setQueryData<readonly Alert[]>(queryKey, payload.alerts)
          void queryClient.invalidateQueries({ queryKey: historyKey, exact: true })
        })
        .catch(() => {
          // A cancel never rejects in practice; if it did, converge by reading again.
          if (disposed) return
          void queryClient.invalidateQueries({ queryKey, exact: true })
          void queryClient.invalidateQueries({ queryKey: historyKey, exact: true })
        })
    })

    const offState = connection.onStateChange((state, reason) => {
      if (disposed) return
      if (state !== HubConnectionState.Connected) {
        // A deliberate stop is the session reset's doing, not a missed-push window.
        if (reason !== 'stopped') {
          hadGap = true
        } else if (getAccessToken() !== null) {
          hadGap = true
          connection.start().catch(() => {
            hadGap = true
          })
        }
        return
      }
      if (!hadGap) return
      hadGap = false
      refetch()
    })

    connection.start().catch(() => {
      // Hub unreachable: the GET stands; a later Connected refetches.
      hadGap = true
    })

    return () => {
      disposed = true
      offChanged()
      offState()
    }
  }, [exerciseId, queryClient, queryKey])

  return data ?? NO_ALERTS
}
