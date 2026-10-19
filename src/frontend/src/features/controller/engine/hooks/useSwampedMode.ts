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
 * GATE. `isLead` is the real session's server-computed flag (`Session.isLead`, via
 * `usePermissions().can('raiseAutonomy')` = controller AND lead; story 17 replaced the Phase-1
 * mock `useControllerIdentity().isLead`). `setSwampedMode(true)`
 * is a NO-OP — rejected, not recorded as enabled, no telemetry emitted — when
 * `!isLead`. Disabling is not gated (there is nothing unsafe about a
 * controller turning auto-send back OFF).
 *
 * SERVER-DRIVEN (PROVIDER-GOVERNANCE §8). The flag is read from the engine settings
 * (`settings.autonomy.swampedMode`; off while unknown) and changed ONLY through
 * `useEngineSettings.setSwampedMode` — a serialized, non-optimistic POST followed by
 * a settings re-read. `pending`/`error` expose the in-flight and refusal states.
 *
 * PER-EXERCISE SCOPE (COR-001). The settings store is KEYED BY `exerciseId`, so a
 * remount under a different exercise reads a different flag; no client exerciseId
 * is sent (the server scopes by session).
 *
 * OUTPUT CONTRACT. The `swampedMode` boolean this hook returns is exactly the
 * value story 02's `useDraftTimer` consumes as an INPUT PARAMETER (wired at
 * integration) — this file has no import of, and no dependency on, that hook
 * (file-disjoint parallel build, implementation.md).
 *
 * TELEMETRY (ADP-041/§11, XC-004). The server records none (tracked in #618), so the
 * client emits ONE event per enable/disable the SERVER CONFIRMS (a 200 whose body's
 * `swampedMode` equals the request; never a refusal). It is AT-LEAST-ONCE and BEST-EFFORT:
 * the no-op guard reads a view that may be up to one poll interval stale, so two
 * controllers acting on the same stale view can each log a change. The event goes out via
 * the caller-safe `buildAndEmit`: `channel: 'system'`, `actor {
 * kind: 'engine', actingHumanId }` (the toggling controller), `eventType`
 * `'engine.swamped_mode_changed'` (an open string — no envelope migration),
 * carrying scenario time (COR-053) and the resulting state in `payload`.
 */

import { useCallback, useEffect, useState } from 'react'
import { scenarioNow } from '@/core/clock'
import { useExerciseContext } from '@/core/exerciseContext'
import { buildAndEmit } from '@/core/telemetry'
import { wallClockNowIso } from '@/core/time/wallClock'
import { usePermissions, useOptionalSession } from '@/core/auth'
import { useControllerIdentity } from '../../identity/controllerIdentity'
import { engineSettingsStore, useEngineSettings } from './useEngineSettings'

// ---------------------------------------------------------------------------
// The store — a read-only VIEW over the engine-settings store (server truth)
// ---------------------------------------------------------------------------

/**
 * Swamped mode no longer has its own browser-local state: it is the SERVER's
 * `settings.autonomy.swampedMode`, held per exercise by `useEngineSettings`'s store.
 * This view keeps the old test/diagnostic seam (`getSnapshot`/`subscribe`/
 * `resetForTests`) and reads off when settings are unknown (the safe default).
 */
export const swampedModeStore = {
  getSnapshot: (exerciseId: string): boolean =>
    engineSettingsStore.getSnapshot(exerciseId).settings?.autonomy.swampedMode ?? false,
  subscribe: engineSettingsStore.subscribe,
  resetForTests: engineSettingsStore.resetForTests,
}

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
  /** Any settings request (incl. this one's POST + re-read) is in flight — disable the control. */
  readonly pending: boolean
  /** The last server refusal/failure message (400/403/...), or `null`. */
  readonly error: string | null
  /**
   * The console's view of the server may be out of date: 2+ consecutive failed refreshes, or
   * no applied settings GET for over {@link STALE_AFTER_MS} while the tab is visible. Clears on
   * the next applied GET.
   */
  readonly stale: boolean
  /** Wall-clock ms of the last applied settings GET (staff-only), or `null` if none. */
  readonly lastConfirmedAt: number | null
}

/** Consecutive failed refreshes after which the console flags itself stale. */
export const STALE_FAILURE_COUNT = 2
/** No applied GET for longer than this (tab visible) flags the console stale. */
export const STALE_AFTER_MS = 60_000
const STALE_TICK_MS = 15_000

/**
 * The per-exercise, lead-gated swamped-mode flag. See the module header for
 * the full contract.
 */
export function useSwampedMode(): UseSwampedModeResult {
  const identity = useControllerIdentity()
  // Story 17: the lead flag is the SERVER's (`Session.isLead`, read live per request), never the
  // mock identity's. Raising is lead-only; lowering is open to every controller.
  const { can } = usePermissions()
  // Telemetry actor = the signed-in person; the mock identity is only a fallback (null personId).
  const actingHumanId = useOptionalSession()?.personId ?? identity.actingHumanId
  const isLead = can('raiseAutonomy')
  const { exerciseId, timeZone } = useExerciseContext()

  const engine = useEngineSettings()
  const { settings, swampedError, setSwampedMode: requestSwampedMode } = engine
  // Serialized store: the control is unavailable while ANY settings request is in flight.
  const pending =
    engine.pendingSwampedMode ||
    engine.loading ||
    engine.pendingAutonomyDefault ||
    engine.pendingTierPolicy ||
    engine.pendingProviderLever ||
    engine.pendingAmbientPolicy
  // Unknown (settings not loaded) is OFF — the safe default.
  const swampedMode = settings?.autonomy.swampedMode ?? false

  // Staleness: re-evaluated on a short tick (and when the tab becomes visible) so a hung or
  // silently failing refresh is flagged even though nothing else re-renders.
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const refreshNow = () => {
      if (document.visibilityState !== 'hidden') setNowMs(Date.now())
    }
    const id = window.setInterval(refreshNow, STALE_TICK_MS)
    document.addEventListener('visibilitychange', refreshNow)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', refreshNow)
    }
  }, [])
  const lastConfirmedAt = engine.lastAppliedAt
  const stale =
    engine.refreshFailures >= STALE_FAILURE_COUNT ||
    (lastConfirmedAt !== null && nowMs - lastConfirmedAt > STALE_AFTER_MS)

  const setSwampedMode = useCallback(
    (next: boolean) => {
      // The sole client-side safety gate (ADP-040): a non-lead can never ENABLE swamped
      // mode — no request is sent. (The server enforces it too.)
      if (next && !isLead) {
        return
      }
      if (swampedMode === next) {
        return
      }

      requestSwampedMode(next, actingHumanId, applied => {
        // Emit only when the server's 200 body confirms the value we asked for.
        if (applied !== next) return
        buildAndEmit({
          exerciseId,
          eventType: 'engine.swamped_mode_changed',
          channel: 'system',
          actor: { kind: 'engine', actingHumanId },
          origin: 'engine',
          wallClockTime: wallClockNowIso(),
          scenarioTime: scenarioNow().toISOString(),
          timeZone,
          target: { entityType: 'exercise', entityId: exerciseId },
          payload: { action: next ? 'swamped-mode-enabled' : 'swamped-mode-disabled' },
        })
      })
    },
    [exerciseId, timeZone, isLead, actingHumanId, swampedMode, requestSwampedMode],
  )

  return {
    swampedMode,
    isLead,
    setSwampedMode,
    pending,
    error: swampedError,
    stale,
    lastConfirmedAt,
  }
}
