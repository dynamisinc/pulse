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
 */
import { useSyncExternalStore } from 'react'

interface BridgeState {
  readonly pauseActive: boolean
  readonly alertSummary: string
}

let state: BridgeState = { pauseActive: false, alertSummary: '' }
const listeners = new Set<() => void>()

function update(next: Partial<BridgeState>): void {
  const merged = { ...state, ...next }
  if (merged.pauseActive === state.pauseActive && merged.alertSummary === state.alertSummary) return
  state = merged
  listeners.forEach(listener => listener())
}

export const alertPauseBridge = {
  setPauseActive: (pauseActive: boolean) => update({ pauseActive }),
  setAlertSummary: (alertSummary: string) => update({ alertSummary }),
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  getSnapshot: (): BridgeState => state,
  reset: () => update({ pauseActive: false, alertSummary: '' }),
}

export function useAlertPauseBridge(): BridgeState {
  return useSyncExternalStore(
    alertPauseBridge.subscribe, alertPauseBridge.getSnapshot, alertPauseBridge.getSnapshot)
}
