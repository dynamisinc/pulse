/**
 * features/controller/noise/useNoiseState.ts
 * ---------------------------------------------------------------------------
 * The state machine behind the console's White noise knob (demo-feedback story 09). STAFF world,
 * a hook with no UI.
 *
 * READ. `GET /api/staff/noise` on mount and on an exercise switch. The server pushes
 * `NoiseStateChanged` only on a level change and on each noise post, NOT when a Freeze, a Resume,
 * EndEx or a clock change moves `running`, so the hook also re-reads:
 *   - when the console's pause tier or the exercise's lifecycle status changes, AFTER
 *     {@link TIER_REREAD_DELAY_MS}: the tier flips optimistically before its POST reaches the
 *     server, so an immediate read would see the old world (Gate-1 M1);
 *   - every {@link NOISE_POLL_MS} while a level is set and the tab is visible, so a Freeze, EndEx
 *     or clock change made from ANOTHER console still reaches this one (Gate-1 M1);
 *   - after a write that got no answer (timeout or network), because it may have been applied.
 * Between pushes and reads, the newest answer wins (a sequence guard drops a read that a later
 * read or push overtook).
 *
 * LIVE. The staff-group `NoiseStateChanged` frame on the shared hub connection replaces the state
 * (another controller's change, the posted count ticking up), and every hub (re)connect re-reads.
 *
 * WRITE. `setLevel(level)` shows the level at once (`selectedLevel`) and sends `PUT { level }`.
 * Writes are SERIALISED: while one is in flight, a newer choice waits and only the latest waiting
 * choice is sent next (arrowing Off -> High never races three PUTs at the server). A failure keeps
 * its sentence in `saveError` until the next choice or a successful write, and the knob falls back
 * to the server's level (nothing was changed there).
 *
 * EXERCISE SWITCH. The console does not remount when the session's exercise changes, so all state
 * is dropped and re-read when `exerciseId` changes. A write still in flight for the previous
 * exercise finishes, but its answer is not adopted; a choice made in the new exercise meanwhile is
 * sent next, never stranded (Gate-1 M2).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useExerciseContext } from '@/core/exerciseContext'
import { usePauseState } from '../hooks/usePauseState'
import {
  fetchNoiseState,
  NoiseRequestError,
  putNoiseLevel,
  subscribeNoiseState,
} from './noiseService'
import type { NoiseLevel, NoiseStateDto } from './noiseTypes'

/** How long after a pause-tier or lifecycle change the state is re-read (the POST settles). */
export const TIER_REREAD_DELAY_MS = 500

/** The light poll while a level is set and the tab is visible. */
export const NOISE_POLL_MS = 20_000

export interface UseNoiseStateResult {
  /** The server's state; `undefined` until the first read (or push) lands. */
  readonly state: NoiseStateDto | undefined
  /** The level the knob shows: the pending choice while a write is out, else the server's. */
  readonly selectedLevel: NoiseLevel | undefined
  /** True while a `PUT` is in flight. */
  readonly saving: boolean
  /** Why the state could not be read (cleared by the next successful read or push). */
  readonly loadError: string | null
  /** Why the last level change failed (cleared by the next choice or a successful write). */
  readonly saveError: string | null
  setLevel(level: NoiseLevel): void
}

function tabVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
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

  // A new exercise: forget everything from the previous one, read it, and listen for its pushes.
  useEffect(() => {
    setState(undefined)
    setPendingLevel(null)
    setLoadError(null)
    setSaveError(null)
    desiredLevel.current = null
    const forExercise = exerciseId
    const unsubscribe = subscribeNoiseState(
      next => {
        if (forExercise !== exerciseRef.current) return
        // A push is newer than any read still in flight.
        readSequence.current += 1
        adopt(next)
      },
      read,
    )
    read()
    return unsubscribe
  }, [exerciseId, adopt, read])

  // The tier or lifecycle moved `running` without a push: re-read once the change has settled.
  // The first run (mount / exercise switch) is skipped: the effect above has just read.
  const lastTrigger = useRef<{ exerciseId: string; tier: string; status: string } | null>(null)
  useEffect(() => {
    const previous = lastTrigger.current
    lastTrigger.current = { exerciseId, tier, status }
    if (previous === null || previous.exerciseId !== exerciseId) return
    if (previous.tier === tier && previous.status === status) return
    const timer = setTimeout(read, TIER_REREAD_DELAY_MS)
    return () => clearTimeout(timer)
  }, [exerciseId, tier, status, read])

  // The light poll: only while a level is set, and only for a visible tab.
  const levelSet = state !== undefined && state.level !== 'off'
  useEffect(() => {
    if (!levelSet) return
    const timer = setInterval(() => {
      if (tabVisible()) read()
    }, NOISE_POLL_MS)
    return () => clearInterval(timer)
  }, [levelSet, exerciseId, read])

  const pump = useCallback(async () => {
    if (writing.current) return
    writing.current = true
    try {
      while (desiredLevel.current !== null) {
        const level = desiredLevel.current
        desiredLevel.current = null
        // Captured per write: the exercise may switch while it is in flight.
        const forExercise = exerciseRef.current
        try {
          const next = await putNoiseLevel(level)
          if (forExercise !== exerciseRef.current) continue
          readSequence.current += 1
          adopt(next)
          setSaveError(null)
        } catch (error) {
          if (forExercise !== exerciseRef.current) continue
          setSaveError(error instanceof Error ? error.message : 'White noise was not changed.')
          // No answer at all: the write may have been applied, so ask the server.
          if (!(error instanceof NoiseRequestError) || error.status === undefined) read()
        }
      }
    } finally {
      // The loop exits only when nothing is waiting (a stale write `continue`s instead of
      // returning), so no later choice is ever left behind here.
      writing.current = false
      setPendingLevel(null)
    }
  }, [adopt, read])

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
