/**
 * features/controller/engine/hooks/useEngineSettings.ts
 * ---------------------------------------------------------------------------
 * The engine SETTINGS read/write hook (feature: autonomy-safety, stories 06 +
 * 07; ADP-025/NFR-005, COR-001, COR-018, ADP-042, D5 §2 "Engine control").
 * STAFF world — pure hook, no UI, no COBRA.
 *
 * The SINGLE SOURCE both `<EngineSettingsPanel>` (this story) and
 * `<EngineControlBar>`'s "Live" label read — this hook is the first cockpit
 * consumer to actually read story 05's `GET /api/engine/settings`; its
 * `effectiveLevel` is the value any consumer must label the posture from
 * (WR-003 of story 05); this hook never re-derives it from
 * `exerciseDefaultLevel` + `safetyClampActive` itself, it is read verbatim
 * off the server response.
 *
 * ## Rebuild history — read before touching the reconciliation below
 * This hook was built three times on an OPTIMISTIC-update-with-revert model
 * (flip the display immediately, revert to a per-field "last confirmed"
 * baseline on rejection). That model produced SIX Criticals across two Gate-1
 * review passes, every one the same root cause: the model ordered responses
 * by ISSUANCE but applied them on LANDING, so a late response could overwrite
 * strictly newer truth (a stale GET erasing a fresh clamp; a per-field
 * "confirmed baseline" itself corrupted by a late GET; a shared sequence
 * across two mutations writing DISJOINT fields losing a genuinely successful
 * change; the refetch racing the optimistic flip it was meant to observe).
 * Two of those six were reproduced with EXECUTED probe tests, and all six
 * passed a fully green suite — the bug class survived being "better guarded"
 * twice.
 *
 * Tom's decision (recorded here per the story's instruction to state the
 * deviation, not quietly reword the AC): DROP THE OPTIMISTIC MODEL ENTIRELY.
 * This is a low-frequency admin surface (an operator changes autonomy posture
 * rarely) — the responsiveness optimism bought is worth very little against
 * six Criticals of one class. AC3/AC4 ("posts the change with an optimistic
 * update that reverts on rejection ... so the panel never claims an autonomy
 * posture the backend didn't actually apply") are satisfied here by AWAITING
 * the response and applying it, rather than by optimistically asserting a
 * value and reverting it — which meets that AC's actual INTENT ("the panel
 * never claims a posture the backend didn't apply") more completely than the
 * optimistic model ever did, since nothing is ever asserted before the server
 * confirms it.
 *
 * ## The new model: await, then apply. No speculation, nothing to revert.
 * `setAutonomyDefault`/`setTierPolicyMode` write NO speculative value into the
 * display. On issuing the POST, the SPECIFIC control clicked is marked
 * "pending" (`pendingAutonomyDefault`/`pendingTierPolicy`) so
 * `<EngineSettingsPanel>` can disable it with an in-flight affordance — the
 * `settings` object itself is untouched until a response lands. On success,
 * the FULL authoritative `EngineSettingsDto` from the response is applied
 * verbatim (all three endpoints return the identical shape — story 05's
 * "Build notes" — so no follow-up read is ever needed). On rejection, the
 * pending flag clears, the error is surfaced, and `settings` is EXACTLY what
 * it was before the click — there is no revert, because nothing was ever
 * asserted.
 *
 * ## Serialization — how the four remaining historical bugs are made
 * UNREPRESENTABLE rather than better-guarded
 * Dropping optimism alone does not close every hole: two DIFFERENT mutations
 * (autonomy-default, tier-policy) write DISJOINT fields on the SAME
 * `EngineSettingsDto`, and a background refetch (the kill-switch settling, or
 * the flyout's own open-transition GET) can still be triggered while a
 * mutation is outstanding. If those were allowed to race freely, a single
 * "apply if newer" counter would reproduce exactly the historical bug this
 * hook exists to stop: a later-issued response landing first, then an
 * earlier-issued (but genuinely successful) response for a DIFFERENT field
 * arriving after it and being discarded as "stale" — silently losing a
 * confirmed change with no error shown (the exact "superseded autonomy
 * success never reached the display" Critical, which failed UNSAFE).
 *
 * So this hook is FULLY SERIALIZED, per exercise: at most ONE request (the
 * GET or either mutation) is ever outstanding at a time.
 *  - A mutation is a NO-OP if a request is already in flight (the UI already
 *    disables BOTH controls whenever anything is in flight — see below — so
 *    this is a defensive guard, not a normal path).
 *  - `refetch()` (an explicit invalidation — the panel opening, or the kill
 *    switch settling) QUEUES if a request is already in flight (mutation OR
 *    another GET) and fires from that request's `.finally()` once it settles
 *    — never silently dropped (this generalizes the original CR-101 "queued,
 *    not dropped" GET-vs-GET fix to also cover GET-vs-mutation).
 * With at most one request ever outstanding, "issued after" and "lands after"
 * are the same thing by construction — the four races above (two mutations
 * racing each other; a GET racing a mutation either direction) cannot occur,
 * not merely "are guarded against".
 *
 * `<EngineSettingsPanel>` disables BOTH the autonomy and tier-policy controls
 * whenever ANYTHING is in flight (`loading || pendingAutonomyDefault ||
 * pendingTierPolicy`), not only the one just clicked — the AC's "disable that
 * control" is satisfied (the clicked control is certainly among the disabled
 * ones) and this is what upholds the serialization invariant end to end: a
 * real operator can never even attempt to start a second concurrent request.
 *
 * ## The one guard this hook still keeps (Tom's instruction, verbatim)
 * "The GET needs exactly one guard: a single 'latest applied response'
 * counter, incremented on every applied response (GET or mutation), ignoring
 * anything older on landing. One counter, one rule, no per-field
 * bookkeeping." Implemented as `nextSeq`/`appliedSeq` below: every issued
 * request gets the next sequence number; on landing, a response is applied
 * (written into `settings`) only if its own sequence is STRICTLY NEWER than
 * whatever has already been applied. Given the serialization above, this
 * guard's "discard" branch should be structurally unreachable through normal
 * use (there is never a second request in flight to race against) — it is
 * kept anyway as the cheap, explicit belt-and-braces Tom's instruction calls
 * for, and as protection if a future change ever loosens the serialization.
 * There is deliberately NO second sequence number, NO per-field tracker, and
 * NO confirmed-vs-optimistic split — if a change here starts to need one of
 * those, that is the exact shape that failed three times; delete rather than
 * guard.
 *
 * ## MOCK <-> LIVE (`USE_MOCK_DATA`, `@/core/config/mockData`)
 * Mock renders a plausible static snapshot with NO network call — matching
 * every other engine hook's mock/live split. A mock mutation updates the
 * local snapshot INSTANTLY and directly (there is no server to race, so
 * nothing here needs the serialization/sequencing above at all); `refetch()`
 * is a no-op under mock (there is nothing to refetch — the mock store already
 * reflects every local mutation immediately).
 *
 * ## `forbidden` IS STICKY (story 05 AC6/#297)
 * A 403 means "assigned staff but not a controller" — once seen from ANY
 * mutating call, the panel renders read-only from then on. A LATER successful
 * GET must NEVER clear it back to `false` — `GET /settings` is deliberately
 * 200 for a non-controller (an evaluator can watch), so this hook's own
 * open-transition refetch would otherwise silently re-enable the controls the
 * moment the panel is reopened.
 *
 * ## STORY 07 — the generation-provider cut/restore lever (ADP-042)
 * `cutGenerationToFake`/`restoreGenerationProvider` are a THIRD pair of
 * mutations added onto the SAME hook, reusing every mechanism above verbatim:
 * await-then-apply (no speculative value), the shared per-exercise
 * `requestInFlight` serialization (a provider-lever click is a no-op while
 * the GET or either OTHER mutation is outstanding, and vice versa — one
 * shared guard across all four mutation kinds, not a fourth parallel one),
 * and the single sequence-number "latest applied response" guard. A single
 * `pendingProviderLever` flag covers both directions (cut and restore can
 * never both be the live control at once — the panel renders exactly one of
 * them depending on `providerCutToFake`), mirroring `pendingAutonomyDefault`/
 * `pendingTierPolicy`'s per-control shape.
 *
 * **WR-003, applied to the provider axis.** `effectiveProvider` and
 * `providerCutToFake` are read VERBATIM off the applied `EngineSettingsDto` —
 * this hook (and `<EngineSettingsPanel>`) never re-derives "a cut is active,
 * therefore effectively Fake" by comparing `provider` against
 * `providerCutToFake`. That is exactly the mislabelled-posture bug class the
 * configured/effective split exists to prevent, now on a second field pair.
 *
 * **`alreadyFake` is presented honestly, not discarded.** When the startup-
 * configured provider is already `Fake` (every environment today, including
 * UAT), the backend reports a real no-op via `alreadyFake: true` rather than
 * a false "I just locked something down" signal. This hook passes that fact
 * straight through in `settings.alreadyFake`; the panel renders the cut
 * control as INERT (disabled, with an explanatory note) rather than
 * presenting a control that looks live but does nothing.
 *
 * **No telemetry emitted here either** — story 07's two endpoints emit their
 * own server-side `engine.provider_changed` event on both directions (see
 * that story's Build notes), so this hook stays silent for the same reason
 * the settings mutations above do: a client emission would double the audit
 * record.
 *
 * ## PER-EXERCISE SCOPE (COR-001)
 * Module-singleton store keyed by `exerciseId` — mirrors `useEngineControl`'s
 * / `useSwampedMode`'s shape (`subscribe`/`resetForTests`), so a remount under
 * a different exercise reads a distinct snapshot and no exercise's engine
 * settings leak into another's.
 *
 * ## NO TELEMETRY EMITTED HERE
 * Unlike the kill switch (whose backend endpoints emit no autonomy events, so
 * the frontend emit is the sole audit trail), story 05's two settings
 * endpoints emit their own server-side XC-004 events
 * (`engine.autonomy_default_changed` / `engine.tier_policy_changed`) — see
 * that story's "Build notes". Duplicating an emit here would double the audit
 * record, so this hook intentionally emits nothing.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { useExerciseContext } from '@/core/exerciseContext'
import { useControllerIdentity } from '../../identity/controllerIdentity'
import {
  cutGenerationToFake as postCutGenerationToFake,
  describeSettingsError,
  getSettings as fetchSettings,
  restoreGenerationProvider as postRestoreGenerationProvider,
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
 * UAT's real Generation config today). `provider` is `Fake`, so — matching
 * the live `EngineSettingsDto.From` projection's own logic — `alreadyFake` is
 * `true` and `providerCutToFake` is `false`/`effectiveProvider` equals
 * `provider`: the cut/restore lever is INERT here, exactly as it is in every
 * environment today (WR-002/story 07 — this mock is what UAT actually runs
 * on, so it must render the SAME honest "nothing to cut" posture the real
 * backend would).
 *
 * `inMemoryStateNote` is a byte-for-byte copy of the backend's
 * `EngineSettingsDto.InMemoryNote` constant (`EngineSettingsContracts.cs`) —
 * kept in sync BY HAND since the two live in different languages with no
 * shared source of truth; see `useEngineSettings.test.ts`'s WR-002 content
 * assertion for the guard that catches this copy drifting out of sync again.
 *
 * Exported (Gate-2 fold WR-G2-007) so `EngineSettingsPanel.test.tsx`'s own
 * `dto()` fixture factory can read `inMemoryStateNote` off THIS constant
 * instead of re-typing the note string a third time — one frontend source of
 * truth for the wording, still kept in sync by hand against the backend
 * constant across the language boundary.
 */
