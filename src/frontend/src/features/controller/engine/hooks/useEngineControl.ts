/**
 * features/controller/engine/hooks/useEngineControl.ts
 * ---------------------------------------------------------------------------
 * The engine KILL SWITCH + degraded-mode mock hook (feature: engine-review-
 * cockpit, integration seam; ADP-042, D5 §2 "Engine control", E8 architecture
 * §8.2/§8.4). STAFF world — pure hook, no UI, no COBRA.
 *
 * A field-for-field-in-spirit MIRROR of the FROZEN
 * `Pulse.Core/Features/Autonomy/Services/EngineAutonomyState.cs` (the kill
 * switch + degraded-mode clamp), simplified to the two controls the console
 * chrome exposes:
 *
 *  - `setMode(mode)` — the ALWAYS-VISIBLE kill switch (ADP-042): a human
 *    action cycling the engine between `'live'` / `'suggest-only'` / `'stop'`.
 *    This is itself a safety-facing control (mirrors `EngageKillSwitch`) —
 *    there is no path back UP from `'stop'`/`'suggest-only'` other than the
 *    controller explicitly calling `setMode('live')` again. The engine never
 *    calls this itself.
 *  - `degrade(reason)` / `restore()` — the AUTOMATIC provider-degraded clamp
 *    (mirrors `DegradeToSuggest` / `RestoreFromSafety`): a mock stand-in for a
 *    generation-provider circuit breaker tripping. `degrade` only ever LOWERS
 *    the effective autonomy to Suggest on top of whatever `mode` is set;
 *    `restore` is the ONLY way to lift it — explicit, human-only, never
 *    automatic (§8.2 "only humans raise").
 *
 * EFFECTIVE AUTONOMY (the formula the console/timers consume). `effective`
 * combines both controls, safety-clamp-down-only:
 *   - `mode === 'stop'`              -> `STOPPED_AUTONOMY` (full stop wins,
 *     even over swamped mode — mirrors `ResolveEffective`'s `_stopped` check
 *     coming first).
 *   - `degraded` (mode not stopped)  -> `runningAutonomy(Suggest)` (the
 *     automatic clamp, regardless of `mode`).
 *   - `mode === 'suggest-only'`      -> `runningAutonomy(Suggest)`.
 *   - `mode === 'live'` (healthy)    -> `runningAutonomy(DelayedAuto)`.
 * This `EffectiveAutonomy` is exactly what `autoHoldPolicy.decide()` (via
 * `useDraftTimer`) consumes — a STOP/Suggest-only/degraded engine drops
 * `effective.level` below Delayed-auto, which suspends even a swamped-mode
 * timer (it HOLDs instead of auto-sending): see `DraftTimerDriver`.
 *
 * PER-EXERCISE SCOPE (COR-001), module-singleton store keyed by `exerciseId`
 * — mirrors `useSwampedMode`'s / `reviewStore`'s shape (`subscribe`/
 * `resetForTests`) so a remount under a different exercise reads a distinct
 * state and no exercise's engine-control state leaks into another's.
 *
 * TELEMETRY (ADP-041/§11, XC-004). Every actual `setMode`/`degrade`/`restore`
 * transition (a value that changes) emits ONE event via the caller-safe
 * `buildAndEmit`: `eventType: 'engine.autonomy_changed'` (an open string — no
 * envelope migration), `channel: 'system'`, `actor { kind: 'engine',
 * actingHumanId }`, scenario time (COR-053), `payload.cause` distinguishing
 * `'kill-switch' | 'degraded-mode' | 'restore'`.
 *
 * DEFAULT: `mode: 'live'`, `degraded: false` (healthy) — matches D5 §2
 * "ENGINE · LIVE" as the default header state.
 */

import { useCallback, useSyncExternalStore } from 'react'
import { scenarioNow } from '@/core/clock'
import { useExerciseContext } from '@/core/exerciseContext'
import { buildAndEmit } from '@/core/telemetry'
import { wallClockNowIso } from '@/core/time/wallClock'
import { useControllerIdentity } from '../../identity/controllerIdentity'
import {
  AutonomyLevel,
  STOPPED_AUTONOMY,
  runningAutonomy,
  type EffectiveAutonomy,
} from '../models/reviewContracts'

/** The kill switch's three positions (ADP-042, D5 §2). */
export type EngineMode = 'live' | 'suggest-only' | 'stop'

/** The kill switch's default position — healthy, full autonomy available. */
const DEFAULT_MODE: EngineMode = 'live'

// ---------------------------------------------------------------------------
// The per-exercise module-singleton store (mirrors `useSwampedMode`'s shape)
// ---------------------------------------------------------------------------

interface EngineControlState {
  readonly mode: EngineMode
  readonly degraded: boolean
  readonly degradedReason: string | null
}

