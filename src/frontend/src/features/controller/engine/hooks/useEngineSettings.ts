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
 * (WR-003 of story 05); this hook never re-derives it from
 * `exerciseDefaultLevel` + `safetyClampActive` itself, it is read verbatim
 * off the server response.
 *
 * MOCK <-> LIVE (`USE_MOCK_DATA`, `@/core/config/mockData`). Mock renders a
 * plausible static snapshot with NO network call, matching every other engine
 * hook's mock/live split — `MOCK_ENGINE_SETTINGS` mirrors story 05's actual
 * shipped default (healthy, Suggest base, `auto` tier policy). Live fetches
 * `GET /api/engine/settings` once per exercise on mount, and REFETCHES on
 * demand via `refetch()` (see "STALENESS" below) and starts real POSTs for
 * the two mutations.
 *
 * STALENESS (Gate-1 CR-001). A fetch-once-per-mount cache is not enough: the
 * sibling kill switch (`useEngineControl.setMode`) mutates the SAME
 * server-side `EngineAutonomyState` this snapshot describes, entirely outside
 * this hook. Without an invalidation path, tripping the kill switch (or the
 * server degrading the provider on its own) would leave this snapshot
 * reporting "no clamp" indefinitely. `refetch()` forces a fresh GET
 * regardless of whether one already completed; `<EngineControlBar>` calls it
 * whenever the kill-switch mode/degraded state changes, and
 * `<EngineSettingsPanel>` calls it on every open transition — so the settings
 * this hook reports are refreshed at both of the moments that matter (a
 * safety-relevant change happened, or an operator is about to look), without
 * retrofitting `useEngineControl`'s own derivation (out of scope).
 *
 * OPTIMISTIC, REVERT-TO-LAST-CONFIRMED (the single most important behaviour
 * in this story; Gate-1 CR-002). `setAutonomyDefault`/`setTierPolicyMode`
 * update ONLY the field the caller asked to change — never a guessed
 * `effectiveLevel`, EXCEPT the one safe inference the backend's own contract
 * already guarantees: setting a new base default while NO safety clamp is
 * active means the server will echo that exact value back as `effectiveLevel`
 * too (AC2 of story 05 — a clamp only ever suppresses a RAISE, so an
 * unclamped base flip and its effective level move together). While a clamp
 * IS active, `effectiveLevel` is left untouched by the optimistic patch
 * (never guessed at) until the server's own response reconciles it.
 *
 * Each mutation is stamped with a per-exercise, monotonically-issued sequence
 * number shared across BOTH mutation kinds (they mutate the same server
 * resource, so one counter serializes them). Only the NEWEST issued request
 * may write the DISPLAYED `settings`/`error` on its own resolution — a
 * superseded request's rejection is DISCARDED ENTIRELY (no revert, no error;
 * this also closes WR-003: a stale failure must never raise an alert over a
 * change that has since succeeded), and a superseded request's late success
 * only ever advances the separately-tracked LAST-CONFIRMED snapshot (never
 * regressing it), without touching what's on screen. Critically, a rejection
 * reverts the display to that LAST-CONFIRMED snapshot — never to whatever was
 * showing at the moment the rejected request was ISSUED, which under a rapid
 * re-toggle can be another request's still-unconfirmed optimistic guess (the
 * exact bug: reverting to a value the server never actually applied).
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

export type {
  AutonomyDefaultLevel,
  EngineSettingsAutonomy,
  EngineSettingsDto,
  TierPolicyMode,
} from '../services/engineSettingsActions'

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

/**
 * Non-reactive bookkeeping alongside the displayed `EngineSettingsState`
 * (Gate-1 CR-002) — kept OUT of the reactive state on purpose, since none of
 * this should itself trigger a re-render.
 */
