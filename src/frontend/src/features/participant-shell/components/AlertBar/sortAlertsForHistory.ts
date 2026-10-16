/**
 * features/participant-shell/components/AlertBar/sortAlertsForHistory.ts
 * ---------------------------------------------------------------------------
 * Ordering for the `/alerts` view (`AlertsHistory.tsx`): most severe first
 * (emergency -> advisory -> info), then newest first within a severity -- the
 * order a participant should act on them. Pure, so it is unit-tested directly.
 */

import type { Alert, AlertSeverity } from './alertTypes'

/** Sort rank per severity: lower sorts first (most severe on top). */
const SEVERITY_RANK: Record<AlertSeverity, number> = { emergency: 0, advisory: 1, info: 2 }

/**
 * Most severe first, then newest first. Pure (returns a new array) so it can
 * be unit-tested and never mutates the React Query cache.
 */
export function sortAlertsForHistory(alerts: readonly Alert[]): Alert[] {
  return [...alerts].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      Date.parse(b.scenarioTime) - Date.parse(a.scenarioTime),
  )
}
