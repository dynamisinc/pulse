/**
 * features/controller/engine/hooks/useSwampedSettingsPoll.ts
 * ---------------------------------------------------------------------------
 * There is no settings push, so another controller's swamped-mode change reaches a console by
 * polling the existing serialized engine-settings refresh. This hook runs that refresh in the
 * BACKGROUND (`useEngineSettings().refreshInBackground`: no `loading`, no control disabling,
 * no focus loss) every {@link SETTINGS_POLL_MS}, skips ticks while the tab is hidden, and
 * refreshes immediately when the tab becomes visible again. Cleared on unmount.
 */
import { useEffect } from 'react'

/** How often a console re-reads engine settings to pick up another controller's change. */
export const SETTINGS_POLL_MS = 30_000

export function useSwampedSettingsPoll(refreshInBackground: () => void): void {
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') refreshInBackground()
    }, SETTINGS_POLL_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshInBackground()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refreshInBackground])
}
