/**
 * features/controller/runSheet/useRunSheet.ts
 * ---------------------------------------------------------------------------
 * The run sheet's CONTROLLER HOOK (demo-polish C3, story 19; CTL-010/011 lite). STAFF
 * world. Joins the pieces a fire needs - the persisted sheet (`runSheetStore`), the
 * exercise scope, the controller's acting human, the exercise's personas - and exposes
 * the three actions the panel binds to: `fire`, `fireNext` and `blockedFor`. Skip, edit,
 * reorder etc. are plain store calls the panel makes directly.
 *
 * THE FIRE SEQUENCE (`fire`)
 *   1. look the beat up in the CURRENT snapshot (never a render-time closure);
 *   2. an `unconfirmed` beat needs an explicit confirmation first (the panel asks), so a
 *      retry of a request whose outcome is unknown is never one keystroke away;
 *   3. `fireBlockReason` (persona resolves, something to post, a reply's parent fired);
 *   4. `beginFireIn` claims the sheet's single fire slot SYNCHRONOUSLY and persists the
 *      in-flight marker, so a double-press (two key events in one tick) cannot fire twice
 *      and a reload mid-request leaves an `unconfirmed` beat rather than a `pending` one;
 *   5. `sendBeat` posts as `controller-as-persona` and never rejects;
 *   6. the outcome is recorded against the EXERCISE THE FIRE STARTED IN (`exerciseId` is
 *      captured at step 1) - the console does not remount on an exercise switch.
 * Every path returns a `FireReport` with a controller-facing sentence for the panel's
 * live region; a failure is never reported as success.
 *
 * `fireNext` targets the first `pending` beat only. A beat that failed or is unconfirmed
 * is never picked up automatically, and if the next pending beat is blocked it is
 * REPORTED rather than skipped over, so a later beat never goes out ahead of its turn.
 */

import { useCallback, useMemo } from 'react'
import { formatScenarioTime } from '@/core/clock'
import { useExerciseContext } from '@/core/exerciseContext'
import { usePersonas, type Persona } from '@/features/personas'
import { useControllerIdentity } from '../identity/controllerIdentity'
import {
  firstPendingBeat,
  isFiring,
  runtimeOf,
  type RunSheetData,
} from './runSheetModel'
import {
  beginFireIn,
  completeFireIn,
  failFireIn,
  getRunSheetSnapshot,
  useRunSheetSnapshot,
  type RunSheetSnapshot,
} from './runSheetStore'
import {
  buildPostInput,
  fireBlockReason,
  sendBeat,
  type PersonaLookup,
} from './runSheetFire'
import type { RunSheetBeat } from './runSheetSchema'

/** What a fire attempt came to. */
export type FireOutcome =
  | 'fired'
  | 'failed'
  | 'unconfirmed'
  | 'blocked'
  | 'needs-confirmation'
  | 'nothing-pending'

/** A fire attempt's result and the sentence to announce for it. */
export interface FireReport {
  readonly outcome: FireOutcome
  readonly message: string
  readonly beatId?: string
}

export interface FireOptions {
  /** The controller has confirmed re-firing a beat whose outcome is unknown. */
  readonly confirmedUnconfirmed?: boolean
}

export interface UseRunSheetResult {
  readonly exerciseId: string
  readonly timeZone: string
  readonly snapshot: RunSheetSnapshot
  /** The exercise's personas (the same read the fire uses to resolve handles). */
  readonly personas: readonly Persona[]
  /** The persona read is still on its first load. */
  readonly personasLoading: boolean
  /** True while any beat of this sheet is mid-fire. */
  readonly firing: boolean
  /** Why `beat` cannot be fired right now (persona, parent), or `undefined`. Ignores timing. */
  readonly blockedFor: (beat: RunSheetBeat) => string | undefined
  readonly fire: (beatId: string, options?: FireOptions) => Promise<FireReport>
  readonly fireNext: () => Promise<FireReport>
}

/** Quotes a beat's title for a sentence. */
function quoted(beat: RunSheetBeat): string {
  return `"${beat.title}"`
}

