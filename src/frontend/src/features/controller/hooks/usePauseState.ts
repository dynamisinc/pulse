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
 * ## MOCK <-> LIVE (story 07 — server-authoritative pause)
 * Behind the ONE `USE_MOCK_DATA` flag (`@/core/config/mockData`), mirroring
 * `useReviewQueue`'s split:
 *   - **mock** (dev/UAT, and every story-03 test): UNCHANGED — the tier lives in
 *     the module store below and Freeze installs the browser-local
 *     `pausableExerciseClock`. No backend call is made.
 *   - **live** (`USE_MOCK_DATA === false`): the tier flip is still optimistic and
 *     local (the console must respond instantly), and ADDITIONALLY
 *     `livePauseTierActions.setPauseTier` POSTs `/api/steering/pause-tier`, where
 *     the backend records the tier and, on the `freeze` transition, calls the
 *     native `IExerciseClock.Freeze`/`Unfreeze` — the clock
 *     `ReactionLoopHost.TickExerciseAsync` already checks (`IsFrozen`) to skip a
 *     tick, so a Freeze genuinely halts the engine. On REJECTION the optimistic
 *     flip is reverted **unless a newer transition has superseded it** (the same
 *     guarded revert `useEngineControl.setMode` uses, #337): the console must
 *     never claim WORLD FROZEN when the world is still running, and a stale
 *     rejection must never clobber a newer toggle. A freshly mounted console
 *     also RESYNCS once via `fetchPauseTier()` so it adopts the tier the
 *     exercise is actually in instead of assuming `running`.
 *
 * ## ENGINE PAUSED is the #337 kill switch (a FRONTEND-only unification)
 * `usePauseState()` composes `useEngineControl()` internally (both hooks are
 * called unconditionally on every render) and calls its `setMode('stop')` when
 * the `engine` tier is ENTERED and `setMode('live')` when it is LEFT — so the
 * tier pill and `<EngineControlBar>` read the ONE `engineControlStore` module
 * singleton and can never contradict each other about whether the engine is
 * stopped. There is deliberately NO new backend engine-control endpoint: this
 * reuses the shipped `kill-switch`/`restore` wiring.
 *
 * KNOWN GAPS (accepted, story 07 "Out of Scope"): Pause engine always sets
 * `'stop'` and leaving it always sets `'live'`, so a controller who had manually
 * chosen SUGGEST-ONLY before pausing loses that nuance. `engine -> freeze` keeps
 * the engine stopped (a stronger pause must not restart it), and `freeze ->
 * running` never touches the kill switch, so a Freeze reached from Pause-engine
 * leaves the switch where Pause-engine put it until a controller raises it
 * explicitly on `<EngineControlBar>` (safety only ever un-stops on an explicit
 * human action, §8.2).
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
 * `steering_action` event in BOTH modes, with the SHAPE UNCHANGED from story 03.
 * Story 07 deliberately does NOT duplicate it now that a live POST also fires:
 * the backend endpoint emits no telemetry of its own, so this remains the single
 * audit record of a pause action (and it stands even if the POST later rejects
 * and the optimistic flip is reverted — the attempted change was real). A
 * server-sourced RESYNC adopt is not a controller action and emits nothing (the
 * controller who caused it already logged it).
 *
 * It is emitted via the caller-safe `buildAndEmit` (never throws into
 * the action): `channel: 'system'`, `actor: { kind: 'system', actingHumanId,
 * role }`, `target: { entityType: 'exercise', entityId }`, `payload` naming the
 * transition. `exerciseId`/`timeZone` are STAMPING-ONLY (COR-001), sourced from
 * `useExerciseContext()`; the acting human AND role from `useControllerIdentity()`
 * (COR-018; the console's operating identity is the controller-identity seam, not
 * a `SessionProvider`/`useRole()` read — staff routes mount no session, and the
 * mock session is a participant, so `useControllerIdentity().role` (`'controller'`)
 * is the correct, SessionProvider-free actor role, matching `reviewActions.ts`).
 * Staff-only (XC-002).
 *
 * ## Overlay register (seam only)
 * `overlayRegister` (`'in-fiction' | 'out-of-fiction'`) is exposed alongside the
 * tier as the value `participant-shell`'s (deferred) trigger wiring will read to
 * pick which register the pause/EndEx overlay renders in. This story does NOT
 * call `OverlayLayer`/`overlayState.ts` — it only exposes the value + setter.
 */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { setExerciseClock } from '@/core/clock'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { buildAndEmit } from '@/core/telemetry'
import { wallClockNowIso } from '@/core/time/wallClock'
import { scenarioNow } from '@/core/clock'
import { useExerciseContext } from '@/core/exerciseContext'
import { useControllerIdentity } from '../identity/controllerIdentity'
import { useEngineControl, type EngineMode } from '../engine/hooks/useEngineControl'
import { pausableExerciseClock } from '../services/pausableExerciseClock'
import { fetchPauseTier, setPauseTier } from '../services/livePauseTierActions'

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
 * The engine-tier -> kill-switch mapping (the #337 unification). Entering the
 * `engine` tier STOPS the engine; leaving it for a weaker tier restores it to
 * live. Leaving it for `freeze` deliberately keeps the engine stopped — a
 * stronger pause must never restart generation. See the module header's KNOWN
 * GAPS for the accepted suggest-only / `freeze -> running` nuances.
 */
function applyEngineTierMode(
  transition: PauseTransition,
  setEngineMode: (mode: EngineMode) => void,
): void {
  if (transition.to === 'engine') {
    setEngineMode('stop')
  } else if (transition.from === 'engine' && transition.to !== 'freeze') {
    setEngineMode('live')
  }
}

/**
 * Whether the live-mode one-shot resync GET has already been kicked off for this
 * runtime — `usePauseState()` is mounted by more than one surface (the pill and
 * the header), and only ONE of them should read the server tier (mirrors
 * `liveReviewStore.ensureStarted`'s idempotence).
 */
let resyncStarted = false

/**
 * TEST-ONLY reset: returns the module store + ambient clock to the `running`
 * baseline between tests. Not for production — production has one long-lived
 * ambient pause fact per runtime.
 */
export function resetPauseStateForTest(): void {
  if (storeState.tier === 'freeze') pausableExerciseClock.resume()
  storeState = { tier: 'running', overlayRegister: 'out-of-fiction' }
  resyncStarted = false
  emitStoreChange()
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/**
 * The tiered-pause primitive. Reads the shared ambient pause fact and exposes
 * the tier, its label, the overlay-register seam, and the setters — every tier
 * change (incl. back to `running`) emits ONE `steering_action` telemetry event.
 * Must be called under an `<ExerciseContextProvider>` (fail-closed via
 * `useExerciseContext()`/`useControllerIdentity()`).
 */
export function usePauseState(): PauseState {
  const { exerciseId, timeZone } = useExerciseContext()
  const { actingHumanId, role } = useControllerIdentity()

  // The #337 kill switch — composed, not duplicated, so ENGINE PAUSED and
  // <EngineControlBar> read the ONE engineControlStore snapshot (see header).
  const { setMode: setEngineMode } = useEngineControl()

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
      if (!transition) return

      // ONE steering_action per transition, in BOTH modes, shape unchanged from
      // story 03 — logged BEFORE any POST so the attempted change is recorded
      // even if the POST later rejects and the optimistic flip is reverted.
      emitTierChange(transition)

      // ENGINE PAUSED drives the SAME kill switch <EngineControlBar> drives.
      applyEngineTierMode(transition, setEngineMode)

      if (USE_MOCK_DATA) return

      // Live: make the tier SERVER-authoritative (and, on Freeze, actually stop
      // the reaction loop via the native clock). On rejection, revert the
      // optimistic flip — but ONLY if our tier is still the live one: a newer
      // transition supersedes us and owns the tier, so a stale rejection can
      // never clobber a newer toggle (mirrors useEngineControl.setMode, #337).
      setPauseTier(next, { actingHumanId, timeZone }).catch(() => {
        if (getStoreSnapshot().tier !== transition.to) return
        const reverted = applyTier(transition.from)
        if (reverted) applyEngineTierMode(reverted, setEngineMode)
      })
    },
    [emitTierChange, setEngineMode, actingHumanId, timeZone],
  )

  // Live path only: resync ONCE from the server so a freshly mounted console
  // adopts the tier the exercise is actually in (including a Freeze another
  // controller applied) instead of assuming `running`. Idempotent across the
  // multiple surfaces that mount this hook. A server-sourced adopt is not a
  // controller action: it emits NO telemetry and fires NO POST, but it DOES
  // apply the tier's local effects (the pausable clock, the kill switch) so the
  // console never contradicts the server. No-op under mock data.
  useEffect(() => {
    if (USE_MOCK_DATA || resyncStarted) return
    resyncStarted = true
    fetchPauseTier()
      .then(serverTier => {
        const adopted = applyTier(serverTier)
        if (adopted) applyEngineTierMode(adopted, setEngineMode)
      })
      .catch(() => {
        // A failed/unrecognised resync leaves the local baseline untouched —
        // never a guessed tier. The controller's own next action is authoritative.
      })
  }, [setEngineMode])

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
