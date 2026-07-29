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
 *
 * MOCK <-> LIVE (UAT engine-pause fix; COR-001/018). The local per-exercise
 * store above is ALWAYS the optimistic UI source `<EngineControlBar>` /
 * `DraftTimerDriver` read `effective` from, in BOTH modes, and the
 * `engine.autonomy_changed` telemetry below is ALWAYS emitted in BOTH modes
 * too — the backend `kill-switch`/`restore` endpoints mutate in-memory
 * autonomy state but emit no telemetry of their own (no autonomy event type
 * exists there yet), so this frontend emit is the ONLY audit trail of a
 * steering action; skipping it live would leave zero record. Behind the ONE
 * `USE_MOCK_DATA` flag (`@/core/config/mockData`), `setMode` additionally:
 *   - mock: stops there (unchanged legacy behavior — no backend call);
 *   - live (`USE_MOCK_DATA === false`): ALSO fires
 *     `liveEngineControlActions.setMode` (the real `kill-switch`/`restore`
 *     POST) and, if it rejects, REVERTS the optimistic update — the kill
 *     switch must never claim a safety state that didn't actually take (the
 *     telemetry already logged the attempted change either way). `degrade`/
 *     `restore` (the mock provider-degraded clamp) are UNCHANGED — a separate
 *     mock, not part of this flip.
 *
 *     `setMode` accepts an OPTIONAL `{ onRejected }` callback, invoked after
 *     that revert, so a COMPOSING caller can undo its own coupled state too
 *     (world-steering/07: `usePauseState` must not keep showing ENGINE PAUSED
 *     when the kill-switch POST this hook owns has failed and the control bar
 *     has already snapped back to LIVE). It is deliberately a callback rather
 *     than a returned promise: every existing caller is fire-and-forget, and
 *     returning a rejecting promise from `setMode` would create unhandled
 *     rejections (and turn `act(() => setMode(...))` into an un-awaited async
 *     act) across surfaces that never asked for the outcome.
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
 *
 * `modeSettledCount` (autonomy-safety story 06). A monotonic counter bumped in
 * BOTH the `.then` and `.catch` of the live kill-switch/restore POST — i.e.
 * once the request SETTLES, never on the synchronous optimistic flip above
 * it. `<EngineControlBar>` watches this (not raw `mode`) to decide when to
 * refetch `useEngineSettings()`'s snapshot: the optimistic flip and the POST
 * are issued in the same call, so a watcher keyed on `mode` fires a settings
 * GET while the kill-switch POST is still in-flight — a race the GET is
 * heavily favoured to win (one filter vs. the POST's mutation + validation +
 * a telemetry write), which is worse than no refetch at all: it applies a
 * pre-trip snapshot as authoritative and nothing ever corrects it, since
 * neither `mode` nor `degraded` changes again. `modeSettledCount` is a pure
 * signal — it carries no information itself, every consumer must still read
 * `mode`/`degraded`/`effective` for the actual state; it exists ONLY to say
 * "a live request just concluded, whatever it was". Untouched in mock mode
 * (there is no live POST to settle).
 */

import { useCallback, useSyncExternalStore } from 'react'
import { scenarioNow } from '@/core/clock'
import { USE_MOCK_DATA } from '@/core/config/mockData'
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
import { setMode as liveSetMode } from '../services/liveEngineControlActions'

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
  /**
   * Bumped once per live kill-switch/restore POST SETTLING (success or
   * failure). See module header.
   */
  readonly modeSettledCount: number
}

