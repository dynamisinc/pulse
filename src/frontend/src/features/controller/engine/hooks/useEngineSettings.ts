/**
 * features/controller/engine/hooks/useEngineSettings.ts
 * ---------------------------------------------------------------------------
 * The engine SETTINGS read/write hook (feature: autonomy-safety, story 06;
 * ADP-025/NFR-005, COR-001, COR-018, D5 §2 "Engine control"). STAFF world —
 * pure hook, no UI, no COBRA.
 *
 * The SINGLE SOURCE both `<EngineSettingsPanel>` (this story) and
 * `<EngineControlBar>`'s "Live" label read — see this module's role in fixing
 * the audit finding named in `docs/features/autonomy-safety/06-engine-
 * settings-panel.md`'s Context: `EngineControlBar`'s always-visible LIVE
 * position used to unconditionally imply Delayed-auto autonomy
 * (`useEngineControl.ts`'s `deriveEffective`) while the real backend exercise
 * default has been permanently Suggest. This hook is the first cockpit
 * consumer to actually read story 05's `GET /api/engine/settings` — its
 * `effectiveLevel` is the value any consumer must label the posture from
 * (WR-003); this hook never re-derives it from `exerciseDefaultLevel` +
 * `safetyClampActive` itself, it is read verbatim off the server response.
 *
 * MOCK <-> LIVE (`USE_MOCK_DATA`, `@/core/config/mockData`). Mock renders a
 * plausible static snapshot with NO network call, matching every other engine
 * hook's mock/live split — `MOCK_ENGINE_SETTINGS` mirrors story 05's actual
 * shipped default (healthy, Suggest base, `auto` tier policy). Live fetches
 * `GET /api/engine/settings` once per exercise (idempotent — a second mounted
 * consumer does not refire the GET) and starts real POSTs for the two
 * mutations.
 *
 * OPTIMISTIC, REVERT-ON-REJECTION (the single most important behaviour in
 * this story). `setAutonomyDefault`/`setTierPolicyMode` update ONLY the field
 * the caller asked to change — never a guessed `effectiveLevel`, EXCEPT the
 * one safe inference the backend's own contract already guarantees: setting
 * a new base default while NO safety clamp is active means the server will
 * echo that exact value back as `effectiveLevel` too (AC2 of story 05 — a
 * clamp only ever suppresses a RAISE, so an unclamped base flip and its
 * effective level move together). While a clamp IS active, `effectiveLevel`
 * is left untouched by the optimistic patch (never guessed at) until the
 * server's own response reconciles it. In LIVE mode, on success, the ENTIRE
 * settings object is replaced by the authoritative response (all three
 * endpoints share one wire shape — no follow-up GET needed, story 05's
 * contract). On rejection, the optimistic patch is reverted to its prior
 * value — but ONLY if a NEWER change hasn't already superseded it (mirrors
 * `useEngineControl.setMode`'s rapid-retoggle safety) — and the failure
 * message is recorded via `describeSettingsError` (a 400 body surfaced
 * verbatim; a 403 flips `forbidden`, so the panel renders read-only instead
 * of a failed-action toast, per story 05 AC6/#297).
 *
 * PER-EXERCISE SCOPE (COR-001), module-singleton store keyed by `exerciseId`
 * — mirrors `useEngineControl`'s/`useSwampedMode`'s shape (`subscribe`/
 * `resetForTests`), so a remount under a different exercise reads a distinct
 * snapshot and no exercise's engine settings leak into another's.
 *
 * NO TELEMETRY EMITTED HERE. Unlike the kill switch (whose backend endpoints
 * emit no autonomy events, so the frontend emit is the sole audit trail),
 * story 05's two settings endpoints emit their own server-side XC-004 events
 * (`engine.autonomy_default_changed` / `engine.tier_policy_changed`) — see
 * that story's "Build notes". Duplicating an emit here would double the audit
 * record, so this hook intentionally emits nothing.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { useExerciseContext } from '@/core/exerciseContext'
import { useControllerIdentity } from '../../identity/controllerIdentity'
import {
  describeSettingsError,
  getSettings as fetchSettings,
  setAutonomyDefault as postAutonomyDefault,
  setTierPolicyMode as postTierPolicyMode,
  type AutonomyDefaultLevel,
  type EngineSettingsDto,
  type TierPolicyMode,
} from '../services/engineSettingsActions'

export type { AutonomyDefaultLevel, EngineSettingsDto, TierPolicyMode } from '../services/engineSettingsActions'

// ---------------------------------------------------------------------------
// The mock snapshot (USE_MOCK_DATA — no network call)
// ---------------------------------------------------------------------------

/**
 * A plausible static settings snapshot, mirroring story 05's actual shipped
 * exercise default: healthy (no clamp), Suggest base/effective, `auto` tier
 * policy, the offline Fake provider with no bound deployments (matches dev/
 * UAT's real Generation config today).
 */