export const MOCK_ENGINE_SETTINGS: EngineSettingsDto = {
  provider: 'Fake',
  effectiveProvider: 'Fake',
  providerCutToFake: false,
  alreadyFake: true,
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
    'Autonomy default, tier-policy mode and the generation-provider cut are held in process ' +
    'memory; a restart resets them to suggest / auto / the startup-configured provider.',
}

// ---------------------------------------------------------------------------
// The per-exercise module-singleton store (mirrors `useEngineControl`'s shape)
// ---------------------------------------------------------------------------

interface EngineSettingsState {
  /** `null` while the live GET hasn't resolved yet (mock is never `null`). */
  readonly settings: EngineSettingsDto | null
  /** A GET is in flight (initial load or an explicit `refetch()`). */
  readonly loading: boolean
  /** The last relevant failure's display message, or `null`. */
  readonly error: string | null
  /**
   * `true` once a 403 has been seen from a mutating call — the panel renders
   * read-only from then on (story 05 AC6/#297). STICKY: a later successful
   * GET never clears this back to `false`.
   */
  readonly forbidden: boolean
  /** The autonomy-default POST is outstanding — disable ONLY that control. */
  readonly pendingAutonomyDefault: boolean
  /** The tier-policy POST is outstanding — disable ONLY that control. */
  readonly pendingTierPolicy: boolean
  /**
   * The provider-lever POST (cut OR restore — see module header, story 07) is
   * outstanding — disable that control. One flag covers both directions:
   * exactly one of the cut/restore controls is ever rendered at a time.
   */
  readonly pendingProviderLever: boolean
}