const DEFAULT_STATE: EngineControlState = {
  mode: DEFAULT_MODE,
  degraded: false,
  degradedReason: null,
  modeSettledCount: 0,
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

/**
 * Adopts a mode the SERVER already has, locally and SILENTLY — no telemetry, no
 * backend POST. Used only by resync paths (world-steering/07's `usePauseState`
 * mount resync) that learn the engine is already stopped because some *other*
 * human stopped it: emitting `engine.autonomy_changed` here would write a
 * safety action into the audit trail attributed to THIS console's acting human,
 * for an action they never took (COR-018/XC-004 accuracy), and re-POSTing the
 * kill switch would echo a command nobody issued. The causing action was
 * already logged by whoever performed it.
 */
function adoptServerMode(exerciseId: string, mode: EngineMode): void {
  const current = getSnapshot(exerciseId)
  if (current.mode === mode) return
  setFor(exerciseId, { ...current, mode })
}

/**
 * The module-singleton engine-control store. Exposed for the test-only reset and
 * the silent server adopt.
 */
export const engineControlStore = { getSnapshot, subscribe, resetForTests, adoptServerMode }

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

/** Options a composing caller can pass to `setMode`. */
export interface SetEngineModeOptions {
  /**
   * Invoked (live mode only) after a rejected kill-switch/restore POST has been
   * reverted, so a caller with COUPLED state can undo it too — see the module
   * header. Never called in mock mode, and never called for a no-op.
   */
  readonly onRejected?: () => void
}

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
  readonly setMode: (mode: EngineMode, options?: SetEngineModeOptions) => void
  /** Trips the automatic degraded clamp (mock provider-degraded), logged. No-op if already on. */
  readonly degrade: (reason: string) => void
  /** Explicitly lifts the degraded clamp (never automatic), logged. No-op if already healthy. */
  readonly restore: () => void
  /**
   * Bumped once per live kill-switch/restore POST SETTLING — a pure signal,
   * never itself the state; watch it (not raw `mode`) to know when a settings
   * refetch is safe to fire without racing the POST. Never changes in mock
   * mode.
   */
  readonly modeSettledCount: number
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
    (mode: EngineMode, options?: SetEngineModeOptions) => {
      const current = getSnapshot(exerciseId)
      if (current.mode === mode) return
      const next: EngineControlState = { ...current, mode }
      // Optimistic in BOTH modes — the console must flip instantly either way.
      setFor(exerciseId, next)
      // Logged in BOTH modes too — the backend kill-switch/restore endpoints
      // emit no telemetry of their own, so this is the only audit trail.
      emit('kill-switch', next)

      if (USE_MOCK_DATA) return

      // Live: additionally fire the real kill-switch/restore POST. On
      // rejection, REVERT the optimistic flip above — the switch must never
      // claim a safety state (e.g. "STOPPED") that the backend didn't
      // actually apply. The telemetry above still stands as the record of the
      // attempted change.
      //
      // KNOWN GAP (out of scope here): the endpoints return the authoritative
      // EngineAutonomyStateDto, but we discard it and keep the optimistic
      // derivation, so a 'live' restore shows DelayedAuto while a default
      // exercise resumes at its Suggest base — safe (more restrained than
      // shown), but not reconciled. Reconciling needs the frontend/backend
      // autonomy-model alignment tracked separately.
      liveSetMode(mode, { actingHumanId: identity.actingHumanId, timeZone })
        .then(() => {
          // Settled successfully. Bump the settle signal (autonomy-safety
          // story 06) so `<EngineControlBar>`'s engine-settings refetch fires
          // AFTER the POST has actually concluded, not on this function's
          // earlier synchronous optimistic flip.
          const settled = getSnapshot(exerciseId)
          setFor(exerciseId, { ...settled, modeSettledCount: settled.modeSettledCount + 1 })
        })
        .catch(() => {
          // Revert ONLY the mode, and only if OUR optimistic mode is still the
          // live one — a newer setMode supersedes us and owns the mode, so a
          // stale rejection must not clobber it (rapid re-toggle safety). Merge
          // over the CURRENT snapshot rather than restoring the whole `current`,
          // so an in-flight `degrade()`/`restore()` (which changes `degraded`,
          // not `mode`) is preserved instead of being wiped by the revert.
          const live = getSnapshot(exerciseId)
          const revertedMode = live.mode === next.mode ? current.mode : live.mode
          // Bumped unconditionally (autonomy-safety story 06) — even a
          // stale/superseded rejection means A live request just settled,
          // which is still a valid moment to refetch engine settings.
          setFor(exerciseId, {
            ...live,
            mode: revertedMode,
            modeSettledCount: live.modeSettledCount + 1,
          })

          // Let a COMPOSING caller undo its own coupled state (world-steering/07:
          // the ENGINE PAUSED tier must not outlive the stop it claims). Called
          // after our own revert, and guarded so a caller's callback can never
          // break this hook's contract.
          try {
            options?.onRejected?.()
          } catch {
            // A composing caller's revert must never resurface as an unhandled
            // rejection inside the kill switch's own failure path.
          }
        })
    },
    [exerciseId, emit, identity.actingHumanId, timeZone],
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
    modeSettledCount: state.modeSettledCount,
  }
}