const MOCK_ENGINE_SETTINGS: EngineSettingsDto = {
  provider: 'Fake',
  tiers: [
    { tier: 'Ambient', model: 'fake-ambient (mock)', deployment: '', zdrCapable: false },
    { tier: 'Standard', model: 'fake-standard (mock)', deployment: '', zdrCapable: false },
  ],
  autonomy: {
    swampedMode: false,
    generationStopped: false,
    safetyClampActive: false,
    degradedReason: null,
    exerciseDefaultLevel: 'suggest',
    effectiveLevel: 'suggest',
  },
  tierPolicyMode: 'auto',
  inMemoryState: true,
  inMemoryStateNote:
    'Autonomy default and tier-policy mode are held in process memory; a restart resets them to ' +
    'suggest / auto.',
}

// ---------------------------------------------------------------------------
// The per-exercise module-singleton store (mirrors `useEngineControl`'s shape)
// ---------------------------------------------------------------------------

interface EngineSettingsState {
  /** `null` while the live GET hasn't resolved yet (mock is never `null`). */
  readonly settings: EngineSettingsDto | null
  readonly loading: boolean
  /** The last action/fetch failure's display message, or `null`. Cleared on the next attempt. */
  readonly error: string | null
  /**
   * `true` once a 403 has been seen from a mutating call — the panel renders
   * read-only from then on (story 05 AC6/#297: a non-controller assignment
   * doesn't change back without a fresh session).
   */
  readonly forbidden: boolean
}

const DEFAULT_STATE: EngineSettingsState = {
  settings: null,
  loading: false,
  error: null,
  forbidden: false,
}

const MOCK_STATE: EngineSettingsState = {
  settings: MOCK_ENGINE_SETTINGS,
  loading: false,
  error: null,
  forbidden: false,
}

/** `exerciseId -> state`. Absent = the default (loading/empty in live; mock reads MOCK_STATE). */
const stateByExercise = new Map<string, EngineSettingsState>()

/** Active change listeners; notified on every mutation. */
const listeners = new Set<() => void>()

/** Which exercise ids have already kicked off the one-time live GET. */
const liveFetchStarted = new Set<string>()

function notify(): void {
  for (const listener of listeners) listener()
}

/**
 * The current state for `exerciseId`. A prior mutation (mock or live) is
 * always read back from the map first — the `USE_MOCK_DATA` fork only
 * decides what an EXERCISE THAT HASN'T MUTATED ANYTHING YET starts from,
 * never a permanent override that would hide a stored optimistic update.
 */
function getSnapshot(exerciseId: string): EngineSettingsState {
  const existing = stateByExercise.get(exerciseId)
  if (existing) return existing
  return USE_MOCK_DATA ? MOCK_STATE : DEFAULT_STATE
}