interface EngineSettingsInternal {
  /**
   * The last snapshot the SERVER actually confirmed (the initial/refetched
   * GET, or a resolved mutation) — the ONLY valid revert baseline on a
   * rejection. Never a click-time optimistic value, which may itself be
   * unconfirmed.
   */
  confirmedSettings: EngineSettingsDto | null
  /** Monotonic — incremented per ISSUED mutation; autonomy + tier-policy share one counter. */
  nextSeq: number
  /** Seq of the most recently ISSUED mutation; only its own resolution may touch the display. */
  latestIssuedSeq: number
  /** Seq whose success currently populates `confirmedSettings` (never regresses). */
  confirmedSeq: number
}

function defaultInternal(): EngineSettingsInternal {
  return { confirmedSettings: null, nextSeq: 0, latestIssuedSeq: 0, confirmedSeq: 0 }
}

/** `exerciseId -> state`. Absent = the default (loading/empty in live; mock reads MOCK_STATE). */
const stateByExercise = new Map<string, EngineSettingsState>()

/** `exerciseId -> internal bookkeeping` (see {@link EngineSettingsInternal}). */
const internalByExercise = new Map<string, EngineSettingsInternal>()

/** Active change listeners; notified on every mutation. */
const listeners = new Set<() => void>()

/** Which exercise ids have completed at least one live GET attempt since mount/invalidate. */
const liveFetchStarted = new Set<string>()

/** Which exercise ids currently have a live GET in flight (dedupes concurrent triggers). */
const fetchInFlight = new Set<string>()

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

