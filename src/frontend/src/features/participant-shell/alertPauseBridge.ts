/**
 * features/participant-shell/alertPauseBridge.ts
 * ---------------------------------------------------------------------------
 * A tiny shared store so the two sibling shell layers can coordinate without
 * importing each other or needing a React Query provider (mobile-tablet
 * story 05; CTL-023, NFR-001):
 *
 *  - `OverlayLayer` publishes `pauseActive` while a PAUSE page is up.
 *    `AlertBar` then renders `inert` (still visible above the pause page, not
 *    interactive) and holds ticker rotation (the world holds still).
 *  - `AlertBar` publishes `alertSummary` (severity label + message of the alert
 *    it shows). The pause dialog mirrors it in a visually-hidden description,
 *    because `aria-modal` hides the bar from assistive tech.
 *
 * Single-instance assumption: ONE `AlertBar` and ONE `OverlayLayer` are mounted per
 * shell (module-level state, not per-instance). Two bars would overwrite each
 * other's `alertSummary`. `overlay` is `'pause'` for a pause page and `'cover'`
 * for EndEx / break-fiction: in both cases the bar goes inert and holds its
 * ticker so a rotating polite live region is not heard under an `aria-modal`
 * dialog; only pause leaves the bar visible.
 */
import { useSyncExternalStore } from 'react'
import type { AlertSeverity } from './components/AlertBar/alertTypes'

export type OverlayKind = 'none' | 'pause' | 'cover'

interface BridgeState {
  readonly overlay: OverlayKind
  readonly pauseActive: boolean
  readonly overlayActive: boolean
  readonly alertSummary: string
  readonly alertSeverity: AlertSeverity | null
}

function make(
  overlay: OverlayKind,
  alertSummary: string,
  alertSeverity: AlertSeverity | null,
): BridgeState {
  return {
    overlay,
    pauseActive: overlay === 'pause',
    overlayActive: overlay !== 'none',
    alertSummary,
    alertSeverity,
  }
}

let state: BridgeState = make('none', '', null)
const listeners = new Set<() => void>()

function update(
  overlay: OverlayKind,
  alertSummary: string,
  alertSeverity: AlertSeverity | null,
): void {
  if (overlay === state.overlay && alertSummary === state.alertSummary
    && alertSeverity === state.alertSeverity) return
  state = make(overlay, alertSummary, alertSeverity)
  listeners.forEach(listener => listener())
}

export const alertPauseBridge = {
  setOverlay: (overlay: OverlayKind) => update(overlay, state.alertSummary, state.alertSeverity),
  setPauseActive: (active: boolean) => update(active ? 'pause' : 'none', state.alertSummary, state.alertSeverity),
  setAlert: (alertSummary: string, alertSeverity: AlertSeverity | null) =>
    update(state.overlay, alertSummary, alertSeverity),
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  getSnapshot: (): BridgeState => state,
  reset: () => update('none', '', null),
}

export function useAlertPauseBridge(): BridgeState {
  return useSyncExternalStore(
    alertPauseBridge.subscribe, alertPauseBridge.getSnapshot, alertPauseBridge.getSnapshot)
}