function setFor(exerciseId: string, next: EngineSettingsState): void {
  stateByExercise.set(exerciseId, next)
  notify()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Clears every exercise's state, the live-fetch-started set, and listeners. Test-only. */
function resetForTests(): void {
  stateByExercise.clear()
  liveFetchStarted.clear()
  listeners.clear()
}

/**
 * Injects a settings snapshot directly for `exerciseId`, bypassing both the
 * mock default and any live fetch — test-only, for exercising a server state
 * (e.g. a safety clamp, or a post-403 read-only panel) that would otherwise
 * require a real backend round trip to construct.
 */
function setForTests(
  exerciseId: string,
  settings: EngineSettingsDto,
  options: { readonly forbidden?: boolean } = {},
): void {
  setFor(exerciseId, {
    settings,
    loading: false,
    error: null,
    forbidden: options.forbidden ?? false,
  })
}

/** The module-singleton engine-settings store. Exposed for test-only reset/injection. */
export const engineSettingsStore = { getSnapshot, subscribe, resetForTests, setForTests }

/**
 * Kicks off the one-time live `GET /api/engine/settings` for `exerciseId` —
 * idempotent across every hook instance mounted for the same exercise. A
 * failure (network, malformed body, or an unexpected 401/403) leaves
 * `settings` at whatever it already was (`null` on first load) and records the
 * failure message; it never substitutes a default/fabricated snapshot
 * (COR-001 fail-closed).
 */
function ensureLiveFetchStarted(exerciseId: string): void {
  if (liveFetchStarted.has(exerciseId)) return
  liveFetchStarted.add(exerciseId)

  setFor(exerciseId, { ...getSnapshot(exerciseId), loading: true, error: null })

  fetchSettings()
    .then(settings => {
      setFor(exerciseId, { settings, loading: false, error: null, forbidden: false })
    })
    .catch((error: unknown) => {
      const described = describeSettingsError(error)
      const current = getSnapshot(exerciseId)
      setFor(exerciseId, {
        settings: current.settings,
        loading: false,
        error: described.message,
        forbidden: described.status === 403,
      })
    })
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/** The surface `<EngineSettingsPanel>` and `<EngineControlBar>` both bind to. */
export interface UseEngineSettingsResult {
  /** The current settings snapshot. `null` only while a live GET is still in flight. */
  readonly settings: EngineSettingsDto | null
  /** Whether the initial live GET is still in flight. Always `false` under mock. */
  readonly loading: boolean
  /** The last fetch/action failure's display message, or `null`. */
  readonly error: string | null
  /** `true` once a 403 has been seen — render the panel read-only (story 05 AC6/#297). */
  readonly forbidden: boolean
  /**
   * Flips the exercise autonomy default. Optimistic; reverts on rejection
   * (see module header). A no-op if `settings` isn't loaded yet or `level`
   * already matches the current base default.
   */
  readonly setAutonomyDefault: (level: AutonomyDefaultLevel) => void
  /**
   * Sets the tier-policy mode. Optimistic; reverts on rejection. A no-op if
   * `settings` isn't loaded yet or `mode` already matches the current mode.
   */
  readonly setTierPolicyMode: (mode: TierPolicyMode) => void
}

/**
 * The per-exercise engine settings read/write hook. See the module header for
 * the full mock/live + optimistic-revert contract. Must be called under an
 * `<ExerciseContextProvider>` (fail-closed, via `useExerciseContext()`).
 */
export function useEngineSettings(): UseEngineSettingsResult {
  const identity = useControllerIdentity()
  const { exerciseId, timeZone } = useExerciseContext()

  useEffect(() => {
    if (USE_MOCK_DATA) return
    ensureLiveFetchStarted(exerciseId)
  }, [exerciseId])

  const state = useSyncExternalStore(subscribe, () => getSnapshot(exerciseId))

  const setAutonomyDefaultCb = useCallback(
    (level: AutonomyDefaultLevel) => {
      const current = getSnapshot(exerciseId)
      const previousSettings = current.settings
      if (!previousSettings) return
      if (previousSettings.autonomy.exerciseDefaultLevel === level) return

      // Safe to mirror into `effectiveLevel` ONLY while no clamp is active —
      // see module header. While clamped, `effectiveLevel` is left untouched
      // until the server's authoritative response reconciles it.
      const clamped =
        previousSettings.autonomy.safetyClampActive || previousSettings.autonomy.generationStopped
      const optimisticSettings: EngineSettingsDto = {
        ...previousSettings,
        autonomy: {
          ...previousSettings.autonomy,
          exerciseDefaultLevel: level,
          effectiveLevel: clamped ? previousSettings.autonomy.effectiveLevel : level,
        },
      }
      setFor(exerciseId, { ...current, settings: optimisticSettings, error: null })

      if (USE_MOCK_DATA) return

      postAutonomyDefault(level, { actingHumanId: identity.actingHumanId, timeZone })
        .then(settings => {
          setFor(exerciseId, { settings, loading: false, error: null, forbidden: false })
        })
        .catch((error: unknown) => {
          const described = describeSettingsError(error)
          const latest = getSnapshot(exerciseId)
          // Revert ONLY if our optimistic value is still current — a newer
          // change supersedes us and owns the field (rapid re-toggle safety,
          // mirrors `useEngineControl.setMode`).
          const revertedSettings =
            latest.settings && latest.settings.autonomy.exerciseDefaultLevel === level
              ? {
                ...latest.settings,
                autonomy: {
                  ...latest.settings.autonomy,
                  exerciseDefaultLevel: previousSettings.autonomy.exerciseDefaultLevel,
                  effectiveLevel: previousSettings.autonomy.effectiveLevel,
                },
              }
              : latest.settings
          setFor(exerciseId, {
            settings: revertedSettings,
            loading: false,
            error: described.message,
            forbidden: described.status === 403 ? true : latest.forbidden,
          })
        })
    },
    [exerciseId, identity.actingHumanId, timeZone],
  )

  const setTierPolicyModeCb = useCallback(
    (mode: TierPolicyMode) => {
      const current = getSnapshot(exerciseId)
      const previousSettings = current.settings
      if (!previousSettings) return
      if (previousSettings.tierPolicyMode === mode) return

      const optimisticSettings: EngineSettingsDto = { ...previousSettings, tierPolicyMode: mode }
      setFor(exerciseId, { ...current, settings: optimisticSettings, error: null })

      if (USE_MOCK_DATA) return

      postTierPolicyMode(mode, { actingHumanId: identity.actingHumanId, timeZone })
        .then(settings => {
          setFor(exerciseId, { settings, loading: false, error: null, forbidden: false })
        })
        .catch((error: unknown) => {
          const described = describeSettingsError(error)
          const latest = getSnapshot(exerciseId)
          const revertedSettings =
            latest.settings && latest.settings.tierPolicyMode === mode
              ? { ...latest.settings, tierPolicyMode: previousSettings.tierPolicyMode }
              : latest.settings
          setFor(exerciseId, {
            settings: revertedSettings,
            loading: false,
            error: described.message,
            forbidden: described.status === 403 ? true : latest.forbidden,
          })
        })
    },
    [exerciseId, identity.actingHumanId, timeZone],
  )

  return {
    settings: state.settings,
    loading: state.loading,
    error: state.error,
    forbidden: state.forbidden,
    setAutonomyDefault: setAutonomyDefaultCb,
    setTierPolicyMode: setTierPolicyModeCb,
  }
}
