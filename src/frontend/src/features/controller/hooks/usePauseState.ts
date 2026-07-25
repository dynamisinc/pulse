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
 *     tick, so a Freeze genuinely halts the engine.
 *
 * ## THE INVARIANT: never render a pause the server did not apply
 * A control that reports a state the server never applied is the failure this
 * story exists to eliminate, so the live path VERIFIES rather than assumes:
 *   - the POST resolves with the server's own `{ tier, clockFrozen }` (read off
 *     the native clock), and a Freeze that comes back `clockFrozen: false` — or
 *     a `409`, which the backend returns when it could not reach the clock at
 *     all — makes the console settle on the server's tier instead;
 *   - a FAILED POST tells us nothing about what the server did (the request may
 *     have been applied and only its response lost — a proxy 502/504, which is a
 *     documented UAT cold-start mode), so the console does not guess: it re-GETs
 *     and adopts the authoritative tier, undoing its own flip only if that read
 *     fails too. Blind-reverting a Resume whose response was lost would put
 *     WORLD FROZEN back on screen over a ticking engine;
 *   - superseding is tracked by SEQUENCE, not by tier value: values repeat, so
 *     `freeze -> running -> freeze -> running` would otherwise let the first
 *     request's late failure match the third transition's tier and clobber it
 *     minutes later (`core/services/api.ts` sets no axios timeout);
 *   - the kill-switch POST the `engine` tier fires is a SECOND, independent
 *     request, so its failure reverts the TIER too (via `setMode`'s
 *     `onRejected`) — otherwise the bar would snap back to LIVE under a pill
 *     still reading ENGINE PAUSED;
 *   - every revert is GUARDED: it applies only while our own tier is still the
 *     live one, so a stale failure can never clobber a newer toggle (the same
 *     rule `useEngineControl.setMode` uses, #337);
 *   - a freshly mounted console RESYNCS once via `fetchPauseTier()`, adopting
 *     the tier the exercise is actually in — but never a freeze the server
 *     reports as unapplied, and never over a choice the controller has already
 *     made while the GET was in flight.
 *
 * ## ENGINE PAUSED is the #337 kill switch (a FRONTEND-only unification)
 * `usePauseState()` composes `useEngineControl()` internally (both hooks are
 * called unconditionally on every render) and calls its `setMode('stop')` when
 * the `engine` tier is ENTERED — so the tier pill and `<EngineControlBar>` read
 * the ONE `engineControlStore` module singleton and can never contradict each
 * other about whether the engine is stopped. There is deliberately NO new
 * backend engine-control endpoint: this reuses the shipped
 * `kill-switch`/`restore` wiring.
 *
 * Leaving the tier RESTORES THE DISPLACED POSITION, not a hard-coded `'live'`:
 * entering remembers whatever the kill switch was on (`engineModeBeforePause`)
 * and any exit weaker than `freeze` puts it back. So a controller who had chosen
 * SUGGEST-ONLY gets SUGGEST-ONLY back (never an automatic autonomy RAISE, §8.2
 * "only humans raise"), and `engine -> freeze -> running` cannot strand the bar
 * at STOP under a pill reading RUNNING. `engine -> freeze` itself keeps the
 * engine stopped and carries the debt forward — a stronger pause must never
 * restart generation.
 *
 * KNOWN GAP (accepted): `freeze` entered directly from `running`/`injects` does
 * not itself stop the engine via the kill switch — the world freeze halts the
 * reaction loop through the scenario clock instead (`IsFrozen`), which is the
 * server-side enforcement AC1/AC2 specify.
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
 * `steering_action` event in BOTH modes, with the SHAPE UNCHANGED from story 03
 * apart from an additive `payload.outcome`.
 *
 * **The one two-event case (AC-7 "exactly one per transition", refined).** An
 * APPLIED transition is exactly one event, `payload.outcome: 'applied'`. When a
 * transition does NOT stand — the server refused the Freeze, or its outcome was
 * unknown and the authoritative read disagreed — the console emits a SECOND event
 * for the correcting transition with `payload.outcome: 'reverted'` and
 * `reverted: true`. That is deliberate: for a story whose thesis is "never report
 * a pause the server did not apply", an audit trail that shows WORLD FROZEN for a
 * refused freeze and then silently corrects the screen would be the same lie moved
 * into the AAR. The pair is self-describing — never a silent correction, and never
 * a duplicate of the same transition.
 * Story 07 deliberately does NOT duplicate it now that a live POST also fires:
 * the backend endpoint emits no telemetry of its own, so this remains the single
 * audit record of a pause action (and it stands even if the POST later rejects
 * and the optimistic flip is reverted — the attempted change was real). A
 * server-sourced RESYNC adopt is not a controller action and emits nothing at
 * all — not the `steering_action`, and not the `engine.autonomy_changed` a
 * `setMode` call would log: it reflects the engine stop through
 * `engineControlStore.adoptServerMode` precisely so no safety action is ever
 * attributed to a human who did not take it (COR-018).
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
 * ## Overlay register — NOW LIVE (world-steering story 08)
 * `overlayRegister` (`'in-fiction' | 'out-of-fiction'`) is exposed alongside the
 * tier and picks which register a Freeze's participant holding page renders in
 * — in-fiction "We'll be right back" (the fiction preserved) vs out-of-fiction
 * "EXERCISE PAUSED" (the fiction deliberately broken). In LIVE mode the
 * currently-selected value is SENT with every pause-tier POST, so the server's
 * overlay publisher pushes the register the controller actually chose; this hook
 * still never imports `OverlayLayer`/`overlayState.ts` (the participant surface
 * reads its own state — the two worlds stay separate). Server-side it is
 * validated, not trusted: anything but `'in-fiction'` is coerced to
 * `'out-of-fiction'`, the conservative default, and it influences nothing but
 * the overlay copy. Under mock data nothing is sent at all (unchanged).
 *
 * KNOWN LIMITATION (accepted, not an AC): the register is carried by a tier
 * TRANSITION, so changing the selection WHILE already frozen does not re-push —
 * participants keep the register that was selected when the Freeze landed until
 * the next transition.
 */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { setExerciseClock } from '@/core/clock'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { buildAndEmit } from '@/core/telemetry'
import { wallClockNowIso } from '@/core/time/wallClock'
import { scenarioNow } from '@/core/clock'
import { useExerciseContext } from '@/core/exerciseContext'
import { useControllerIdentity } from '../identity/controllerIdentity'
import {
  engineControlStore,
  useEngineControl,
  type EngineMode,
  type SetEngineModeOptions,
} from '../engine/hooks/useEngineControl'
import { pausableExerciseClock } from '../services/pausableExerciseClock'
import {
  fetchPauseTier,
  setPauseTier,
  type PauseTierServerState,
} from '../services/livePauseTierActions'

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

/**
 * How a tier transition ended, stamped on its `steering_action` payload:
 *   - `applied` — the controller's change took (the normal case);
 *   - `reverted` — an announced change did NOT stand and the console backed out
 *     (the server refused it, or its outcome was unknown and the authoritative
 *     read disagreed). Carries `reverted: true` alongside, so an AAR can never
 *     read a refused Freeze as a freeze that happened.
 */
export type PauseTierOutcomeTag = 'applied' | 'reverted'

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
 * The register selection to SEND with a live pause-tier POST (story 08) — read
 * from the module store at call time rather than closed over, so a request can
 * never carry a selection the controller has already changed.
 */
function currentOverlayRegister(): OverlayRegister {
  return storeState.overlayRegister
}

/**
 * The kill-switch position the pause machine displaced when it stopped the
 * engine, or `null` when it owes no restore. Non-null means "the `engine` tier
 * (possibly since escalated to `freeze`) is holding the engine stopped and must
 * put this position back on the way out" — so Resume restores the controller's
 * OWN pre-pause choice (e.g. SUGGEST-ONLY) rather than automatically raising the
 * engine to LIVE, and `engine -> freeze -> running` cannot leave the bar stuck
 * at STOP while the pill reads RUNNING.
 */
let engineModeBeforePause: EngineMode | null = null

/**
 * The engine-tier -> kill-switch mapping (the #337 unification). Entering the
 * `engine` tier STOPS the engine (remembering the displaced position); leaving it
 * for any tier weaker than `freeze` puts that position back. `engine -> freeze`
 * deliberately KEEPS the engine stopped — a stronger pause must never restart
 * generation — and carries the debt forward so the eventual Resume still
 * restores it.
 */
function applyEngineTierMode(
  exerciseId: string,
  transition: PauseTransition,
  setEngineMode: (mode: EngineMode, options?: SetEngineModeOptions) => void,
  onRejected?: () => void,
): void {
  if (transition.to === 'engine') {
    engineModeBeforePause ??= engineControlStore.getSnapshot(exerciseId).mode
    setEngineMode('stop', { onRejected })
    return
  }

  // Any tier that is not `engine` and not `freeze` means the pause machine no
  // longer holds the engine down — hand the controller's own position back.
  if (transition.to !== 'freeze' && engineModeBeforePause !== null) {
    const restore = engineModeBeforePause
    engineModeBeforePause = null
    setEngineMode(restore, { onRejected })
  }
}

/**
 * A tier change stamped with its position in this runtime's transition order.
 * Every in-flight request carries the sequence of the transition that started it,
 * and may only act while it is still the LATEST — comparing sequences rather than
 * tier VALUES, because values repeat: `freeze -> running -> freeze -> running`
 * would let the first request's late failure match the third transition's tier and
 * "revert" it minutes later (and `core/services/api.ts` sets no axios timeout, so
 * a hung request can outlive several toggles).
 */
interface SequencedTransition {
  readonly transition: PauseTransition
  readonly sequence: number
}

/** Monotonic, bumped by EVERY applied tier change — including reverts and adopts. */
let transitionSequence = 0

/** Applies a tier change and stamps it with the next sequence number. */
function applyTierSequenced(next: PauseTier): SequencedTransition | null {
  const transition = applyTier(next)
  if (!transition) return null
  return { transition, sequence: ++transitionSequence }
}

/** Whether `sequence` is still the newest transition — i.e. nothing has superseded it. */
function isLatest(sequence: number): boolean {
  return sequence === transitionSequence
}

/**
 * The tier the server's state ENTITLES the console to render. A recorded `freeze`
 * whose clock is not actually frozen is an inconsistent server state (the registry
 * refuses to record one), and rendering WORLD FROZEN off it would be the very lie
 * this story exists to eliminate — so it collapses to the closest honest tier.
 */
function authoritativeTier(server: PauseTierServerState): PauseTier {
  return server.tier === 'freeze' && !server.clockFrozen ? 'running' : server.tier
}

/**
 * Whether the live-mode one-shot resync GET has already been kicked off for this
 * runtime — `usePauseState()` is mounted by more than one surface (the pill and
 * the header), and only ONE of them should read the server tier (mirrors
 * `liveReviewStore.ensureStarted`'s idempotence).
 */
let resyncStarted = false

/**
 * Whether a CONTROLLER has driven a tier change in this runtime. The in-flight
 * resync GET checks this before adopting: a response that lands after the
 * controller has already acted is stale and must never overwrite their newer
 * choice (nor drive the pausable clock behind it) — the same supersede rule the
 * POST's guarded revert uses.
 */
let controllerActed = false

/**
 * TEST-ONLY reset: returns the module store + ambient clock to the `running`
 * baseline between tests. Not for production — production has one long-lived
 * ambient pause fact per runtime.
 */
export function resetPauseStateForTest(): void {
  if (storeState.tier === 'freeze') pausableExerciseClock.resume()
  storeState = { tier: 'running', overlayRegister: 'out-of-fiction' }
  resyncStarted = false
  controllerActed = false
  engineModeBeforePause = null
  transitionSequence = 0
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
    (transition: PauseTransition, outcome: PauseTierOutcomeTag = 'applied') => {
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
          outcome,
          ...(outcome === 'reverted' ? { reverted: true } : {}),
        },
      })
    },
    [exerciseId, timeZone, actingHumanId, role],
  )

  /**
   * Settles the console on the tier the SERVER says is true, as this console's own
   * correction of its own failed action — so the engine mode goes through the real
   * `setMode` (which POSTs + logs), not the silent adopt the mount resync uses.
   * Emits the WR-104 counter-event so the audit trail records that the announced
   * pause did not stand.
   */
  const settleFromServer = useCallback(
    (server: PauseTierServerState, sequence: number) => {
      if (!isLatest(sequence)) return
      const settled = applyTierSequenced(authoritativeTier(server))
      if (!settled) return
      emitTierChange(settled.transition, 'reverted')
      applyEngineTierMode(exerciseId, settled.transition, setEngineMode)
    },
    [emitTierChange, exerciseId, setEngineMode],
  )

  /**
   * Last resort when even the re-GET failed: undo our own optimistic flip. Guarded
   * by SEQUENCE, and carrying no `onRejected` so it cannot start a ping-pong.
   */
  const revertLocally = useCallback(
    (transition: PauseTransition, sequence: number) => {
      if (!isLatest(sequence)) return null
      const reverted = applyTierSequenced(transition.from)
      if (!reverted) return null
      emitTierChange(reverted.transition, 'reverted')
      applyEngineTierMode(exerciseId, reverted.transition, setEngineMode)
      return reverted
    },
    [emitTierChange, exerciseId, setEngineMode],
  )

  /**
   * A pause-tier POST that FAILED tells us nothing about what the server did —
   * the request may have been applied and only its response lost (a proxy
   * 502/504, a documented UAT cold-start mode). So don't guess: ASK. Adopt the
   * authoritative tier, and fall back to undoing our own flip only if that read
   * fails too.
   */
  const reconcileAfterFailure = useCallback(
    (transition: PauseTransition, sequence: number) => {
      if (!isLatest(sequence)) return
      fetchPauseTier()
        .then(server => settleFromServer(server, sequence))
        .catch(() => revertLocally(transition, sequence))
    },
    [settleFromServer, revertLocally],
  )

  const setTier = useCallback(
    (next: PauseTier) => {
      const applied = applyTierSequenced(next)
      if (!applied) return
      const { transition, sequence } = applied
      controllerActed = true

      // ONE steering_action per APPLIED transition, in BOTH modes, shape unchanged
      // from story 03 — logged BEFORE any POST so the attempted change is on the
      // record. If it turns out not to have stood, a second event marks that
      // explicitly (see `emitTierChange`'s `outcome`), never a silent correction.
      emitTierChange(transition)

      // ENGINE PAUSED drives the SAME kill switch <EngineControlBar> drives.
      // Entering the tier fires TWO independent requests (this kill-switch POST
      // and the pause-tier POST below), so the kill switch's own failure has to
      // revert the TIER too: nothing else backstops it — no reaction-loop
      // consumer reads the tier, so the kill switch is this tier's only
      // enforcement, and a bar that snapped back to LIVE under a pill still
      // reading ENGINE PAUSED is exactly the contradiction AC3 forbids.
      applyEngineTierMode(exerciseId, transition, setEngineMode, () => {
        const reverted = revertLocally(transition, sequence)
        if (!reverted || USE_MOCK_DATA) return

        // The pause-tier POST below may well have SUCCEEDED, leaving the server
        // holding a tier this console has now abandoned. Tell it we backed out —
        // otherwise story 08's overlay publisher shows participants a pause
        // nobody is claiming any more. Best effort: a failure here does NOT
        // revert again (that would be a ping-pong), and the local state already
        // matches what the controller can see.
        setPauseTier(reverted.transition.to, {
          actingHumanId,
          timeZone,
          overlayRegister: currentOverlayRegister(),
        }).catch(() => {})
      })

      if (USE_MOCK_DATA) return

      // Live: make the tier SERVER-authoritative (and, on Freeze, start-then-
      // freeze the native clock the reaction loop checks). The server's answer is
      // VERIFIED, not assumed: a Freeze that could not reach the clock comes back
      // as a 409 (rejection) or as `clockFrozen: false`, and either way the
      // console stops claiming WORLD FROZEN over a world that is still moving.
      // The selected overlay register rides along (story 08): the server's overlay
      // publisher pushes THIS register to participants, so the controller's choice
      // between the in-fiction and out-of-fiction holding page actually takes.
      setPauseTier(next, { actingHumanId, timeZone, overlayRegister: currentOverlayRegister() })
        .then(server => {
          if (!isLatest(sequence)) return
          const serverAppliedIt =
            server.tier === next && (next !== 'freeze' || server.clockFrozen)
          // We already hold the server's authoritative word — settle on it
          // directly rather than spending another round trip.
          if (!serverAppliedIt) settleFromServer(server, sequence)
        })
        .catch(() => reconcileAfterFailure(transition, sequence))
    },
    [
      emitTierChange,
      exerciseId,
      setEngineMode,
      revertLocally,
      settleFromServer,
      reconcileAfterFailure,
      actingHumanId,
      timeZone,
    ],
  )

  // Live path only: resync ONCE from the server so a freshly mounted console
  // adopts the tier the exercise is actually in (including a Freeze another
  // controller applied) instead of assuming `running`. Idempotent across the
  // multiple surfaces that mount this hook. No-op under mock data.
  //
  // A server-sourced adopt is NOT a controller action, so it emits no telemetry
  // and issues no POST — including for the engine tier, where it reflects the
  // stop through `engineControlStore.adoptServerMode` (a silent local write)
  // instead of `setMode`, which would log an `engine.autonomy_changed` safety
  // action attributed to THIS console's acting human for something they never
  // did (COR-018/XC-004 accuracy) and re-issue a kill-switch command nobody
  // gave. It still applies the tier's local effects (the pausable clock, the
  // bar's position) so the console never contradicts the server.
  useEffect(() => {
    if (USE_MOCK_DATA || resyncStarted) return
    resyncStarted = true
    fetchPauseTier()
      .then(server => {
        // Superseded: the controller acted while the GET was in flight. Their
        // choice is newer than this snapshot — never overwrite it.
        if (controllerActed) return

        // Never adopt a freeze the server itself reports as not applied.
        const adopted = applyTierSequenced(authoritativeTier(server))
        if (!adopted) return

        if (adopted.transition.to === 'engine') {
          // KNOWN GAP (world-steering follow-up, out of scope here): a FRESH
          // console has no memory of the position another controller's
          // Pause-engine displaced, so `engineModeBeforePause` seeds from this
          // runtime's own default ('live'). A later Resume from this console can
          // therefore restore 'live' over a suggest-only that predated it. Fixing
          // it needs the kill-switch position itself to be server-authoritative
          // (the frontend/backend autonomy-model alignment tracked separately),
          // not more local memory.
          engineModeBeforePause ??= engineControlStore.getSnapshot(exerciseId).mode
          engineControlStore.adoptServerMode(exerciseId, 'stop')
        }
      })
      .catch(() => {
        // A failed/unrecognised resync leaves the local baseline untouched —
        // never a guessed tier. The controller's own next action is authoritative.
      })
  }, [exerciseId])

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