export function useRunSheet(): UseRunSheetResult {
  const { exerciseId, timeZone } = useExerciseContext()
  const identity = useControllerIdentity()
  const { personas, loading, error } = usePersonas()
  const snapshot = useRunSheetSnapshot(exerciseId)

  const lookup = useMemo<PersonaLookup>(
    () => ({ personas, loading, failed: error !== undefined }),
    [personas, loading, error],
  )
  const actingHumanId = identity.actingHumanId

  const blockedFor = useCallback(
    (beat: RunSheetBeat): string | undefined => {
      const decision = fireBlockReason(snapshot, beat, lookup, exerciseId)
      return decision.ok ? undefined : decision.reason
    },
    [snapshot, lookup, exerciseId],
  )

  const fire = useCallback(
    async (beatId: string, options: FireOptions = {}): Promise<FireReport> => {
      // Everything below runs against the sheet as it is NOW, for the exercise it was
      // pressed in; none of it may depend on a later render.
      const data: RunSheetData = getRunSheetSnapshot(exerciseId)
      const beat = data.beats.find(candidate => candidate.id === beatId)
      if (beat === undefined) {
        return { outcome: 'blocked', message: 'That beat is no longer in the sheet.' }
      }
      const record = runtimeOf(data, beatId)
      if (record.status === 'fired') {
        return { outcome: 'blocked', beatId, message: `${quoted(beat)} has already been fired.` }
      }
      if (record.status === 'skipped') {
        return {
          outcome: 'blocked',
          beatId,
          message: `${quoted(beat)} is skipped. Undo the skip to fire it.`,
        }
      }
      if (isFiring(data)) {
        return {
          outcome: 'blocked',
          beatId,
          message: 'Another beat is still firing. Wait for its result.',
        }
      }
      if (record.failure?.kind === 'unconfirmed' && options.confirmedUnconfirmed !== true) {
        return {
          outcome: 'needs-confirmation',
          beatId,
          message: `${quoted(beat)} may already be live. Check the Live world, then confirm to fire again.`,
        }
      }

      const decision = fireBlockReason(data, beat, lookup, exerciseId)
      if (!decision.ok) {
        return {
          outcome: 'blocked',
          beatId,
          message: `Cannot fire ${quoted(beat)}: ${decision.reason}`,
        }
      }

      const claimed = beginFireIn(exerciseId, beatId)
      if (!claimed.ok) return { outcome: 'blocked', beatId, message: claimed.reason }

      const input = buildPostInput(beat, {
        exerciseId,
        timeZone,
        actingHumanId,
        persona: decision.persona,
        ...(decision.parentPostId !== undefined ? { parentPostId: decision.parentPostId } : {}),
      })
      const result = await sendBeat(input)

      if (result.kind === 'fired') {
        completeFireIn(exerciseId, beatId, {
          postId: result.postId,
          scenarioTime: result.scenarioTime,
        })
        return {
          outcome: 'fired',
          beatId,
          message:
            `Fired ${quoted(beat)} as @${decision.persona.handle} at `
            + `${formatScenarioTime(result.scenarioTime, timeZone)}.`,
        }
      }
      failFireIn(exerciseId, beatId, { kind: result.kind, message: result.message })
      return {
        outcome: result.kind,
        beatId,
        message:
          result.kind === 'unconfirmed'
            ? `Unconfirmed: ${quoted(beat)}. ${result.message}`
            : `Failed: ${quoted(beat)}. ${result.message}`,
      }
    },
    [exerciseId, timeZone, actingHumanId, lookup],
  )

  const fireNext = useCallback(async (): Promise<FireReport> => {
    const next = firstPendingBeat(getRunSheetSnapshot(exerciseId))
    if (next === undefined) {
      return { outcome: 'nothing-pending', message: 'No pending beats left to fire.' }
    }
    return fire(next.id)
  }, [exerciseId, fire])

  return {
    exerciseId,
    timeZone,
    snapshot,
    personas,
    personasLoading: loading,
    firing: isFiring(snapshot),
    blockedFor,
    fire,
    fireNext,
  }
}
