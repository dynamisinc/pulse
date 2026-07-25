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
 * STALENESS (Gate-1 CR-001, re-review CR-101). A fetch-once-per-mount cache
 * is not enough: the sibling kill switch (`useEngineControl.setMode`) mutates
 * the SAME server-side `EngineAutonomyState` this snapshot describes, entirely
 * outside this hook. `refetch()` forces a fresh GET regardless of whether one
 * already completed; `<EngineControlBar>` calls it once the kill-switch POST
 * SETTLES (`useEngineControl`'s `modeSettledCount` — NOT the optimistic `mode`
 * flip, which fires in the same call as the POST and would race it — see that
 * hook's module header), and `<EngineSettingsPanel>` calls it on every open
 * transition. Two staleness holes closed this pass:
 *   - NEVER DROP AN INVALIDATION. `startLiveFetch` used to silently discard a
 *     `refetch()` call that arrived while a fetch was already in flight —
 *     e.g. the panel's open-transition GET is running when the kill switch
 *     trips, so its OWN refetch is dropped and the stale snapshot survives
 *     indefinitely. Fixed with `refetchQueued`: a request that arrives while
 *     one is in flight is recorded and re-run from that fetch's `.finally`,
 *     never silently swallowed.
 *   - THE GET ITSELF PARTICIPATES IN THE SAME PER-FIELD SEQUENCING AS THE
 *     MUTATIONS (WR-101) — see below; a GET issued before a mutation but
 *     resolving after it must not overwrite that mutation's just-confirmed
 *     value with pre-mutation data, nor corrupt the revert baseline with it.
 *
 * OPTIMISTIC, PER-FIELD REVERT-TO-LAST-CONFIRMED (the single most important
 * behaviour in this story; Gate-1 CR-002, re-review CR-102).
 * `setAutonomyDefault`/`setTierPolicyMode` update ONLY the field the caller
 * asked to change — never a guessed `effectiveLevel`, EXCEPT the one safe
 * inference the backend's own contract already guarantees: setting a new base
 * default while NO safety clamp is active means the server will echo that
 * exact value back as `effectiveLevel` too (AC2 of story 05 — a clamp only
 * ever suppresses a RAISE, so an unclamped base flip and its effective level
 * move together). While a clamp IS active, `effectiveLevel` is left untouched
 * by the optimistic patch (never guessed at) until the server's own response
 * reconciles it.
 *
 * SEQUENCING IS PER FIELD, NOT PER RESOURCE (Gate-1 CR-102 — the re-review's
 * correction of the original single shared-sequence design). The two
 * mutations write DISJOINT fields (`autonomy.exerciseDefaultLevel`/
 * `effectiveLevel` vs. `tierPolicyMode`); a counter shared across both meant a
 * tier-policy rejection could revert the WHOLE display — including an
 * autonomy-default flip that was still in flight and later succeeded, whose
 * authoritative response then had nowhere to land (its own sequence no longer
 * "owned" the resource-wide counter). Fixed with independent sequence
 * trackers per `SettingsField` (`autonomyDefault` | `tierPolicy`), sharing
 * only the underlying issuing counter (so ordering between them is still
 * total) — a success/rejection reconciles ONLY its own field via
 * `withFieldFrom`, leaving the OTHER field exactly as it currently reads.
 * "Shared" informational data the hook never mutates itself (`provider`,
 * `tiers`, `inMemoryState*`, and the autonomy sub-fields the kill switch owns
 * — `swampedMode`/`generationStopped`/`safetyClampActive`/`degradedReason`)
 * is refreshed unconditionally from every successful response (`withShared
 * FieldsFrom`) — nothing here ever optimistically guesses those, so there is
 * no cross-field race to guard for them.
 *
 * A rejection reverts ONLY its own field to that field's last SERVER-CONFIRMED
 * value — never the click-time optimistic value (which under a rapid
 * re-toggle can be another still-unconfirmed guess) and never the OTHER
 * field's current value. A superseded rejection (a newer request for the SAME
 * field has since been issued) is DISCARDED ENTIRELY for that field — no
 * revert, no error write for that field (WR-003: a stale failure must never
 * raise an alert over a change that has since succeeded) — while the other
 * field's own error state is completely unaffected, tracked independently
 * (`fieldError`) and combined for display.
 *
 * `forbidden` IS DELIBERATELY A SINGLE SHARED, STICKY FLAG, not per-field
 * (Gate-1 WR-102): a 403 means "assigned staff but not a controller" — the
 * SAME role gate covers both `/autonomy-default` and `/tier-policy` (story 05
 * AC6/#297), so there is no meaningful per-field distinction. Once set, a
 * later successful GET must NEVER clear it back to `false` — `GET /settings`
 * is deliberately 200 for a non-controller (an evaluator can watch), so this
 * hook's own open-transition refetch would otherwise silently re-enable the
 * controls the moment the panel is reopened, contradicting "doesn't change
 * back without a fresh session".
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
  /** The combined display message from every currently-relevant failure, or `null`. */
  readonly error: string | null
  /**
   * `true` once a 403 has been seen from a mutating call — the panel renders
   * read-only from then on (story 05 AC6/#297). STICKY (Gate-1 WR-102): a
   * later successful GET never clears this back to `false`.
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
 * The two independently-mutable fields (Gate-1 CR-102) — `provider`/`tiers`/
 * etc. are "shared", not a field.
 */
type SettingsField = 'autonomyDefault' | 'tierPolicy'
const SETTINGS_FIELDS: readonly SettingsField[] = ['autonomyDefault', 'tierPolicy']

/**
 * Non-reactive bookkeeping alongside the displayed `EngineSettingsState`
 * (Gate-1 CR-002/CR-102) — kept OUT of the reactive state on purpose, since
 * none of this should itself trigger a re-render.
 */
interface EngineSettingsInternal {
  /**
   * The last snapshot the SERVER actually confirmed, ASSEMBLED field-by-field
   * (the initial/refetched GET's own fields, or whichever mutation most
   * recently confirmed its OWN field) — the ONLY valid per-field revert
   * baseline. Never a click-time optimistic value, which may itself be
   * unconfirmed.
   */
  confirmedSettings: EngineSettingsDto | null
  /**
   * Monotonic — incremented once per ISSUED read or write (GET + both
   * mutation kinds share ONE counter, for a total order).
   */
  nextSeq: number
  /**
   * Per-field: the seq of the most recently ISSUED read/write for that
   * field; only ITS OWN resolution may touch that field's display.
   */
  latestIssuedSeqByField: Record<SettingsField, number>
  /**
   * Per-field: the seq whose result currently populates that field in
   * `confirmedSettings` (never regresses).
   */
  confirmedSeqByField: Record<SettingsField, number>
  /**
   * Per-field: the last non-stale failure's display message for that field,
   * or `null` (cleared independently on that field's own success).
   */
  fieldError: Record<SettingsField, string | null>
  /**
   * The last GET failure's display message, or `null` — tracked separately
   * from the two mutation fields.
   */
  loadError: string | null
}

function defaultInternal(): EngineSettingsInternal {
  return {
    confirmedSettings: null,
    nextSeq: 0,
    latestIssuedSeqByField: { autonomyDefault: 0, tierPolicy: 0 },
    confirmedSeqByField: { autonomyDefault: 0, tierPolicy: 0 },
    fieldError: { autonomyDefault: null, tierPolicy: null },
    loadError: null,
  }
}

/** Joins every currently-relevant failure message into ONE display string, or `null` if none. */
function combinedError(internal: EngineSettingsInternal): string | null {
  const messages = [
    internal.loadError,
    internal.fieldError.autonomyDefault,
    internal.fieldError.tierPolicy,
  ].filter((message): message is string => message !== null)
  return messages.length > 0 ? messages.join(' ') : null
}

/**
 * Refreshes the "shared" informational data ONLY (`provider`, `tiers`,
 * `inMemoryState*`, and the autonomy sub-fields this hook never mutates
 * itself — `swampedMode`/`generationStopped`/`safetyClampActive`/
 * `degradedReason`) from `source` onto `into`. Never touches
 * `exerciseDefaultLevel`/`effectiveLevel`/`tierPolicyMode` — those are each
 * gated per-field by the caller via {@link withFieldFrom}.
 */
function withSharedFieldsFrom(
  into: EngineSettingsDto,
  source: EngineSettingsDto,
): EngineSettingsDto {
  return {
    ...into,
    provider: source.provider,
    tiers: source.tiers,
    inMemoryState: source.inMemoryState,
    inMemoryStateNote: source.inMemoryStateNote,
    autonomy: {
      ...into.autonomy,
      swampedMode: source.autonomy.swampedMode,
      generationStopped: source.autonomy.generationStopped,
      safetyClampActive: source.autonomy.safetyClampActive,
      degradedReason: source.autonomy.degradedReason,
    },
  }
}

/**
 * Overlays ONLY `field`'s own sub-value from `source` onto `into`, leaving
 * every other value (including the OTHER mutable field) untouched.
 */
function withFieldFrom(
  into: EngineSettingsDto,
  source: EngineSettingsDto,
  field: SettingsField,
): EngineSettingsDto {
  if (field === 'autonomyDefault') {
    return {
      ...into,
      autonomy: {
        ...into.autonomy,
        exerciseDefaultLevel: source.autonomy.exerciseDefaultLevel,
        effectiveLevel: source.autonomy.effectiveLevel,
      },
    }
  }
  return { ...into, tierPolicyMode: source.tierPolicyMode }
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

/**
 * Which exercise ids had an invalidation ARRIVE while a fetch was already in
 * flight (Gate-1 CR-101 half 2) — re-run once the in-flight one settles,
 * rather than silently dropping it.
 */
const refetchQueued = new Set<string>()

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
 * Clears every exercise's state, internal bookkeeping, in-flight/queued
 * markers, and listeners. Test-only.
 */
function resetForTests(): void {
  stateByExercise.clear()
  internalByExercise.clear()
  liveFetchStarted.clear()
  fetchInFlight.clear()
  refetchQueued.clear()
  listeners.clear()
}

/**
 * Injects a settings snapshot directly for `exerciseId`, bypassing both the
 * mock default and any live fetch — test-only, for exercising a server state
 * (e.g. a safety clamp, or a post-403 read-only panel) that would otherwise
 * require a real backend round trip to construct. Also seeds this snapshot as
 * the CONFIRMED baseline for BOTH fields (a fresh sequence), so a
 * subsequently-tested mutation reverts to it correctly on rejection.
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
    latestIssuedSeqByField: { autonomyDefault: 0, tierPolicy: 0 },
    confirmedSeqByField: { autonomyDefault: 0, tierPolicy: 0 },
    fieldError: { autonomyDefault: null, tierPolicy: null },
    loadError: null,
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
 * for an explicit `invalidate()`. If a fetch is already in flight for this
 * exercise, the request is QUEUED (Gate-1 CR-101 half 2 — never silently
 * dropped) and re-run once the in-flight one settles.
 *
 * The GET's own issuance bumps `latestIssuedSeqByField` for BOTH fields (it
 * is an attempt to know the current value of both), and its resolution
 * applies EACH field independently, gated by the SAME "am I still the newest
 * attempt for this field" rule a mutation uses (Gate-1 WR-101) — so a GET
 * issued before a mutation but resolving after it does not overwrite that
 * mutation's just-confirmed field with pre-mutation data, nor corrupt that
 * field's revert baseline. The "shared" informational fields are always
 * refreshed unconditionally (nothing else ever mutates them).
 */
function startLiveFetch(exerciseId: string): void {
  if (fetchInFlight.has(exerciseId)) {
    refetchQueued.add(exerciseId)
    return
  }
  fetchInFlight.add(exerciseId)
  liveFetchStarted.add(exerciseId)

  const internal = getInternal(exerciseId)
  const mySeq = ++internal.nextSeq
  for (const field of SETTINGS_FIELDS) {
    internal.latestIssuedSeqByField[field] = mySeq
  }

  setFor(exerciseId, { ...getSnapshot(exerciseId), loading: true })

  fetchSettings()
    .then(settings => {
      let nextConfirmed = withSharedFieldsFrom(internal.confirmedSettings ?? settings, settings)
      const beforeApply = getSnapshot(exerciseId)
      let nextDisplay = withSharedFieldsFrom(beforeApply.settings ?? settings, settings)

      for (const field of SETTINGS_FIELDS) {
        if (mySeq >= internal.confirmedSeqByField[field]) {
          nextConfirmed = withFieldFrom(nextConfirmed, settings, field)
          internal.confirmedSeqByField[field] = mySeq
        }
        if (mySeq === internal.latestIssuedSeqByField[field]) {
          nextDisplay = withFieldFrom(nextDisplay, settings, field)
        }
      }

      internal.confirmedSettings = nextConfirmed
      internal.loadError = null
      setFor(exerciseId, {
        settings: nextDisplay,
        loading: false,
        error: combinedError(internal),
        // Sticky (Gate-1 WR-102) — a successful GET NEVER clears `forbidden`.
        forbidden: beforeApply.forbidden,
      })
    })
    .catch((error: unknown) => {
      // WR-004: clear the "started" flag so a later mount/invalidate can
      // retry — a transient blip must not be a PERMANENT load-error state.
      liveFetchStarted.delete(exerciseId)
      const described = describeSettingsError(error)
      const current = getSnapshot(exerciseId)
      internal.loadError = described.message
      setFor(exerciseId, {
        settings: current.settings,
        loading: false,
        error: combinedError(internal),
        // Sticky either way; a GET 403 (unexpected per story 05 AC6, but
        // handled) also only ever turns this ON, never off.
        forbidden: described.status === 403 ? true : current.forbidden,
      })
    })
    .finally(() => {
      fetchInFlight.delete(exerciseId)
      if (refetchQueued.delete(exerciseId)) {
        // A refetch arrived while this one was in flight — run it now rather
        // than treating this fetch's result as sufficient (Gate-1 CR-101).
        startLiveFetch(exerciseId)
      }
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
 * retry path for a failed initial GET. NEVER silently dropped, even if a
 * fetch is already in flight (Gate-1 CR-101 — queued instead). A no-op under
 * mock — there is nothing to refetch (the mock store already reflects every
 * local mutation instantly).
 */
function invalidate(exerciseId: string): void {
  if (USE_MOCK_DATA) return
  startLiveFetch(exerciseId)
}

/**
 * Runs one optimistic mutation for `exerciseId`/`field`: computes + displays
 * the optimistic patch immediately, then (live only) issues the request with
 * a fresh sequence number scoped to THIS FIELD and reconciles per the module
 * header's "PER-FIELD REVERT-TO-LAST-CONFIRMED" contract. Shared by
 * `setAutonomyDefault`/`setTierPolicyMode` — each supplies its own `field` so
 * the other field's current value (and error state) is never touched.
 */
function performMutation(
  exerciseId: string,
  field: SettingsField,
  computeOptimistic: (previous: EngineSettingsDto) => EngineSettingsDto,
  runLive: () => Promise<EngineSettingsDto>,
): void {
  const current = getSnapshot(exerciseId)
  const previousSettings = current.settings
  if (!previousSettings) return

  const internal = getInternal(exerciseId)
  // Clear THIS field's own prior error immediately on a new attempt — never
  // the other field's, and never the load error.
  internal.fieldError[field] = null

  const optimisticSettings = computeOptimistic(previousSettings)
  setFor(exerciseId, { ...current, settings: optimisticSettings, error: combinedError(internal) })

  if (USE_MOCK_DATA) {
    // No server to confirm against — the optimistic value IS the new
    // confirmed baseline from here on (safe: with no network, there is no
    // reordering risk at all).
    internal.confirmedSettings = optimisticSettings
    return
  }

  const mySeq = ++internal.nextSeq
  internal.latestIssuedSeqByField[field] = mySeq

  runLive()
    .then(settings => {
      // A success always advances THIS FIELD's confirmed baseline — but
      // never regresses it to an OLDER attempt's result than one already
      // recorded for that same field.
      if (mySeq >= internal.confirmedSeqByField[field]) {
        internal.confirmedSettings = withFieldFrom(
          withSharedFieldsFrom(internal.confirmedSettings ?? settings, settings),
          settings,
          field,
        )
        internal.confirmedSeqByField[field] = mySeq
      }
      // Only the NEWEST issued request FOR THIS FIELD may update the
      // DISPLAYED settings for that field — a superseded request's late
      // success must not clobber a newer optimistic guess for the SAME
      // field (the other field, and the shared informational data, are
      // always safe to refresh since nothing else contends for them here).
      if (mySeq === internal.latestIssuedSeqByField[field]) {
        internal.fieldError[field] = null
        const latest = getSnapshot(exerciseId)
        const nextDisplay = withFieldFrom(
          withSharedFieldsFrom(latest.settings ?? settings, settings),
          settings,
          field,
        )
        setFor(exerciseId, {
          settings: nextDisplay,
          loading: false,
          error: combinedError(internal),
          forbidden: latest.forbidden,
        })
      }
    })
    .catch((error: unknown) => {
      // A superseded rejection (a NEWER request for THIS SAME field has since
      // been issued) is DISCARDED ENTIRELY for this field — no revert, no
      // error write (WR-003) — the newest request (or its own eventual
      // resolution) owns the field from here. The OTHER field is completely
      // unaffected regardless.
      if (mySeq !== internal.latestIssuedSeqByField[field]) return

      const described = describeSettingsError(error)
      internal.fieldError[field] = described.message
      const latest = getSnapshot(exerciseId)
      // Revert ONLY this field to the LAST SERVER-CONFIRMED value for THIS
      // FIELD (CR-002/CR-102) — never the click-time optimistic value (which
      // under a rapid re-toggle can be another request's still-unconfirmed
      // guess) and never the OTHER field's current value. `confirmedSettings`
      // is populated by the initial GET before any mutation can fire, so the
      // `?? latest.settings` fallback is defensive only (unreachable in
      // practice).
      const confirmed = internal.confirmedSettings
      const revertedSettings = confirmed
        ? withFieldFrom(latest.settings ?? confirmed, confirmed, field)
        : latest.settings
      setFor(exerciseId, {
        settings: revertedSettings,
        loading: false,
        error: combinedError(internal),
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
  /** The combined display message from every currently-relevant failure, or `null`. */
  readonly error: string | null
  /** `true` once a 403 has been seen — render the panel read-only (story 05 AC6/#297). STICKY. */
  readonly forbidden: boolean
  /**
   * Flips the exercise autonomy default. Optimistic; reverts to the last
   * server-confirmed value FOR THIS FIELD on rejection (see module header). A
   * no-op if `settings` isn't loaded yet or `level` already matches the
   * current base default.
   */
  readonly setAutonomyDefault: (level: AutonomyDefaultLevel) => void
  /**
   * Sets the tier-policy mode. Optimistic; reverts to the last
   * server-confirmed value FOR THIS FIELD on rejection. A no-op if `settings`
   * isn't loaded yet or `mode` already matches the current mode.
   */
  readonly setTierPolicyMode: (mode: TierPolicyMode) => void
  /**
   * Forces a fresh `GET /api/engine/settings` (Gate-1 CR-001) — a no-op under
   * mock. Callers refetch whenever a safety-relevant sibling state SETTLES
   * (the kill switch's live POST concluding — never the optimistic flip
   * itself, Gate-1 CR-101) or right before the operator is about to look (the
   * flyout opening), so this snapshot never goes stale between the two.
   */
  readonly refetch: () => void
}

/**
 * The per-exercise engine settings read/write hook. See the module header for
 * the full mock/live + staleness + per-field optimistic-revert contract. Must
 * be called under an `<ExerciseContextProvider>` (fail-closed, via
 * `useExerciseContext()`).
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
        'autonomyDefault',
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
        'tierPolicy',
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
