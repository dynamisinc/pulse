/**
 * features/controller/engine/hooks/useSwampedMode.ts
 * ---------------------------------------------------------------------------
 * The lead-gated "swamped mode" toggle (feature: engine-review-cockpit, story
 * 03; ADP-040, D5-014/1.1, COR-001, COR-018, XC-004). STAFF world — pure hook,
 * no UI, no COBRA.
 *
 * "Swamped mode" is the **only** sanctioned path to timeout auto-send (see
 * `autoHoldPolicy.decide()`, story 01): while it is off (the default), an
 * expired Delayed-auto draft with no controller decision always auto-HOLDs —
 * silence is never approval. A small SimCell that is genuinely swamped may opt
 * the exercise into auto-send instead, but ONLY the LEAD controller may flip
 * this switch — a small SimCell drowning in decisions is exactly the moment a
 * non-lead operator must not be able to unilaterally raise the exercise's
 * autonomy. The engine itself never turns this on: there is no code path here
 * (or anywhere) that flips it without a human calling `setSwampedMode`.
 *
 * GATE. `isLead` is read off the Phase-1 mock `useControllerIdentity()`
 * (extended by this story — see that module's header). `setSwampedMode(true)`
 * is a NO-OP — rejected, not recorded as enabled, no telemetry emitted — when
 * `!isLead`. Disabling is not gated (there is nothing unsafe about a
 * controller turning auto-send back OFF).
 *
 * PER-EXERCISE SCOPE (COR-001). State lives in a small module-singleton store
 * KEYED BY `exerciseId` (mirrors `reviewStore`'s singleton shape:
 * `subscribe`/`resetForTests`), so a remount under a different exercise reads
 * a different flag and no exercise's swamped state can leak into another's.
 *
 * OUTPUT CONTRACT. The `swampedMode` boolean this hook returns is exactly the
 * value story 02's `useDraftTimer` consumes as an INPUT PARAMETER (wired at
 * integration) — this file has no import of, and no dependency on, that hook
 * (file-disjoint parallel build, implementation.md).
 *
 * TELEMETRY (ADP-041/§11, XC-004). Every actual enable/disable (a value that
 * changes, and — for enabling — passes the lead gate) emits ONE telemetry
 * event via the caller-safe `buildAndEmit`: `channel: 'system'`, `actor {
 * kind: 'engine', actingHumanId }` (the toggling controller), `eventType`
 * `'engine.swamped_mode_changed'` (an open string — no envelope migration),
 * carrying scenario time (COR-053) and the resulting state in `payload`.
 */

import { useCallback, useSyncExternalStore } from 'react'
import { scenarioNow } from '@/core/clock'
import { useExerciseContext } from '@/core/exerciseContext'
import { buildAndEmit } from '@/core/telemetry'
import { wallClockNowIso } from '@/core/time/wallClock'
import { useControllerIdentity } from '../../identity/controllerIdentity'

// ---------------------------------------------------------------------------
// The per-exercise module-singleton store (mirrors `reviewStore`'s shape)
// ---------------------------------------------------------------------------

/** `exerciseId -> swampedMode`. Absent = off (the safety default). */
const swampedModeByExercise = new Map<string, boolean>()

/** Active change listeners; notified on every mutation. */
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/** The current swamped-mode flag for `exerciseId` — off (`false`) if unset. */
function getSnapshot(exerciseId: string): boolean {
  return swampedModeByExercise.get(exerciseId) ?? false
}

/** Subscribes to store changes; returns an unsubscribe function. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Sets the flag for `exerciseId` and notifies subscribers. Internal — the gate
 * (lead-only enable) and the telemetry emit live in `useSwampedMode`'s
 * `setSwampedMode`, not here, so this stays a plain, unguarded store write.
 */
function setFor(exerciseId: string, value: boolean): void {
  if (getSnapshot(exerciseId) === value) return
  swampedModeByExercise.set(exerciseId, value)
  notify()
}

/**
 * Clears every exercise's flag and all listeners. Test-only — prevents
 * cross-test pollution (mirrors `reviewStore.resetForTests`).
 */
function resetForTests(): void {
  swampedModeByExercise.clear()
  listeners.clear()
}

/** The module-singleton swamped-mode store. Exposed for test-only reset. */
export const swampedModeStore = { getSnapshot, subscribe, resetForTests }

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/** The surface `<SwampedModeToggle>` (and story 02's integration) binds to. */
export interface UseSwampedModeResult {
  /** Whether swamped mode is currently on for this exercise. Off by default. */
  readonly swampedMode: boolean
  /** Whether the OPERATING controller is this exercise's lead (the enable gate). */
  readonly isLead: boolean
  /**
   * Sets swamped mode on/off for this exercise. `setSwampedMode(true)` is a
   * NO-OP — rejected, not recorded, not logged — when `!isLead`. Every actual
   * change (including disable) logs a telemetry event (ADP-041).
   */
  readonly setSwampedMode: (next: boolean) => void
}

/**
 * The per-exercise, lead-gated swamped-mode flag. See the module header for
 * the full contract.
 */
export function useSwampedMode(): UseSwampedModeResult {
  const identity = useControllerIdentity()
  const { exerciseId, timeZone } = useExerciseContext()

  const swampedMode = useSyncExternalStore(subscribe, () => getSnapshot(exerciseId))

  const setSwampedMode = useCallback(
    (next: boolean) => {
      // The sole safety gate (ADP-040): a non-lead can never ENABLE swamped
      // mode. Rejected silently to the caller — no state change, no telemetry.
      if (next && !identity.isLead) {
        return
      }

      const current = getSnapshot(exerciseId)
      if (current === next) {
        return
      }

      setFor(exerciseId, next)

      buildAndEmit({
        exerciseId,
        eventType: 'engine.swamped_mode_changed',
        channel: 'system',
        actor: { kind: 'engine', actingHumanId: identity.actingHumanId },
        origin: 'engine',
        wallClockTime: wallClockNowIso(),
        scenarioTime: scenarioNow().toISOString(),
        timeZone,
        target: { entityType: 'exercise', entityId: exerciseId },
        payload: { action: next ? 'swamped-mode-enabled' : 'swamped-mode-disabled' },
      })
    },
    [exerciseId, timeZone, identity.isLead, identity.actingHumanId],
  )

  return { swampedMode, isLead: identity.isLead, setSwampedMode }
}