function getInternal(exerciseId: string): EngineSettingsInternal {
  let internal = internalByExercise.get(exerciseId)
  if (!internal) {
    internal = defaultInternal()
    internalByExercise.set(exerciseId, internal)
  }
  return internal
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

/**
 * Clears every exercise's state, internal bookkeeping, in-flight markers, and
 * listeners. Test-only.
 */
function resetForTests(): void {
  stateByExercise.clear()
  internalByExercise.clear()
  liveFetchStarted.clear()
  fetchInFlight.clear()
  listeners.clear()
}

/**
 * Injects a settings snapshot directly for `exerciseId`, bypassing both the
 * mock default and any live fetch — test-only, for exercising a server state
 * (e.g. a safety clamp, or a post-403 read-only panel) that would otherwise
 * require a real backend round trip to construct. Also seeds this snapshot as
 * the CONFIRMED baseline (a fresh sequence), so a subsequently-tested
 * mutation reverts to it correctly on rejection.
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
  internalByExercise.set(exerciseId, {
    confirmedSettings: settings,
    nextSeq: 0,
    latestIssuedSeq: 0,
    confirmedSeq: 0,
  })
}

/**
 * The module-singleton engine-settings store. Exposed for test-only reset —
 * `setForTests` is a TEST-ONLY fabrication seam and is deliberately NOT
 * re-exported through the feature's public barrel (`engine/index.ts`); import
 * this module directly in tests (mirrors `engineControlStore`, which exposes
 * only `resetForTests`).
 */
export const engineSettingsStore = { getSnapshot, subscribe, resetForTests, setForTests }

/**
 * Performs the live GET, unconditionally — used both for the first load and
 * for an explicit `invalidate()`. Deduped against a concurrently in-flight
 * fetch for the same exercise (`fetchInFlight`), never against "already
 * fetched once" (that guard lives in `ensureLiveFetchStarted`, not here). A
 * GET result is always authoritative and unconditionally applied to both the
 * confirmed baseline and the display — a fresh full snapshot always wins over
 * any in-flight optimistic guess.
 */
function startLiveFetch(exerciseId: string): void {
  if (fetchInFlight.has(exerciseId)) return
  fetchInFlight.add(exerciseId)
  liveFetchStarted.add(exerciseId)

  setFor(exerciseId, { ...getSnapshot(exerciseId), loading: true, error: null })

  fetchSettings()
    .then(settings => {
      getInternal(exerciseId).confirmedSettings = settings
      setFor(exerciseId, { settings, loading: false, error: null, forbidden: false })
    })
    .catch((error: unknown) => {
      // WR-004: clear the "started" flag so a later mount/invalidate can
      // retry — a transient blip must not be a PERMANENT load-error state.
      liveFetchStarted.delete(exerciseId)
      const described = describeSettingsError(error)
      const current = getSnapshot(exerciseId)
      setFor(exerciseId, {
        settings: current.settings,
        loading: false,
        error: described.message,
        forbidden: described.status === 403,
      })
    })
    .finally(() => {
      fetchInFlight.delete(exerciseId)
    })
}

/**
 * Kicks off the ONE-TIME live `GET /api/engine/settings` for `exerciseId` on
 * first mount — idempotent across every hook instance mounted for the same
 * exercise (a second mounted consumer does not refire it). Subsequent
 * freshness is `refetch()`'s job (CR-001), not this function's.
 */
function ensureLiveFetchStarted(exerciseId: string): void {
  if (liveFetchStarted.has(exerciseId)) return
  startLiveFetch(exerciseId)
}

/**
 * Forces a fresh `GET /api/engine/settings` for `exerciseId`, regardless of
 * whether one already completed (Gate-1 CR-001) — the kill switch mutates the
 * SAME server-side autonomy state this snapshot describes, entirely outside
 * this hook, so a fetch-once cache can silently go stale the moment it's
 * tripped (or the moment the server degrades on its own). Also the WR-004
 * retry path for a failed initial GET. A no-op under mock — there is nothing
 * to refetch (the mock store already reflects every local mutation
 * instantly).
 */
function invalidate(exerciseId: string): void {
  if (USE_MOCK_DATA) return
  startLiveFetch(exerciseId)
}

/**
 * Runs one optimistic mutation for `exerciseId`: computes + displays the
 * optimistic patch immediately, then (live only) issues the request with a
 * fresh per-exercise sequence number and reconciles per the module header's
 * "OPTIMISTIC, REVERT-TO-LAST-CONFIRMED" contract. Shared by
 * `setAutonomyDefault`/`setTierPolicyMode` — both mutate the same server
 * resource, so they share one sequence counter and one confirmed baseline.
 */
function performMutation(
  exerciseId: string,
  computeOptimistic: (previous: EngineSettingsDto) => EngineSettingsDto,
  runLive: () => Promise<EngineSettingsDto>,
): void {
  const current = getSnapshot(exerciseId)
  const previousSettings = current.settings
  if (!previousSettings) return

  const optimisticSettings = computeOptimistic(previousSettings)
  setFor(exerciseId, { ...current, settings: optimisticSettings, error: null })

  const internal = getInternal(exerciseId)

  if (USE_MOCK_DATA) {
    // No server to confirm against — the optimistic value IS the new
    // confirmed baseline from here on.
    internal.confirmedSettings = optimisticSettings
    return
  }

  const mySeq = ++internal.nextSeq
  internal.latestIssuedSeq = mySeq

  runLive()
    .then(settings => {
      // A success always advances the confirmed baseline — but never
      // regresses it to an OLDER attempt's result than one already recorded.
      if (mySeq >= internal.confirmedSeq) {
        internal.confirmedSettings = settings
        internal.confirmedSeq = mySeq
      }
      // Only the NEWEST issued request may update the DISPLAYED settings — a
      // superseded request's late success must not clobber a newer
      // optimistic guess (or that newer request's own eventual resolution).
      if (mySeq === internal.latestIssuedSeq) {
        setFor(exerciseId, { settings, loading: false, error: null, forbidden: false })
      }
    })
    .catch((error: unknown) => {
      // A superseded request's rejection is DISCARDED ENTIRELY — no error
      // banner (WR-003: a stale failure must never announce over a change
      // that has since succeeded), no revert. The newest request (or its own
      // eventual resolution) owns the field from here.
      if (mySeq !== internal.latestIssuedSeq) return

      const described = describeSettingsError(error)
      const latest = getSnapshot(exerciseId)
      // Revert to the LAST SERVER-CONFIRMED snapshot (CR-002) — never the
      // click-time optimistic value, which under a rapid re-toggle can be
      // another request's still-unconfirmed guess. `confirmedSettings` is
      // populated by the initial GET before any mutation can fire, so the
      // `?? latest.settings` fallback is defensive only (unreachable in
      // practice).
      const revertTo = internal.confirmedSettings ?? latest.settings
      setFor(exerciseId, {
        settings: revertTo,
        loading: false,
        error: described.message,
        forbidden: described.status === 403 ? true : latest.forbidden,
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
  /** Whether a live GET is in flight (initial load OR `refetch()`). Always `false` under mock. */
  readonly loading: boolean
  /** The last fetch/action failure's display message, or `null`. */
  readonly error: string | null
  /** `true` once a 403 has been seen — render the panel read-only (story 05 AC6/#297). */
  readonly forbidden: boolean
  /**
   * Flips the exercise autonomy default. Optimistic; reverts to the last
   * server-confirmed snapshot on rejection (see module header). A no-op if
   * `settings` isn't loaded yet or `level` already matches the current base
   * default.
   */
  readonly setAutonomyDefault: (level: AutonomyDefaultLevel) => void
  /**
   * Sets the tier-policy mode. Optimistic; reverts to the last
   * server-confirmed snapshot on rejection. A no-op if `settings` isn't
   * loaded yet or `mode` already matches the current mode.
   */
  readonly setTierPolicyMode: (mode: TierPolicyMode) => void
  /**
   * Forces a fresh `GET /api/engine/settings` (Gate-1 CR-001) — a no-op under
   * mock. Callers refetch whenever a safety-relevant sibling state changes
   * (the kill switch) or right before the operator is about to look (the
   * flyout opening), so this snapshot never goes stale between the two.
   */
  readonly refetch: () => void
}

/**
 * The per-exercise engine settings read/write hook. See the module header for
 * the full mock/live + staleness + optimistic-revert contract. Must be called
 * under an `<ExerciseContextProvider>` (fail-closed, via `useExerciseContext()`).
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
      const previousSettings = getSnapshot(exerciseId).settings
      if (!previousSettings) return
      if (previousSettings.autonomy.exerciseDefaultLevel === level) return

      performMutation(
        exerciseId,
        previous => {
          // Safe to mirror into `effectiveLevel` ONLY while no clamp is
          // active — see module header. While clamped, `effectiveLevel` is
          // left untouched until the server's authoritative response
          // reconciles it.
          const clamped = previous.autonomy.safetyClampActive || previous.autonomy.generationStopped
          return {
            ...previous,
            autonomy: {
              ...previous.autonomy,
              exerciseDefaultLevel: level,
              effectiveLevel: clamped ? previous.autonomy.effectiveLevel : level,
            },
          }
        },
        () => postAutonomyDefault(level, { actingHumanId: identity.actingHumanId, timeZone }),
      )
    },
    [exerciseId, identity.actingHumanId, timeZone],
  )

  const setTierPolicyModeCb = useCallback(
    (mode: TierPolicyMode) => {
      const previousSettings = getSnapshot(exerciseId).settings
      if (!previousSettings) return
      if (previousSettings.tierPolicyMode === mode) return

      performMutation(
        exerciseId,
        previous => ({ ...previous, tierPolicyMode: mode }),
        () => postTierPolicyMode(mode, { actingHumanId: identity.actingHumanId, timeZone }),
      )
    },
    [exerciseId, identity.actingHumanId, timeZone],
  )

  const refetchCb = useCallback(() => {
    invalidate(exerciseId)
  }, [exerciseId])

  return {
    settings: state.settings,
    loading: state.loading,
    error: state.error,
    forbidden: state.forbidden,
    setAutonomyDefault: setAutonomyDefaultCb,
    setTierPolicyMode: setTierPolicyModeCb,
    refetch: refetchCb,
  }
}
