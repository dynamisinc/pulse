/**
 * features/participant-shell/components/AlertBar/useExitFullscreenOnNewAlert.ts
 * ---------------------------------------------------------------------------
 * A fullscreen element paints ABOVE EVERYTHING -- above any z-index -- so a channel's
 * fullscreen video (the social player's wrapper) would hide the shell's fixed alert bar,
 * and a NEW alert would go unseen for as long as the viewer stays fullscreen. The alert
 * bar is the EAS analog (PRT-010): it persists across every channel and must not be
 * hideable by one. Demo-polish Wave 2 Gate-2 M-5.
 *
 * WHAT IT DOES. When an alert in a tier that warrants interrupting becomes active that was
 * NOT active a moment ago, and the document is fullscreen, it leaves fullscreen -- ONCE for
 * that alert. It talks to `document` only (`@/core/dom/fullscreen`), so the shell imports
 * nothing from `features/**` and it covers every channel, not just the one that happens to
 * play video (same rule as the overlay layer's `useLeaveFullscreenWhileActive`).
 *
 * WHY NOT `useLeaveFullscreenWhileActive`. That hook is built for a Pause / EndEx /
 * break-fiction overlay, which is up for as long as it is `active` and which must cover
 * everything: it re-exits whenever fullscreen is re-entered. Reusing it here would make
 * fullscreen UNUSABLE for the whole life of a long alert ticker -- the viewer would be
 * kicked out of every re-entry for as long as ANY alert stays active. An alert is
 * information, not a blocking layer: tell the viewer once, and then leave them in charge.
 * So the trigger is the alert's ARRIVAL (its id entering the active set), not "an alert is
 * active": re-entering fullscreen with the same alert still active is allowed, and the
 * NEXT new alert interrupts again.
 *
 * WHICH TIERS (`FULLSCREEN_EXIT_SEVERITIES`): `emergency` and `advisory`.
 *  - `emergency` ("act now"; the solid-red band) always interrupts.
 *  - `advisory` ("take care" -- a boil-water advisory, a shelter notice) interrupts too:
 *    it is the actionable middle tier, and a participant who watches a fullscreen briefing
 *    for ten minutes would otherwise miss the message the exercise exists to deliver.
 *  - `info` does NOT: it is ambient and non-actionable (it collapses on scroll, rotates in
 *    the ticker), so yanking someone out of a video for it would be noise that trains
 *    people to ignore the bar. It is on screen the moment they leave fullscreen anyway.
 *
 * "NEW" IS "NOT ACTIVE LAST TIME" (a seen-set of qualifying ids), not "the newest by
 * timestamp": a backdated alert still arrives now, and the server's order is not a
 * contract. An id that clears and later returns counts as new again. The first render
 * counts its alerts as new (a shell that mounts while an emergency is already up and the
 * page is somehow fullscreen should not leave it hidden).
 *
 * World: participant. Pure behavior hook, no UI, no COBRA.
 */

import { useEffect, useMemo, useRef } from 'react'
import { exitFullscreen, getFullscreenElement } from '@/core/dom/fullscreen'
import type { Alert, AlertSeverity } from './alertTypes'

/** The alert tiers whose ARRIVAL leaves fullscreen (see the module header for why). */
export const FULLSCREEN_EXIT_SEVERITIES: ReadonlySet<AlertSeverity> = new Set<AlertSeverity>([
  'advisory',
  'emergency',
])

/** Leaves fullscreen once for each alert that newly becomes active in a qualifying tier. */
export function useExitFullscreenOnNewAlert(alerts: readonly Alert[]): void {
  // A stable string key of the qualifying ids, so the effect re-runs only when the SET
  // changes (`useAlerts()` hands back a fresh array while empty).
  const qualifyingKey = useMemo(
    () =>
      alerts
        .filter(alert => FULLSCREEN_EXIT_SEVERITIES.has(alert.severity))
        .map(alert => alert.id)
        .sort()
        .join('\n'),
    [alerts],
  )

  // The qualifying ids already seen as active. Replaced (not accumulated) each time, so an
  // alert that clears and comes back is new again.
  const seenRef = useRef<ReadonlySet<string>>(new Set())

  useEffect(() => {
    const current = new Set(qualifyingKey === '' ? [] : qualifyingKey.split('\n'))
    const seen = seenRef.current
    seenRef.current = current

    let arrived = false
    for (const id of current) {
      if (!seen.has(id)) arrived = true
    }
    if (arrived && getFullscreenElement() !== null) void exitFullscreen()
  }, [qualifyingKey])
}
