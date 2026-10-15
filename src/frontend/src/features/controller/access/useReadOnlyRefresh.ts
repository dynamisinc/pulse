/**
 * features/controller/access/useReadOnlyRefresh.ts
 * ---------------------------------------------------------------------------
 * Keeps a READ-ONLY console current (demo-feedback story 11, #507; DF-14; Gate-1 M-3). STAFF
 * world, no UI.
 *
 * WHY. Two console reads refresh only on their holder's own action: the pause tier
 * (`usePauseState` resyncs once per runtime) and the engine settings (`useEngineSettings`
 * refetches when its own flyout opens or the kill switch settles). A controller acts, so they
 * stay current; an evaluator never acts, so without this they would keep showing what they saw
 * on load while the controllers freeze the world or stop the engine.
 *
 * WHAT. Re-reads both every {@link READ_ONLY_REFRESH_MS} while mounted, and stops on unmount.
 * A tick is skipped while the tab is hidden, and the tab coming back to `visible` reads at once
 * (so a returning evaluator never waits up to 15 s, and a background tab costs no requests).
 * Both reads are silent adopts (no telemetry, no POST).
 *
 * WHO. It does not check the role itself: `ControllerConsole` mounts `<ReadOnlyRefresh />` only
 * for a non-controller (`useCanControl()` false), so a controller's console never subscribes to
 * any of it (Gate-1 L-A).
 */

import { useEffect } from 'react'
import { useExerciseContext } from '@/core/exerciseContext'
import { useEngineSettings } from '../engine/hooks/useEngineSettings'
import { refreshPauseTierFromServer } from '../hooks/usePauseState'

/** How often a read-only console re-reads the pause tier and the engine settings. */
export const READ_ONLY_REFRESH_MS = 15_000

/** Re-reads the pause tier and engine settings on an interval while the tab is visible. */
export function useReadOnlyRefresh(): void {
  const { exerciseId } = useExerciseContext()
  // `refetch` is memoized on the exercise, so the interval is not re-armed on every render.
  const { refetch: refetchEngineSettings } = useEngineSettings()

  useEffect(() => {
    const refresh = (): void => {
      refetchEngineSettings()
      void refreshPauseTierFromServer(exerciseId)
    }
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      refresh()
    }, READ_ONLY_REFRESH_MS)
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [exerciseId, refetchEngineSettings])
}