const DEFAULT_STATE: EngineSettingsState = {
  settings: null,
  loading: false,
  error: null,
  forbidden: false,
  pendingAutonomyDefault: false,
  pendingTierPolicy: false,
  pendingProviderLever: false,
}

const MOCK_STATE: EngineSettingsState = {
  settings: MOCK_ENGINE_SETTINGS,
  loading: false,
  error: null,
  forbidden: false,
  pendingAutonomyDefault: false,
  pendingTierPolicy: false,
  pendingProviderLever: false,
}

/**
 * Non-reactive bookkeeping alongside the displayed `EngineSettingsState` —
 * deliberately minimal (see the module header: ONE counter, no per-field
 * tracker). Kept OUT of the reactive state since none of it should itself
 * trigger a re-render.
 */
interface EngineSettingsInternal {
  /** Monotonic — incremented once per request ISSUED (GET or either mutation). */
  nextSeq: number
  /** The sequence of the most recently APPLIED response. See module header. */
  appliedSeq: number
  /**
   * `true` whenever ANY request (the GET or either mutation) is outstanding
   * for this exercise — the serialization invariant. See module header.
   */
  requestInFlight: boolean
  /**
   * `true` when an explicit `refetch()` arrived while `requestInFlight` was
   * already `true` — run once the in-flight request settles, never dropped.
   */
  refetchQueued: boolean
}

