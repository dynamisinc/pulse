/**
 * core/clock/ServerClockMount.tsx
 * ---------------------------------------------------------------------------
 * Mounts the server clock sync for the session's exercise (fix/noise-new-posts-
 * clock). Renders nothing. Mounted once, inside `ExerciseContextProvider >
 * SessionProvider` (`features/app-shell/routes.tsx`), so it runs for participant
 * and staff alike, and only once a session has resolved.
 *
 * KEYED BY THE ACTIVE EXERCISE ID (the `usePersonaResolution` pattern): the effect
 * re-runs on an in-place exercise switch, which stops the previous sync (dropping
 * any late answer for the exercise just left) and starts a fresh one.
 *
 * MOCK MODE (`USE_MOCK_DATA`) does nothing: the wall-clock mock stays installed and
 * no network call is made. Reads the exercise context from the LEAF module (not the
 * barrel) like `personaService`, so tests that mock the barrel stay on the
 * unkeyed (no sync) path.
 */

import { useEffect } from 'react'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { useOptionalExerciseContext } from '@/core/exerciseContext/exerciseContext'
import { startServerClockSync } from './serverClockSync'

export function ServerClockSync(): null {
  const exerciseId = useOptionalExerciseContext()?.exerciseId
  useEffect(() => {
    if (USE_MOCK_DATA || exerciseId === undefined) return undefined
    return startServerClockSync(exerciseId)
  }, [exerciseId])
  return null
}