const DEFAULT_STATE: EngineControlState = {
  mode: DEFAULT_MODE,
  degraded: false,
  degradedReason: null,
}

/** `exerciseId -> state`. Absent = the default (healthy, Live). */
const stateByExercise = new Map<string, EngineControlState>()

/** Active change listeners; notified on every mutation. */
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function getSnapshot(exerciseId: string): EngineControlState {
  return stateByExercise.get(exerciseId) ?? DEFAULT_STATE
}

function setFor(exerciseId: string, next: EngineControlState): void {
  stateByExercise.set(exerciseId, next)
  notify()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Clears every exercise's state + listeners. Test-only. */
function resetForTests(): void {
  stateByExercise.clear()
  listeners.clear()
}

/** The module-singleton engine-control store. Exposed for test-only reset. */
export const engineControlStore = { getSnapshot, subscribe, resetForTests }

// ---------------------------------------------------------------------------
// effective autonomy derivation
// ---------------------------------------------------------------------------

/** Derives `EffectiveAutonomy` from the kill-switch mode + degraded clamp (see module header). */
function deriveEffective(state: EngineControlState): EffectiveAutonomy {
  if (state.mode === 'stop') {
    return STOPPED_AUTONOMY
  }
  if (state.degraded) {
    return runningAutonomy(AutonomyLevel.Suggest)
  }
  return state.mode === 'suggest-only'
    ? runningAutonomy(AutonomyLevel.Suggest)
    : runningAutonomy(AutonomyLevel.DelayedAuto)
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/** The surface `<EngineControlBar>` (and `DraftTimerDriver`) binds to. */
export interface UseEngineControlResult {
  /** The kill switch's current position. Defaults `'live'`. */
  readonly mode: EngineMode
  /** The resolved autonomy the review/timer pipeline should route on. */
  readonly effective: EffectiveAutonomy
  /** Whether the automatic provider-degraded clamp is currently active. Default healthy. */
  readonly degraded: boolean
  /** The mock degraded reason, or `null` when healthy — drives the alert copy. */
  readonly degradedReason: string | null
  /** Sets the kill switch's position — always a human action, logged (ADP-041). */
  readonly setMode: (mode: EngineMode) => void
  /** Trips the automatic degraded clamp (mock provider-degraded), logged. No-op if already on. */
  readonly degrade: (reason: string) => void
  /** Explicitly lifts the degraded clamp (never automatic), logged. No-op if already healthy. */
  readonly restore: () => void
}

/**
 * The per-exercise kill switch + degraded-mode clamp. See the module header
 * for the full contract.
 */
export function useEngineControl(): UseEngineControlResult {
  const identity = useControllerIdentity()
  const { exerciseId, timeZone } = useExerciseContext()

  const state = useSyncExternalStore(subscribe, () => getSnapshot(exerciseId))

  const emit = useCallback(
    (cause: 'kill-switch' | 'degraded-mode' | 'restore', next: EngineControlState) => {
      buildAndEmit({
        exerciseId,
        eventType: 'engine.autonomy_changed',
        channel: 'system',
        actor: { kind: 'engine', actingHumanId: identity.actingHumanId },
        origin: 'engine',
        wallClockTime: wallClockNowIso(),
        scenarioTime: scenarioNow().toISOString(),
        timeZone,
        target: { entityType: 'exercise', entityId: exerciseId },
        payload: {
          cause,
          mode: next.mode,
          degraded: next.degraded,
          ...(next.degradedReason ? { reason: next.degradedReason } : {}),
        },
      })
    },
    [exerciseId, timeZone, identity.actingHumanId],
  )

  const setMode = useCallback(
    (mode: EngineMode) => {
      const current = getSnapshot(exerciseId)
      if (current.mode === mode) return
      const next: EngineControlState = { ...current, mode }
      setFor(exerciseId, next)
      emit('kill-switch', next)
    },
    [exerciseId, emit],
  )

  const degrade = useCallback(
    (reason: string) => {
      const current = getSnapshot(exerciseId)
      if (current.degraded) return
      const next: EngineControlState = {
        ...current,
        degraded: true,
        degradedReason: reason.trim() || 'generation provider degraded',
      }
      setFor(exerciseId, next)
      emit('degraded-mode', next)
    },
    [exerciseId, emit],
  )

  const restore = useCallback(() => {
    const current = getSnapshot(exerciseId)
    if (!current.degraded) return
    const next: EngineControlState = { ...current, degraded: false, degradedReason: null }
    setFor(exerciseId, next)
    emit('restore', next)
  }, [exerciseId, emit])

  return {
    mode: state.mode,
    effective: deriveEffective(state),
    degraded: state.degraded,
    degradedReason: state.degradedReason,
    setMode,
    degrade,
    restore,
  }
}