function defaultInternal(): EngineSettingsInternal {
  return { nextSeq: 0, appliedSeq: 0, requestInFlight: false, refetchQueued: false }
}

/** `exerciseId -> state`. Absent = the default (loading/empty in live; mock reads MOCK_STATE). */
const stateByExercise = new Map<string, EngineSettingsState>()

/** `exerciseId -> internal bookkeeping` (see {@link EngineSettingsInternal}). */
const internalByExercise = new Map<string, EngineSettingsInternal>()

/** Active change listeners; notified on every mutation. */
const listeners = new Set<() => void>()

/** Which exercise ids have completed at least one live GET attempt since mount/invalidate. */
const liveFetchStarted = new Set<string>()

function notify(): void {
  for (const listener of listeners) listener()
}

/**
 * The current state for `exerciseId`. A prior mutation (mock or live) is
 * always read back from the map first — the `USE_MOCK_DATA` fork only
 * decides what an EXERCISE THAT HASN'T MUTATED ANYTHING YET starts from,
 * never a permanent override that would hide a stored update.
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

/** Clears every exercise's state, internal bookkeeping, and listeners. Test-only. */
function resetForTests(): void {
  stateByExercise.clear()
  internalByExercise.clear()
  liveFetchStarted.clear()
  listeners.clear()
}

/**
 * Injects a settings snapshot directly for `exerciseId`, bypassing both the
 * mock default and any live fetch — test-only, for exercising a server state
 * (e.g. a safety clamp, or a post-403 read-only panel) that would otherwise
 * require a real backend round trip to construct. Resets the internal
 * sequencing to a fresh baseline so a subsequently-tested request behaves
 * exactly as if this snapshot were the most recent applied response.
 *
 * MARKS `liveFetchStarted` too (Copilot review finding) — without this, a
 * test that calls `setForTests` and then mounts `useEngineSettings()` under
 * `USE_MOCK_DATA=false` would still trigger `ensureLiveFetchStarted`'s
 * mount-effect GET, since nothing had recorded this exercise as already
 * fetched. That is exactly the "bypasses any live fetch" this seam documents
 * — a seam that silently permits a real request behind a caller's back is
 * how a test ends up passing (or failing) for the wrong reason, not because
 * of what it actually asserts.
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
    pendingAutonomyDefault: false,
    pendingTierPolicy: false,
    pendingProviderLever: false,
  })
  internalByExercise.set(exerciseId, defaultInternal())
  liveFetchStarted.add(exerciseId)
}

/**
 * The module-singleton engine-settings store. Exposed for test-only reset —
 * `setForTests` is a TEST-ONLY fabrication seam and is deliberately NOT
 * re-exported through the feature's public barrel (`engine/index.ts`); import
 * this module directly in tests (mirrors `engineControlStore`, which exposes
 * only `resetForTests`).
 */
export const engineSettingsStore = { getSnapshot, subscribe, resetForTests, setForTests }

