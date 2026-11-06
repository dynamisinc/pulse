/**
 * features/participant-shell/components/AlertBar/sortAlerts.ts
 * ---------------------------------------------------------------------------
 * The ONE order of the active alert set (weather FU-5, D4-010 #7;
 * channels-foundation story 11): most severe first (emergency -> advisory ->
 * info), then newest first within a severity -- the order a participant
 * should act on them. `useAlerts()` applies it, so the bar's ticker, the
 * emergency band's "+N more" stack and every other reader agree, whatever
 * order the server or a push sent. Pure, so it is unit-tested directly.
 *
 * (The `/alerts` history view is reverse-chronological instead: that order
 * comes from the server's history read, not from here.)
 */

import type { Alert, AlertSeverity } from './alertTypes'

/** Sort rank per severity: lower sorts first (most severe on top). */
const SEVERITY_RANK: Record<AlertSeverity, number> = { emergency: 0, advisory: 1, info: 2 }

/**
 * Most severe first, then newest first, then by id (a stable tie-break so two
 * alerts raised at the same frozen scenario instant never swap between pushes).
 * Returns a new array and never mutates its input (the React Query cache).
 */
export function sortAlertsBySeverityThenRecency(alerts: readonly Alert[]): Alert[] {
  return [...alerts].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      Date.parse(b.scenarioTime) - Date.parse(a.scenarioTime) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}
