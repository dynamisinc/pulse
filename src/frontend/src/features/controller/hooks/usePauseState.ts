/**
 * features/controller/hooks/usePauseState.ts
 * ---------------------------------------------------------------------------
 * The TIERED-PAUSE state machine (feature: world-steering, story 03; CTL-023,
 * D5-014/1.3, COR-050/053, XC-004, NFR-001). STAFF world (COBRA). This is the
 * KEYSTONE primitive other surfaces read once built — `DraftTimerDriver`
 * (engine-review-cockpit), the inject-queue burst-suspend, and
 * `participant-shell`'s `OverlayLayer` are DEFERRED consumers; this story
 * exposes the seam only and wires none of them.
 *
 * ## The four tiers (one active at a time)
 *   - `running` — the unpaused baseline; the world/engine/injects all live.
 *   - `injects` — INJECTS PAUSED: queued inject/burst firing halts; world +
 *     engine keep running. Never touches the scenario clock.
 *   - `engine`  — ENGINE PAUSED: new E8 content halts; injects + world continue.
 *     Never touches the scenario clock.
 *   - `freeze`  — WORLD FROZEN: everything halts AND the scenario clock stops
 *     (COR-050). Participants notice — so selecting it is GUARDED by a
 *     deliberate confirm step in `<PausePill>` (NOT a Director role-gate; that
 *     pattern belongs to Break Fiction, story 04).
 * Selecting a tier — or Resume (`'running'`) — replaces the prior one.
 *
 * ## Clock: the safety invariant — stops on Freeze, and ONLY on Freeze
 * The FIRST Freeze installs the feature-local `pausableExerciseClock` via the
 * SHIPPED `setExerciseClock()` and calls `freeze()`, so the `staff-shell`
 * header SCENARIO clock stops immediately (the clock notifies its subscribers,
 * which `useScenarioTime` observes). Leaving Freeze calls `resume()` and LEAVES
 * the pausable clock installed — resetting to the wall-mirroring default would
 * jump scenario time forward by the frozen span; keeping it installed preserves
 * the accumulated-frozen offset so Resume loses zero scenario time (see
 * `pausableExerciseClock.ts`). Injects-paused / engine-paused NEVER call
 * `setExerciseClock`/`freeze`/`resume`: under them `scenarioNow()` advances
 * exactly as when running.
 *
 * ## Shared, ambient state (a module store)
 * Pause is a single world-state fact, not per-component: the tier the header
 * pill shows and the tier `<PausePill>` drives MUST be the same value. So the
 * tier + overlay-register live in a module-level store read via
 * `useSyncExternalStore` (the same store shape `postStore`/`reviewStore` use),
 * not `useState`. The pausable clock is likewise a single ambient instance.
 *
 * ## Telemetry (XC-004)
 * EVERY tier change — including the transition back to `running` — emits ONE
 * `steering_action` event via the caller-safe `buildAndEmit` (never throws into
 * the action): `channel: 'system'`, `actor: { kind: 'system', actingHumanId,
 * role }`, `target: { entityType: 'exercise', entityId }`, `payload` naming the
 * transition. `exerciseId`/`timeZone` are STAMPING-ONLY (COR-001), sourced from
 * `useExerciseContext()`; the acting human from `useControllerIdentity()`
 * (COR-018), the role from `useRole()`. Staff-only (XC-002).
 *
 * ## Overlay register (seam only)
 * `overlayRegister` (`'in-fiction' | 'out-of-fiction'`) is exposed alongside the
 * tier as the value `participant-shell`'s (deferred) trigger wiring will read to
 * pick which register the pause/EndEx overlay renders in. This story does NOT
 * call `OverlayLayer`/`overlayState.ts` — it only exposes the value + setter.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { setExerciseClock } from '@/core/clock'
import { buildAndEmit } from '@/core/telemetry'
import { wallClockNowIso } from '@/core/time/wallClock'
import { scenarioNow } from '@/core/clock'
import { useExerciseContext } from '@/core/exerciseContext'
import { useRole } from '@/core/auth'
import { useControllerIdentity } from '../identity/controllerIdentity'
import { pausableExerciseClock } from '../services/pausableExerciseClock'

/** The active pause tier. Exactly one is active at a time. */
export type PauseTier = 'running' | 'injects' | 'engine' | 'freeze'

/** The participant-visible pill label for each tier (NFR-001: text, not colour). */
export type PauseLabel = 'RUNNING' | 'INJECTS PAUSED' | 'ENGINE PAUSED' | 'WORLD FROZEN'

/**
 * Which register `participant-shell` renders a triggered overlay in — an
 * in-fiction holding screen vs. an out-of-fiction (breaks-the-fiction) page.
 * Exposed as a seam value only; this story does not render the overlay.
 */
export type OverlayRegister = 'in-fiction' | 'out-of-fiction'

/** The label shown for each tier — never colour-only (NFR-001). */
export const PAUSE_TIER_LABELS: Readonly<Record<PauseTier, PauseLabel>> = {
  running: 'RUNNING',
  injects: 'INJECTS PAUSED',
  engine: 'ENGINE PAUSED',
  freeze: 'WORLD FROZEN',
}