// ---------------------------------------------------------------------------
// The serialization primitives (see module header — "one counter, no
// per-field tracker", enforced by never allowing a second request to start)
// ---------------------------------------------------------------------------

/** Issues the next sequence number and marks a request as outstanding. */
function issue(exerciseId: string): number {
  const internal = getInternal(exerciseId)
  internal.requestInFlight = true
  return ++internal.nextSeq
}

/**
 * A request has landed. Applies `mySeq` as the newest APPLIED response only
 * if it is strictly newer than whatever is already applied — the ONE guard
 * this hook keeps (module header). Returns whether it was applied.
 */
function tryApply(exerciseId: string, mySeq: number): boolean {
  const internal = getInternal(exerciseId)
  if (mySeq <= internal.appliedSeq) return false
  internal.appliedSeq = mySeq
  return true
}

/**
 * A request has fully settled (its own `.finally`). Clears the in-flight
 * flag and, if a `refetch()` arrived while this request was outstanding,
 * fires it now — QUEUED, never dropped (generalizes the original CR-101 fix
 * to cover a GET queued behind a MUTATION, not only behind another GET).
 */
function settle(exerciseId: string): void {
  const internal = getInternal(exerciseId)
  internal.requestInFlight = false
  if (internal.refetchQueued) {
    internal.refetchQueued = false
    startLiveFetch(exerciseId)
  }
}

// ---------------------------------------------------------------------------
// The GET
// ---------------------------------------------------------------------------

/**
 * Performs the live GET. If a request is already in flight for this exercise
 * (a mutation OR another GET), this one QUEUES (never silently dropped) and
 * re-runs once the in-flight one settles.
 */
function startLiveFetch(exerciseId: string): void {
  const internal = getInternal(exerciseId)
  if (internal.requestInFlight) {
    internal.refetchQueued = true
    return
  }
  liveFetchStarted.add(exerciseId)
  const mySeq = issue(exerciseId)

  setFor(exerciseId, { ...getSnapshot(exerciseId), loading: true })

  fetchSettings()
    .then(settings => {
      const current = getSnapshot(exerciseId)
      if (tryApply(exerciseId, mySeq)) {
        setFor(exerciseId, { ...current, settings, loading: false, error: null })
      } else {
        // A strictly newer response has already been applied — this GET's
        // result is discarded, never overwriting that newer truth.
        setFor(exerciseId, { ...current, loading: false })
      }
    })
    .catch((error: unknown) => {
      // WR-004: clear the "started" flag so a later mount/invalidate can
      // retry — a transient blip must not be a PERMANENT load-error state.
      liveFetchStarted.delete(exerciseId)
      const described = describeSettingsError(error)
      const current = getSnapshot(exerciseId)
      setFor(exerciseId, {
        ...current,
        loading: false,
        error: described.message,
        // Sticky either way; a GET 403 (unexpected per story 05 AC6, but
        // handled) also only ever turns this ON, never off.
        forbidden: described.status === 403 ? true : current.forbidden,
      })
    })
    .finally(() => settle(exerciseId))
}

/**
 * Kicks off the ONE-TIME live `GET /api/engine/settings` for `exerciseId` on
 * first mount — idempotent across every hook instance mounted for the same
 * exercise (a second mounted consumer does not refire it). Subsequent
 * freshness is `refetch()`'s job, not this function's.
 */
function ensureLiveFetchStarted(exerciseId: string): void {
  if (liveFetchStarted.has(exerciseId)) return
  startLiveFetch(exerciseId)
}

/**
 * Forces a fresh `GET /api/engine/settings` for `exerciseId`, regardless of
 * whether one already completed — the kill switch mutates the SAME
 * server-side autonomy state this snapshot describes, entirely outside this
 * hook, so a fetch-once cache can silently go stale the moment it's tripped
 * (or the moment the server degrades on its own). Also the WR-004 retry path
 * for a failed initial GET. NEVER silently dropped, even if a request is
 * already in flight (queued instead — see {@link startLiveFetch}). A no-op
 * under mock — there is nothing to refetch.
 */
function invalidate(exerciseId: string): void {
  if (USE_MOCK_DATA) return
  startLiveFetch(exerciseId)
}

// ---------------------------------------------------------------------------
// The two mutations — deliberately NOT unified behind a shared "field"
// abstraction (see module header: no per-field bookkeeping). Each is a
// small, direct, mostly-independent function.
// ---------------------------------------------------------------------------

