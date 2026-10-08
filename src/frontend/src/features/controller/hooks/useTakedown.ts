/**
 * features/controller/hooks/useTakedown.ts
 * ---------------------------------------------------------------------------
 * The state machine behind the Live world column's **Take down** action (demo-polish C5,
 * docs/features/demo-polish/22-takedown-ui.md; CTL-025, XC-004, DP-9, COR-018). STAFF world — a
 * hook with no UI, kept apart from `liveWorld/TakedownAction.tsx` on purpose: that folder's
 * two-worlds guard allows `exerciseId` to appear in exactly one place (the column's remount key),
 * and the telemetry stamp below needs it.
 *
 * ONE POST, ONE ROW, FOUR STATES. For a given post id:
 *   - `idle`     nothing in flight; the action can be started;
 *   - `pending`  the DELETE is in flight (a second start is ignored — no double submit);
 *   - `failed`   the server (or the network) refused; `failure` is the plain-text reason and
 *                {@link UseTakedownResult.retry} re-sends the SAME category the controller
 *                already confirmed (no second confirm for an action they already approved);
 *   - removed    NOT a phase: `removed` reads the session's `removedPosts` store, so it is true
 *                after this console's own success, after ANOTHER controller's `PostRemoved`
 *                reaches this tab, and again after the row remounts (a filter change unmounts
 *                the rows it hides). `removedHere` is true only when THIS instance's own action
 *                succeeded — the one case where the row moves focus to its "Removed" marker.
 *
 * TELEMETRY (XC-004, DP-9): exactly ONE `steering_action` per SUCCESSFUL takedown, emitted here
 * through the caller-safe `buildAndEmit` (it can never throw into the action): `channel:
 * 'system'`, `actor { kind: 'system', actingHumanId, role }` from the controller-identity seam
 * (COR-018), `target { entityType: 'post', entityId }`, `payload { action: 'takedown', category }`.
 * A failed attempt emits nothing (nothing happened); a retry that succeeds emits once. The server
 * emits NONE (DP-9). The event is emitted from the promise continuation, so it is recorded even if
 * the row unmounts while the request is in flight — the takedown happened regardless.
 * `exerciseId` / `timeZone` are STAMPING-ONLY (COR-001), from `useExerciseContext()`. The stamped
 * scenario time is the exercise clock's; the wall clock goes only to the telemetry-only field
 * (COR-053).
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { scenarioNow } from '@/core/clock'
import { useExerciseContext } from '@/core/exerciseContext'
import { buildAndEmit } from '@/core/telemetry'
import { wallClockNowIso } from '@/core/time/wallClock'
import { removedPosts } from '@/features/social/services/removedPosts'
import { useControllerIdentity } from '../identity/controllerIdentity'
import {
  takeDownPost,
  TakedownError,
  type TakedownCategory,
} from '../services/takedownService'

/** The in-flight phase of this row's takedown (removal itself is read from the store). */
export type TakedownPhase = 'idle' | 'pending' | 'failed'

export interface UseTakedownResult {
  readonly phase: TakedownPhase
  /** The plain-text reason, while `phase === 'failed'`. */
  readonly failure: string | undefined
  /** The post is taken down (by this console, another controller, or before this row mounted). */
  readonly removed: boolean
  /** THIS instance's own action succeeded (used to move focus to the "Removed" marker once). */
  readonly removedHere: boolean
  /** Starts the takedown with `category`. Ignored while one is in flight or the post is removed. */
  takeDown(category: TakedownCategory): void
  /** Re-sends the last attempted category. Ignored unless the last attempt failed. */
  retry(): void
  /** Clears a failure and returns to `idle`. */
  dismiss(): void
}

/** The plain-text reason for any thrown value (a `TakedownError` carries its own). */
function failureOf(error: unknown): string {
  return error instanceof TakedownError
    ? error.message
    : 'The post was not taken down. Try again.'
}

/** Drives the takedown of the post `postId`. See the module header. */
export function useTakedown(postId: string): UseTakedownResult {
  const { exerciseId, timeZone } = useExerciseContext()
  const { actingHumanId, role } = useControllerIdentity()

  const removed = useSyncExternalStore(
    removedPosts.subscribe,
    useCallback(() => removedPosts.has(postId), [postId]),
  )

  const [phase, setPhase] = useState<TakedownPhase>('idle')
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [removedHere, setRemovedHere] = useState(false)

  // A ref guard (not just the `phase` state): two activations in the same tick both see `idle`.
  const inFlightRef = useRef(false)
  const lastCategoryRef = useRef<TakedownCategory | undefined>(undefined)
  const failedRef = useRef(false)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const run = useCallback((category: TakedownCategory) => {
    if (inFlightRef.current || removedPosts.has(postId)) return
    inFlightRef.current = true
    lastCategoryRef.current = category
    failedRef.current = false
    setPhase('pending')
    setFailure(undefined)

    takeDownPost(postId, category).then(
      () => {
        inFlightRef.current = false
        // XC-004: the one event, for the one successful takedown (DP-9: the server emits none).
        buildAndEmit({
          exerciseId,
          eventType: 'steering_action',
          channel: 'system',
          actor: { kind: 'system', actingHumanId, role },
          wallClockTime: wallClockNowIso(),
          scenarioTime: scenarioNow().toISOString(),
          timeZone,
          target: { entityType: 'post', entityId: postId },
          payload: { action: 'takedown', category },
        })
        if (!mountedRef.current) return
        setRemovedHere(true)
        setPhase('idle')
      },
      (error: unknown) => {
        inFlightRef.current = false
        failedRef.current = true
        if (!mountedRef.current) return
        setFailure(failureOf(error))
        setPhase('failed')
      },
    )
  }, [postId, exerciseId, timeZone, actingHumanId, role])

  const retry = useCallback(() => {
    if (failedRef.current && lastCategoryRef.current !== undefined) run(lastCategoryRef.current)
  }, [run])

  const dismiss = useCallback(() => {
    if (inFlightRef.current) return
    failedRef.current = false
    setFailure(undefined)
    setPhase('idle')
  }, [])

  return { phase, failure, removed, removedHere, takeDown: run, retry, dismiss }
}