/** What `usePauseState()` exposes to the console + the header pill. */
export interface PauseState {
  /** The active tier. */
  readonly tier: PauseTier
  /** The active tier's display label (INJECTS PAUSED / ENGINE PAUSED / WORLD FROZEN / RUNNING). */
  readonly label: PauseLabel
  /** Whether any pause tier is active (i.e. `tier !== 'running'`). */
  readonly isPaused: boolean
  /** Whether the world (and the scenario clock) is frozen. */
  readonly isFrozen: boolean
  /**
   * The overlay register a deferred `participant-shell` trigger will read.
   * Seam value only — this story does not render the overlay.
   */
  readonly overlayRegister: OverlayRegister
  /** Selects a tier (or `'running'` to Resume), replacing the prior one. */
  readonly setTier: (tier: PauseTier) => void
  /** Convenience: `setTier('running')`. */
  readonly resume: () => void
  /** Sets the overlay register the deferred participant-shell trigger will read. */
  readonly setOverlayRegister: (register: OverlayRegister) => void
}

// ---------------------------------------------------------------------------
// Module store — one ambient pause fact shared by every consumer
// ---------------------------------------------------------------------------

interface PauseStoreState {
  readonly tier: PauseTier
  readonly overlayRegister: OverlayRegister
}

/** A completed tier transition, returned so the hook can emit telemetry with context. */
export interface PauseTransition {
  readonly from: PauseTier
  readonly to: PauseTier
}

let storeState: PauseStoreState = { tier: 'running', overlayRegister: 'out-of-fiction' }
const storeListeners = new Set<() => void>()

function emitStoreChange(): void {
  storeListeners.forEach(listener => listener())
}

function subscribeStore(listener: () => void): () => void {
  storeListeners.add(listener)
  return () => {
    storeListeners.delete(listener)
  }
}

function getStoreSnapshot(): PauseStoreState {
  return storeState
}

/**
 * Drives the tier + the clock (the non-React core, unit-testable without a
 * component). Returns the transition, or `null` when the tier is unchanged so
 * the caller emits no duplicate telemetry.
 *
 * SAFETY: the clock is touched on Freeze and ONLY Freeze. Entering `freeze`
 * installs the pausable clock and freezes it; leaving `freeze` resumes it (and
 * leaves it installed, preserving the offset). Every other transition leaves
 * `scenarioNow()` advancing.
 */
function applyTier(next: PauseTier): PauseTransition | null {
  const from = storeState.tier
  if (from === next) return null

  if (next === 'freeze') {
    setExerciseClock(pausableExerciseClock)
    pausableExerciseClock.freeze()
  } else if (from === 'freeze') {
    pausableExerciseClock.resume()
  }

  storeState = { ...storeState, tier: next }
  emitStoreChange()
  return { from, to: next }
}

function applyOverlayRegister(register: OverlayRegister): void {
  if (storeState.overlayRegister === register) return
  storeState = { ...storeState, overlayRegister: register }
  emitStoreChange()
}

/**
 * TEST-ONLY reset: returns the module store + ambient clock to the `running`
 * baseline between tests. Not for production — production has one long-lived
 * ambient pause fact per runtime.
 */
export function resetPauseStateForTest(): void {
  if (storeState.tier === 'freeze') pausableExerciseClock.resume()
  storeState = { tier: 'running', overlayRegister: 'out-of-fiction' }
  emitStoreChange()
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/**
 * The tiered-pause primitive. Reads the shared ambient pause fact and exposes
 * the tier, its label, the overlay-register seam, and the setters — every tier
 * change (incl. back to `running`) emits ONE `steering_action` telemetry event.
 * Must be called under an `<ExerciseContextProvider>` + `SessionProvider`
 * (fail-closed via `useExerciseContext()`/`useRole()`).
 */
export function usePauseState(): PauseState {
  const { exerciseId, timeZone } = useExerciseContext()
  const { actingHumanId } = useControllerIdentity()
  const role = useRole()

  const state = useSyncExternalStore(subscribeStore, getStoreSnapshot, getStoreSnapshot)

  const emitTierChange = useCallback(
    (transition: PauseTransition) => {
      buildAndEmit({
        exerciseId,
        eventType: 'steering_action',
        channel: 'system',
        actor: { kind: 'system', actingHumanId, role },
        wallClockTime: wallClockNowIso(),
        scenarioTime: scenarioNow().toISOString(),
        timeZone,
        target: { entityType: 'exercise', entityId: exerciseId },
        payload: {
          action: 'pause-tier',
          from: transition.from,
          to: transition.to,
          label: PAUSE_TIER_LABELS[transition.to],
        },
      })
    },
    [exerciseId, timeZone, actingHumanId, role],
  )

  const setTier = useCallback(
    (next: PauseTier) => {
      const transition = applyTier(next)
      if (transition) emitTierChange(transition)
    },
    [emitTierChange],
  )

  const resume = useCallback(() => setTier('running'), [setTier])

  const setOverlayRegister = useCallback((register: OverlayRegister) => {
    applyOverlayRegister(register)
  }, [])

  return useMemo<PauseState>(
    () => ({
      tier: state.tier,
      label: PAUSE_TIER_LABELS[state.tier],
      isPaused: state.tier !== 'running',
      isFrozen: state.tier === 'freeze',
      overlayRegister: state.overlayRegister,
      setTier,
      resume,
      setOverlayRegister,
    }),
    [state.tier, state.overlayRegister, setTier, resume, setOverlayRegister],
  )
}