/** Mirrors story 05 AC2: an unclamped base flip moves `effectiveLevel` with it (mock only). */
function mockApplyAutonomyDefault(
  previous: EngineSettingsDto,
  level: AutonomyDefaultLevel,
): EngineSettingsDto {
  const clamped = previous.autonomy.safetyClampActive || previous.autonomy.generationStopped
  return {
    ...previous,
    autonomy: {
      ...previous.autonomy,
      exerciseDefaultLevel: level,
      effectiveLevel: clamped ? previous.autonomy.effectiveLevel : level,
    },
  }
}

/**
 * Mirrors story 07's server-side idempotency (`EngineProviderCutServiceTests.
 * Cut_WhenTheConfiguredProviderIsAlreadyFake_IsAnHonestNoOp_WithNoTelemetry`):
 * cutting is a genuine no-op — returns the SAME object, not a copy — when the
 * configured provider is already `Fake` or a cut is already active. Otherwise
 * flips `providerCutToFake` on and `effectiveProvider` to `Fake`, leaving
 * `provider` untouched (the startup-configured provider's meaning never
 * changes — same discipline as the live `EngineSettingsDto.From` projection).
 */
function mockApplyCutToFake(previous: EngineSettingsDto): EngineSettingsDto {
  if (previous.alreadyFake || previous.providerCutToFake) return previous
  return { ...previous, providerCutToFake: true, effectiveProvider: 'Fake' }
}

/**
 * Mirrors story 07's server-side idempotency
 * (`EngineProviderCutServiceTests.Restore_WithNoCutActive_IsAnIdempotentNoOp_WithNoTelemetry`):
 * restoring when no cut is active is a genuine no-op. Otherwise returns
 * generation to the startup-configured `provider` — never a third provider
 * (§8.2's "human-only raise, capped at the pre-existing baseline").
 */
function mockApplyRestoreProvider(previous: EngineSettingsDto): EngineSettingsDto {
  if (!previous.providerCutToFake) return previous
  return { ...previous, providerCutToFake: false, effectiveProvider: previous.provider }
}

function runSetAutonomyDefault(
  exerciseId: string,
  level: AutonomyDefaultLevel,
  ctx: { readonly actingHumanId: string; readonly timeZone: string },
): void {
  const current = getSnapshot(exerciseId)
  if (!current.settings) return // not loaded yet
  if (current.settings.autonomy.exerciseDefaultLevel === level) return // no-op, already this value

  if (USE_MOCK_DATA) {
    // No server to await — there is nothing to race, so the mock applies
    // instantly and directly (no pending flag ever observably flips true).
    setFor(exerciseId, { ...current, settings: mockApplyAutonomyDefault(current.settings, level) })
    return
  }

  const internal = getInternal(exerciseId)
  // Defensive — the UI already disables this control whenever anything is
  // in flight (the serialization invariant), so this should be unreachable
  // through normal use.
  if (internal.requestInFlight) return

  const mySeq = issue(exerciseId)
  setFor(exerciseId, { ...current, pendingAutonomyDefault: true, error: null })

  postAutonomyDefault(level, ctx)
    .then(settings => {
      const latest = getSnapshot(exerciseId)
      if (tryApply(exerciseId, mySeq)) {
        setFor(exerciseId, { ...latest, settings, pendingAutonomyDefault: false, error: null })
      } else {
        setFor(exerciseId, { ...latest, pendingAutonomyDefault: false })
      }
    })
    .catch((error: unknown) => {
      // No revert — nothing was ever asserted. Re-enable the control and
      // surface the failure; `settings` is untouched.
      const described = describeSettingsError(error)
      const latest = getSnapshot(exerciseId)
      setFor(exerciseId, {
        ...latest,
        pendingAutonomyDefault: false,
        error: described.message,
        forbidden: described.status === 403 ? true : latest.forbidden,
      })
    })
    .finally(() => settle(exerciseId))
}

