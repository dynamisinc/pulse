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
 * WHAT. For a non-controller (`useCanControl()` false) it re-reads both every
 * {@link READ_ONLY_REFRESH_MS} while the console is mounted, and stops on unmount. Both reads
 * are silent adopts (no telemetry, no POST). A controller's console runs nothing here.
 */

import { useEffect } from 'react'
import { useExerciseContext } from '@/core/exerciseContext'
import { useEngineSettings } from '../engine/hooks/useEngineSettings'
import { refreshPauseTierFromServer } from '../hooks/usePauseState'
import { useCanControl } from './useCanControl'

/** How often a read-only console re-reads the pause tier and the engine settings. */
export const READ_ONLY_REFRESH_MS = 15_000

/** Re-reads the pause tier and engine settings on an interval for a non-controller. */
export function useReadOnlyRefresh(): void {
  const canControl = useCanControl()
  const { exerciseId } = useExerciseContext()
  // `refetch` is memoized on the exercise, so the interval is not re-armed on every render.
  const { refetch: refetchEngineSettings } = useEngineSettings()

  useEffect(() => {
    if (canControl) return
    const timer = window.setInterval(() => {
      refetchEngineSettings()
      void refreshPauseTierFromServer(exerciseId)
    }, READ_ONLY_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [canControl, exerciseId, refetchEngineSettings])
}
