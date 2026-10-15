/**
 * features/controller/noise/useNoiseState.ts
 * ---------------------------------------------------------------------------
 * The state machine behind the console's White noise knob (demo-feedback story 09). STAFF world,
 * a hook with no UI.
 *
 * READ. `GET /api/staff/noise` on mount, and again whenever something that changes `running`
 * without a push changes: the console's pause tier (a Freeze or its release) and the exercise's
 * lifecycle status (StartEx, EndEx). The server pushes `NoiseStateChanged` only on a level change
 * and on each noise post, so without these re-reads the knob would keep saying "Running" through
 * a Freeze. Between pushes and reads, the newest answer wins (a sequence guard drops a read that
 * an earlier-started one overtook).
 *
 * LIVE. The staff-group `NoiseStateChanged` frame on the shared hub connection replaces the state
 * (another controller's change, the posted count ticking up), and every hub (re)connect re-reads.
 *
 * WRITE. `setLevel(level)` shows the level at once (`selectedLevel`) and sends `PUT { level }`.
 * Writes are SERIALISED: while one is in flight, a newer choice waits and only the latest waiting
 * choice is sent next (arrowing Off -> High never races three PUTs at the server). A failure keeps
 * its sentence in `saveError` until the next choice, and the knob falls back to the server's level
 * (nothing was changed there).
 *
 * EXERCISE SWITCH. The console does not remount when the session's exercise changes, so all state
 * is dropped and re-read when `exerciseId` changes, and an answer for the previous exercise is
 * ignored.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useExerciseContext } from '@/core/exerciseContext'
import { usePauseState } from '../hooks/usePauseState'
import { fetchNoiseState, putNoiseLevel, subscribeNoiseState } from './noiseService'
import type { NoiseLevel, NoiseStateDto } from './noiseTypes'

export interface UseNoiseStateResult {
  /** The server's state; `undefined` until the first read (or push) lands. */
  readonly state: NoiseStateDto | undefined
  /** The level the knob shows: the pending choice while a write is out, else the server's. */
  readonly selectedLevel: NoiseLevel | undefined
  /** True while a `PUT` is in flight. */
  readonly saving: boolean
  /** Why the state could not be read (cleared by the next successful read or push). */
  readonly loadError: string | null
  /** Why the last level change failed (cleared by the next choice). */
  readonly saveError: string | null
  setLevel(level: NoiseLevel): void
}

export function useNoiseState(): UseNoiseStateResult {
  const { exerciseId, status } = useExerciseContext()
  const { tier } = usePauseState()

  const [state, setState] = useState<NoiseStateDto | undefined>(undefined)
  const [pendingLevel, setPendingLevel] = useState<NoiseLevel | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  // The exercise the hook currently serves; answers for any other are dropped.
  // Refreshed in a layout effect (never during render), so it is current before any effect below.
  const exerciseRef = useRef(exerciseId)
  useLayoutEffect(() => {
    exerciseRef.current = exerciseId
  }, [exerciseId])
  const readSequence = useRef(0)
  const desiredLevel = useRef<NoiseLevel | null>(null)
  const writing = useRef(false)

  const adopt = useCallback((next: NoiseStateDto) => {
    setState(next)
    setLoadError(null)
  }, [])

  const read = useCallback(() => {
    const sequence = ++readSequence.current
    const forExercise = exerciseRef.current
    fetchNoiseState()
      .then(next => {
        if (sequence !== readSequence.current || forExercise !== exerciseRef.current) return
        adopt(next)
      })
      .catch((error: unknown) => {
        if (sequence !== readSequence.current || forExercise !== exerciseRef.current) return
        setLoadError(error instanceof Error ? error.message : 'White noise could not be read.')
      })
  }, [adopt])

  // A new exercise: forget everything from the previous one, and listen for this one's pushes.
  useEffect(() => {
    setState(undefined)
    setPendingLevel(null)
    setLoadError(null)
    setSaveError(null)
    desiredLevel.current = null
    const forExercise = exerciseId
    return subscribeNoiseState(
      next => {
        if (forExercise !== exerciseRef.current) return
        // A push is newer than any read still in flight.
        readSequence.current += 1
        adopt(next)
      },
      read,
    )
  }, [exerciseId, adopt, read])

  // Read on mount, on an exercise switch, and when the tier or lifecycle moves `running`.
  useEffect(() => {
    read()
  }, [exerciseId, tier, status, read])

  const pump = useCallback(async () => {
    if (writing.current) return
    writing.current = true
    const forExercise = exerciseRef.current
    try {
      while (desiredLevel.current !== null) {
        const level = desiredLevel.current
        desiredLevel.current = null
        try {
          const next = await putNoiseLevel(level)
          if (forExercise !== exerciseRef.current) return
          readSequence.current += 1
          adopt(next)
        } catch (error) {
          if (forExercise !== exerciseRef.current) return
          setSaveError(error instanceof Error ? error.message : 'White noise was not changed.')
        }
      }
    } finally {
      writing.current = false
      if (forExercise === exerciseRef.current) setPendingLevel(null)
    }
  }, [adopt])

  const setLevel = useCallback(
    (level: NoiseLevel) => {
      setSaveError(null)
      setPendingLevel(level)
      desiredLevel.current = level
      void pump()
    },
    [pump],
  )

  return {
    state,
    selectedLevel: pendingLevel ?? state?.level,
    saving: pendingLevel !== null,
    loadError,
    saveError,
    setLevel,
  }
}