function runSetTierPolicyMode(
  exerciseId: string,
  mode: TierPolicyMode,
  ctx: { readonly actingHumanId: string; readonly timeZone: string },
): void {
  const current = getSnapshot(exerciseId)
  if (!current.settings) return
  if (current.settings.tierPolicyMode === mode) return

  if (USE_MOCK_DATA) {
    setFor(exerciseId, { ...current, settings: { ...current.settings, tierPolicyMode: mode } })
    return
  }

  const internal = getInternal(exerciseId)
  if (internal.requestInFlight) return

  const mySeq = issue(exerciseId)
  setFor(exerciseId, { ...current, pendingTierPolicy: true, error: null })

  postTierPolicyMode(mode, ctx)
    .then(settings => {
      const latest = getSnapshot(exerciseId)
      if (tryApply(exerciseId, mySeq)) {
        setFor(exerciseId, { ...latest, settings, pendingTierPolicy: false, error: null })
      } else {
        setFor(exerciseId, { ...latest, pendingTierPolicy: false })
      }
    })
    .catch((error: unknown) => {
      const described = describeSettingsError(error)
      const latest = getSnapshot(exerciseId)
      setFor(exerciseId, {
        ...latest,
        pendingTierPolicy: false,
        error: described.message,
        forbidden: described.status === 403 ? true : latest.forbidden,
      })
    })
    .finally(() => settle(exerciseId))
}

/**
 * Cuts this exercise's generation to `Fake` (story 07, ADP-042). Same await-
 * then-apply / serialization contract as {@link runSetAutonomyDefault} — no
 * speculative value, `pendingProviderLever` flips while the POST is
 * outstanding, the full authoritative response is applied verbatim on
 * success, and there is no revert on rejection. Under mock, applies the
 * SAME idempotent no-op logic the live backend applies server-side
 * ({@link mockApplyCutToFake}) — instantly, no network call.
 */
function runCutGenerationToFake(
  exerciseId: string,
  ctx: { readonly actingHumanId: string; readonly timeZone: string },
): void {
  const current = getSnapshot(exerciseId)
  if (!current.settings) return // not loaded yet

  if (USE_MOCK_DATA) {
    setFor(exerciseId, { ...current, settings: mockApplyCutToFake(current.settings) })
    return
  }

  const internal = getInternal(exerciseId)
  // Defensive — the UI already disables the lever whenever anything is in
  // flight (the shared serialization invariant), so this should be
  // unreachable through normal use.
  if (internal.requestInFlight) return

  const mySeq = issue(exerciseId)
  setFor(exerciseId, { ...current, pendingProviderLever: true, error: null })

  postCutGenerationToFake(ctx)
    .then(settings => {
      const latest = getSnapshot(exerciseId)
      if (tryApply(exerciseId, mySeq)) {
        setFor(exerciseId, { ...latest, settings, pendingProviderLever: false, error: null })
      } else {
        setFor(exerciseId, { ...latest, pendingProviderLever: false })
      }
    })
    .catch((error: unknown) => {
      // No revert — nothing was ever asserted. Re-enable the control and
      // surface the failure; `settings` is untouched.
      const described = describeSettingsError(error)
      const latest = getSnapshot(exerciseId)
      setFor(exerciseId, {
        ...latest,
        pendingProviderLever: false,
        error: described.message,
        forbidden: described.status === 403 ? true : latest.forbidden,
      })
    })
    .finally(() => settle(exerciseId))
}

/**
 * Restores this exercise's generation to the startup-configured provider
 * (story 07, ADP-042 §8.2). Same await-then-apply / serialization contract as
 * {@link runCutGenerationToFake}. Under mock, applies
 * {@link mockApplyRestoreProvider}'s idempotent no-op logic instantly.
 */
function runRestoreGenerationProvider(
  exerciseId: string,
  ctx: { readonly actingHumanId: string; readonly timeZone: string },
): void {
  const current = getSnapshot(exerciseId)
  if (!current.settings) return

  if (USE_MOCK_DATA) {
    setFor(exerciseId, { ...current, settings: mockApplyRestoreProvider(current.settings) })
    return
  }

  const internal = getInternal(exerciseId)
  if (internal.requestInFlight) return

  const mySeq = issue(exerciseId)
  setFor(exerciseId, { ...current, pendingProviderLever: true, error: null })

  postRestoreGenerationProvider(ctx)
    .then(settings => {
      const latest = getSnapshot(exerciseId)
      if (tryApply(exerciseId, mySeq)) {
        setFor(exerciseId, { ...latest, settings, pendingProviderLever: false, error: null })
      } else {
        setFor(exerciseId, { ...latest, pendingProviderLever: false })
      }
    })
    .catch((error: unknown) => {
      const described = describeSettingsError(error)
      const latest = getSnapshot(exerciseId)
      setFor(exerciseId, {
        ...latest,
        pendingProviderLever: false,
        error: described.message,
        forbidden: described.status === 403 ? true : latest.forbidden,
      })
    })
    .finally(() => settle(exerciseId))
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/** The surface `<EngineSettingsPanel>` and `<EngineControlBar>` both bind to. */
export interface UseEngineSettingsResult {
  /** The current settings snapshot. `null` only while the initial live GET is in flight. */
  readonly settings: EngineSettingsDto | null
  /** A GET is in flight (initial load or `refetch()`). Always `false` under mock. */
  readonly loading: boolean
  /** The last relevant failure's display message, or `null`. */
  readonly error: string | null
  /** `true` once a 403 has been seen — render the panel read-only (story 05 AC6/#297). STICKY. */
  readonly forbidden: boolean
  /** The autonomy-default POST is outstanding — disable that control (see module header). */
  readonly pendingAutonomyDefault: boolean
  /** The tier-policy POST is outstanding. */
  readonly pendingTierPolicy: boolean
  /**
   * The generation-provider cut/restore POST (story 07) is outstanding —
   * disable that control. One flag for both directions (see
   * {@link EngineSettingsState.pendingProviderLever}).
   */
  readonly pendingProviderLever: boolean
  /**
   * Requests the exercise autonomy default. AWAITS the response and applies
   * it verbatim on success; on rejection, re-enables the control and surfaces
   * the error — `settings` is untouched either way until a response lands.
   * A no-op if `settings` isn't loaded yet, `level` already matches the
   * current base default, or a request is already in flight.
   */
  readonly setAutonomyDefault: (level: AutonomyDefaultLevel) => void
  /** Requests the tier-policy mode. Same await-then-apply contract as
   * {@link setAutonomyDefault}. */
  readonly setTierPolicyMode: (mode: TierPolicyMode) => void
  /**
   * Cuts this exercise's generation to `Fake` (story 07, ADP-042). Same
   * await-then-apply contract as {@link setAutonomyDefault}. When the
   * configured provider is already `Fake`, the applied response reports
   * `alreadyFake: true` — an honest no-op, not a false success.
   */
  readonly cutGenerationToFake: () => void
  /**
   * Restores this exercise's generation to the startup-configured provider
   * (story 07, §8.2 — capped at the pre-existing baseline, never a third
   * provider). Same await-then-apply contract as {@link setAutonomyDefault}.
   */
  readonly restoreGenerationProvider: () => void
  /**
   * Forces a fresh `GET /api/engine/settings` — a no-op under mock. Callers
   * refetch whenever a safety-relevant sibling state SETTLES (the kill
   * switch's live POST concluding — never the optimistic flip itself) or
   * right before the operator is about to look (the flyout opening). Queued,
   * never dropped, if a request is already in flight.
   */
  readonly refetch: () => void
}

/**
 * The per-exercise engine settings read/write hook. See the module header for
 * the full mock/live + serialization contract. Must be called under an
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
      runSetAutonomyDefault(exerciseId, level, { actingHumanId: identity.actingHumanId, timeZone })
    },
    [exerciseId, identity.actingHumanId, timeZone],
  )

  const setTierPolicyModeCb = useCallback(
    (mode: TierPolicyMode) => {
      runSetTierPolicyMode(exerciseId, mode, { actingHumanId: identity.actingHumanId, timeZone })
    },
    [exerciseId, identity.actingHumanId, timeZone],
  )

  const cutGenerationToFakeCb = useCallback(() => {
    runCutGenerationToFake(exerciseId, { actingHumanId: identity.actingHumanId, timeZone })
  }, [exerciseId, identity.actingHumanId, timeZone])

  const restoreGenerationProviderCb = useCallback(() => {
    runRestoreGenerationProvider(exerciseId, { actingHumanId: identity.actingHumanId, timeZone })
  }, [exerciseId, identity.actingHumanId, timeZone])

  const refetchCb = useCallback(() => {
    invalidate(exerciseId)
  }, [exerciseId])

  return {
    settings: state.settings,
    loading: state.loading,
    error: state.error,
    forbidden: state.forbidden,
    pendingAutonomyDefault: state.pendingAutonomyDefault,
    pendingTierPolicy: state.pendingTierPolicy,
    pendingProviderLever: state.pendingProviderLever,
    setAutonomyDefault: setAutonomyDefaultCb,
    setTierPolicyMode: setTierPolicyModeCb,
    cutGenerationToFake: cutGenerationToFakeCb,
    restoreGenerationProvider: restoreGenerationProviderCb,
    refetch: refetchCb,
  }
}
