/**
 * features/controller/hooks/useStorylineTarget.ts
 * ---------------------------------------------------------------------------
 * The escalation-dial's target-setting hook (feature: world-steering, story 02
 * — "Escalation dial — actual + target, engine follows"; CTL-022 / D5-014/2.2.
 * story 09 — "Escalation dial live" — adds the LIVE branch below). STAFF
 * world — pure hook, no UI, no COBRA.
 *
 * MOCK <-> LIVE (story 09 flip; mirrors `useReviewQueue`'s `USE_MOCK_DATA`
 * split — `@/core/config/mockData`). Both branches expose the BYTE-FOR-BYTE
 * same `UseStorylineTargetResult` shape — `<EscalationDial>` needs no
 * awareness of which is active:
 *
 *   - MOCK (dev/UAT default, and every pre-existing story-02 test — UNCHANGED
 *     behavior): reads the mock storyline's actual state (`intensity` +
 *     `phase`, from `storylineMock`) and mutates it synchronously via
 *     `storylineMock.setTargetIntensity`. Always reports `dataStatus: 'live'`
 *     — the mock is always synchronously present, never loading/unavailable.
 *   - LIVE (`USE_MOCK_DATA === false`): reads the live storyline via
 *     `liveStorylineStore` (an initial `GET /api/steering/storylines/{id}`
 *     plus a ~5s poll — no push, story 09 stays file-disjoint from story 08's
 *     broadcaster work) and writes via `liveStorylineActions.setStorylineTarget`
 *     (`POST .../target`), which returns the AUTHORITATIVE actual/target/phase
 *     the dial's optimistic local update reconciles against (AC2). Wave-1/2
 *     has no Stories board (D5-016/017) yet, so the live branch addresses the
 *     exercise's storyline via `PRIMARY_STORYLINE_SENTINEL` until the first
 *     successful call resolves the real storyline id (then used for every
 *     subsequent call) — mirrors the mock branch's hard-coded
 *     `MOCK_STORYLINE_ID` until a future multi-storyline board keys the store
 *     by id.
 *
 * DATA STATUS, NEVER FABRICATED (Gate-1 CR-002). `dataStatus` distinguishes
 * "no confirmed live read yet" from "genuinely quiet" — a null/failed GET
 * (including the accepted post-App-Service-restart 404-forever limitation,
 * itself SELF-HEALING per the next successful poll tick, Gate-2 W-105) must
 * never present as `ACTUAL 0 / DORMANT`, which is indistinguishable from a
 * real quiet storyline. `intensity`/`targetIntensity`/`phase` fall back to
 * safe placeholders while `dataStatus !== 'live'` ONLY so the type stays
 * non-nullable for the mock branch's sake; `<EscalationDial>` MUST gate its
 * numeric display on `dataStatus` rather than trust those placeholders as
 * fact.
 *
 * In BOTH modes:
 *   - `setTarget(value)` clamps 0-100 and records the change (mirroring
 *     `Storyline.SetTargetIntensity`'s from/to semantics).
 *   - `clearTarget()` unsets the target (`setTargetIntensity(null)`).
 *   - A call that SETTLES to the SAME value as the current CONFIRMED target
 *     (e.g. `End` while already at 100) records + emits NOTHING — guards
 *     against redundant `"100 -> 100"`-style events (XC-004 hygiene).
 *   - Otherwise, each SETTLED commit emits exactly ONE `steering_action`
 *     telemetry event (XC-004) via the caller-safe `buildAndEmit`, mirroring
 *     `reviewActions.ts`'s `emitReviewed()` shape: `channel: 'system'`,
 *     `actor: { kind: 'system', actingHumanId, role }` (a controller/system
 *     action on world state, not engine-authored content — never `'engine'`),
 *     `target: { entityType: 'storyline', entityId }`, `payload` carrying the
 *     before/after detail string (`"78 → 60"` / `"none → 60"`). Emitted
 *     CLIENT-SIDE ONLY (unchanged in shape from the mock branch) — the live
 *     POST endpoint emits no `steering_action` telemetry of its own, so this
 *     is the ONE emission per commit either way (no double-emit, XC-004).
 *
 * COALESCED LIVE COMMITS (Gate-2 W-102, first half). The keyboard path
 * commits one call per keydown, so OS auto-repeat under a held arrow key
 * fires a BURST of calls — mirroring `<EscalationDial>`'s drag = one-commit
 * rule, the LIVE branch coalesces a burst of calls arriving within
 * `LIVE_COMMIT_DEBOUNCE_MS` of each other into ONE POST + ONE telemetry
 * event, using the BURST's baseline (the confirmed value before the first
 * call) and the LATEST requested value. The optimistic NUMBER (and the
 * pending detail text) still update on every call for live visual feedback;
 * only the network request and the telemetry emission are deferred to the
 * point where the burst goes quiet. The MOCK branch is unaffected — its
 * write is synchronous and unchanged from story 02.
 *
 * REQUEST-ORDERING TOKEN (Gate-2 W-102, second half + S-103). Coalescing
 * shrinks how OFTEN concurrent writes happen, but does not eliminate the
 * possibility (two separate bursts, or two mounted dials) — a response can
 * still arrive out of ISSUE order. `liveStorylineStore.beginWrite()` hands
 * back a monotonic token for the SAME storyline id-session; `reconcile`/
 * `refetchNow` calls carrying a token that is no longer current are silently
 * dropped by the store, and this hook additionally gates its OWN
 * `pendingChangeDetail`/`lastChangeDetail`/`writeError` promotion on
 * `liveStorylineStore.isCurrentWrite(token)` — a stale response never
 * announces itself as the confirmed outcome, however late it lands.
 *
 * NEVER CLAIM A CHANGE BEFORE IT LANDS (Gate-1 CR-001). `lastChangeDetail` —
 * the text an `aria-live="polite"` status line announces as FACT — is
 * promoted only in the LIVE branch's POST `.then`, after `reconcile`; before
 * that it is exposed separately as `pendingChangeDetail` ("in flight, not yet
 * confirmed" — `<EscalationDial>` renders this with an explicit qualifier,
 * Gate-2 W-101, never the bare confirmed string). On a rejected POST (a 404
 * after an App Service restart, a 401 on session expiry, a network blip, or
 * axios's own request `timeout`, Gate-2 W-101) the pending detail is cleared
 * and `writeError` is set instead (worded to claim only what the client can
 * actually know, Gate-2 W-103: it could not CONFIRM the change, not that the
 * server definitely never applied it) — the dial must render an explicit
 * failure (icon + text, NFR-001), never announce a target change that was
 * never confirmed. The MOCK branch's write is synchronous (no network round
 * trip, so no window in which to announce a change before it lands) and
 * keeps setting `lastChangeDetail` directly, exactly as story 02 shipped it.
 *
 * THE NO-OP GUARD IS CONFIRMED-ONLY (Gate-2 W-104). The "same value" check
 * only short-circuits a BRAND-NEW burst against a CONFIRMED
 * (`dataStatus === 'live'`) baseline — a retained-but-never-confirmed value
 * (e.g. after a failed POST whose own re-sync ALSO failed) must never
 * silently suppress a genuine retry: no POST, no telemetry, and a stale
 * `writeError` left on screen forever. `writeError` is cleared at the very
 * TOP of every attempt (before any early return), so a retry always clears a
 * stale failure banner even when the settled value nets out to a no-op.
 *
 * RE-SYNC ON FAILURE, NOT A BLIND REVERT (Gate-1 S-003). Rather than
 * restoring a captured pre-POST snapshot (which could clobber a poll that
 * landed in between the optimistic update and the rejection), a failed POST
 * calls `liveStorylineStore.refetchNow` — the server's GET is the ground
 * truth. This also fixes the "nothing has loaded yet" gap: `refetchNow` runs
 * regardless of whether a prior snapshot existed.
 *
 * ISOLATION (COR-001) — `exerciseId`/`timeZone` from `useExerciseContext()`
 * STAMP the telemetry event only, never a fetch-scoping parameter (the live
 * GET/POST carry no client `exerciseId` either — scope is server-
 * authoritative). STAFF-ONLY (XC-002) — `useControllerIdentity()` supplies the
 * acting human + role.
 *
 * SUBSCRIPTION + LIFECYCLE — reads either store via `useSyncExternalStore` so
 * every mount reacts to a change from ANY source (this hook, another mounted
 * dial, or — live only — the poll / the engine's own tick). LIVE ONLY: the
 * `useEffect` acquires the poll on mount and releases it on unmount
 * (`liveStorylineStore.ensureStarted`/`release`, Gate-1 W-006 reference
 * counting) — the poll runs only while at least one `<EscalationDial>` is
 * actually mounted, not for the lifetime of the tab regardless. A pending
 * debounce timer is cleared on unmount too, so no state update fires after
 * the component is gone.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useExerciseContext } from '@/core/exerciseContext'
import { scenarioNow } from '@/core/clock'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { buildAndEmit } from '@/core/telemetry'
import { wallClockNowIso } from '@/core/time/wallClock'
import { useControllerIdentity } from '../identity/controllerIdentity'
import {
  MOCK_STORYLINE_ID,
  phaseLabel,
  storylineMock,
  type StorylinePhase,
} from '../services/storylineMock'
import {
  PRIMARY_STORYLINE_SENTINEL,
  setStorylineTarget as liveSetStorylineTarget,
} from '../services/liveStorylineActions'
import { liveStorylineStore, type LiveStorylineDataStatus } from '../services/liveStorylineStore'

/**
 * Mirrors `Storyline.FormatTarget` — `null` renders as the literal `"none"`
 * (the XC-004 detail convention).
 */
function formatTarget(value: number | null): string {
  return value === null ? 'none' : String(value)
}

/**
 * How long a LIVE burst of calls (e.g. keyboard auto-repeat) waits for
 * quiet before actually committing (Gate-2 W-102) — short enough to feel
 * immediate for a single click/drag commit, long enough to coalesce an
 * OS-repeat cadence (typically ~30-50ms between repeats) into one request.
 */
const LIVE_COMMIT_DEBOUNCE_MS = 150

/** The escalation dial's read/write surface for one storyline's target. */
export interface UseStorylineTargetResult {
  /**
   * The storyline this target applies to. Wave-1/2 is single-storyline: MOCK
   * is always `MOCK_STORYLINE_ID`; LIVE is `PRIMARY_STORYLINE_SENTINEL` until
   * the first GET/POST resolves the exercise's real storyline id (then that
   * real id). A multi-storyline board (D5-016/017, deferred) will key both
   * stores by id and select here.
   */
  readonly storylineId: string
  /**
   * The storyline's human title (Gate-1 W-008) — so the dial can name what
   * it is steering. Empty until known.
   */
  readonly title: string
  /**
   * Whether `intensity`/`targetIntensity`/`phase` are a confirmed live read
   * (Gate-1 CR-002). Always `'live'` under mock. `<EscalationDial>` MUST NOT
   * present the numeric fields as fact while this is not `'live'`.
   */
  readonly dataStatus: LiveStorylineDataStatus
  /**
   * Actual intensity, 0-100 (`Storyline.Intensity`) — the track's fill.
   * Meaningful only when `dataStatus === 'live'`.
   */
  readonly intensity: number
  /**
   * Controller-set target, 0-100, or `null` when unset
   * (`Storyline.TargetIntensity`). Meaningful only when `dataStatus === 'live'`.
   */
  readonly targetIntensity: number | null
  /** Mirrors `StorylinePhase` (`Storyline.Phase`). Meaningful only when `dataStatus === 'live'`. */
  readonly phase: StorylinePhase
  /** Uppercase phase label, exactly as `StorylineBriefProjection.PhaseLabel` produces it. */
  readonly phaseLabel: string
  /**
   * The from/to detail of the most recent CONFIRMED target change this
   * session (e.g. `"78 → 60"`, `"none → 60"`) — only ever set AFTER the
   * backend actually applied it (mirrors `Storyline.SetTargetIntensity`'s
   * detail-string convention). `null` before any change has landed yet.
   */
  readonly lastChangeDetail: string | null
  /**
   * LIVE ONLY (Gate-1 CR-001): the from/to detail of a change that has been
   * REQUESTED but not yet confirmed by the POST's authoritative response —
   * distinct from `lastChangeDetail`, which is never set until confirmation.
   * Updates live as a coalescing burst continues (Gate-2 W-102). Always
   * `null` under mock (the mock write is synchronous — no in-flight window).
   * `null` once the request settles (success promotes it to
   * `lastChangeDetail`; failure clears it and sets `writeError`).
   */
  readonly pendingChangeDetail: string | null
  /**
   * LIVE ONLY (Gate-1 CR-001): a human-readable failure message when the
   * most recent target-change POST was rejected — the dial must render this
   * explicitly (icon + text, NFR-001) rather than silently leaving the
   * controller to infer failure from nothing changing. Cleared at the very
   * START of the NEXT attempt (Gate-2 W-104), even one that settles to a
   * no-op. Always `null` under mock.
   */
  readonly writeError: string | null
  /** Sets the target (clamped 0-100), records it, and emits one `steering_action` event. */
  readonly setTarget: (value: number) => void
  /** Clears the target (`targetIntensity` -> `null`) and emits one `steering_action` event. */
  readonly clearTarget: () => void
}

/**
 * Safe placeholder values while the LIVE snapshot is not `'live'` (before the
 * first GET resolves, or after one fails) — NEVER presented as fact by
 * `<EscalationDial>`, which gates its numeric display on `dataStatus`
 * (Gate-1 CR-002).
 */
const LIVE_PLACEHOLDER = {
  title: '',
  intensity: 0,
  targetIntensity: null as number | null,
  phase: 'Dormant' as StorylinePhase,
}

/**
 * A human-readable write failure — the dial renders this with icon + text
 * (NFR-001), never silently. Worded (Gate-2 W-103) to claim only what the
 * client can actually know: the change was not CONFIRMED — a wire-validation
 * failure or a request timeout may well have applied server-side, so this
 * must never assert "was not applied" as a fact the client cannot verify.
 * The dial has already been re-synced from the server by the time this
 * shows (see `refetchNow` in the `.catch` below), so the displayed value is
 * the ground truth regardless of what actually happened server-side.
 */
const WRITE_ERROR_MESSAGE =
  'Could not confirm the target change — the dial has been re-synced from the server. Check the value and try again.'

/**
 * The escalation dial's target-management hook. See the module header for the
 * full MOCK/LIVE contract; `<EscalationDial>` is its intended consumer.
 *
 * Wave-1/2 is single-storyline: the hook always targets one storyline (see
 * `storylineId`'s doc) — a `storylineId` selector param is deliberately NOT
 * accepted yet (a false affordance while neither store is keyed by id); it
 * arrives with the multi-storyline board (D5-016/017, deferred).
 */
export function useStorylineTarget(): UseStorylineTargetResult {
  const { exerciseId, timeZone } = useExerciseContext()
  const { actingHumanId, role } = useControllerIdentity()

  // LIVE only: acquire the poll on mount, release it on unmount (Gate-1
  // W-006 reference counting — the poll runs only while something is
  // actually mounted to read it). No-op under mock data.
  useEffect(() => {
    if (USE_MOCK_DATA) return
    liveStorylineStore.ensureStarted(PRIMARY_STORYLINE_SENTINEL)
    return () => {
      liveStorylineStore.release()
    }
  }, [])

  const mockStoryline = useSyncExternalStore(
    storylineMock.subscribe,
    storylineMock.getStoryline,
    storylineMock.getStoryline,
  )
  const liveSnapshot = useSyncExternalStore(
    liveStorylineStore.subscribe,
    liveStorylineStore.getSnapshot,
    liveStorylineStore.getSnapshot,
  )

  const [lastChangeDetail, setLastChangeDetail] = useState<string | null>(null)
  const [pendingChangeDetail, setPendingChangeDetail] = useState<string | null>(null)
  const [writeError, setWriteError] = useState<string | null>(null)

  // Gate-2 W-102: the in-flight LIVE coalescing burst, if any. Captured ONCE
  // per burst (baseline/targetId); only `latestValue` and the timer change
  // as further calls arrive within LIVE_COMMIT_DEBOUNCE_MS.
  const liveBurstRef = useRef<{
    readonly baselineFrom: number | null
    readonly baselineConfirmed: boolean
    readonly targetId: string
    latestValue: number | null
    timer: ReturnType<typeof setTimeout>
  } | null>(null)

  // Clears any pending debounce timer on unmount — no state update fires
  // after the component is gone.
  useEffect(() => {
    return () => {
      if (liveBurstRef.current) clearTimeout(liveBurstRef.current.timer)
    }
  }, [])

  const liveData = liveSnapshot.data
  const dataStatus: LiveStorylineDataStatus = USE_MOCK_DATA ? 'live' : liveSnapshot.status

  const storylineId = USE_MOCK_DATA
    ? MOCK_STORYLINE_ID
    : (liveData?.storylineId ?? PRIMARY_STORYLINE_SENTINEL)
  const title = USE_MOCK_DATA ? mockStoryline.title : (liveData?.title ?? LIVE_PLACEHOLDER.title)
  const intensity = USE_MOCK_DATA
    ? mockStoryline.intensity
    : (liveData?.intensity ?? LIVE_PLACEHOLDER.intensity)
  const targetIntensity = USE_MOCK_DATA
    ? mockStoryline.targetIntensity
    : (liveData?.targetIntensity ?? LIVE_PLACEHOLDER.targetIntensity)
  const phase: StorylinePhase = USE_MOCK_DATA
    ? mockStoryline.phase
    : (liveData?.phase ?? LIVE_PLACEHOLDER.phase)

  const emitSteeringAction = useCallback(
    (targetId: string, from: number | null, to: number | null, detail: string) => {
      buildAndEmit({
        exerciseId,
        eventType: 'steering_action',
        channel: 'system',
        actor: { kind: 'system', actingHumanId, role },
        wallClockTime: wallClockNowIso(),
        scenarioTime: scenarioNow().toISOString(),
        timeZone,
        target: { entityType: 'storyline', entityId: targetId },
        payload: {
          action: 'target-changed',
          from,
          to,
          detail,
        },
      })
    },
    [exerciseId, timeZone, actingHumanId, role],
  )

  // Fires once a LIVE coalescing burst goes quiet (Gate-2 W-102): the actual
  // POST + the ONE telemetry event for the whole burst.
  const commitLiveWrite = useCallback(
    (
      targetId: string,
      baselineFrom: number | null,
      baselineConfirmed: boolean,
      value: number | null,
    ) => {
      // Settled no-op (mirrors the mock's guard, but only against a
      // CONFIRMED baseline, Gate-2 W-104): a burst that nets out to the
      // storyline's own confirmed value records/emits nothing.
      if (baselineConfirmed && baselineFrom === value) {
        setPendingChangeDetail(null)
        return
      }

      const from = baselineConfirmed ? baselineFrom : null
      const detail = `${formatTarget(from)} → ${formatTarget(value)}`
      // Gate-2 W-102: this write's ordering token — any later-superseded
      // response carrying an OLDER token is dropped, regardless of arrival
      // order.
      const token = liveStorylineStore.beginWrite()

      setPendingChangeDetail(detail)

      // Emitted BEFORE the POST settles (mirrors useEngineControl): the audit
      // trail records the attempted change even if the POST later rejects.
      // This is a telemetry record of an ATTEMPT, not a UI claim of success —
      // the UI-facing claim (`lastChangeDetail`) is gated separately below.
      emitSteeringAction(targetId, from, value, detail)

      liveSetStorylineTarget(targetId, value)
        .then(authoritative => {
          liveStorylineStore.reconcile(authoritative, token) // no-ops if stale
          if (liveStorylineStore.isCurrentWrite(token)) {
            setPendingChangeDetail(null)
            setLastChangeDetail(detail)
          }
        })
        .catch(() => {
          if (liveStorylineStore.isCurrentWrite(token)) {
            setPendingChangeDetail(null)
            setWriteError(WRITE_ERROR_MESSAGE)
          }
          // Re-sync from the server (Gate-1 S-003) rather than trust a
          // captured pre-POST snapshot. Token-gated too (Gate-2 W-102) — a
          // newer write's own re-sync/reconcile must not be clobbered by
          // this stale one's re-sync landing late.
          void liveStorylineStore.refetchNow(targetId, token)
        })
    },
    [emitSteeringAction],
  )

  // Fires when a burst's debounce timer elapses: reads whatever burst is
  // CURRENTLY in the ref (never a stale closure), clears it, and commits.
  const settleBurst = useCallback(() => {
    const finished = liveBurstRef.current
    liveBurstRef.current = null
    if (finished) {
      commitLiveWrite(
        finished.targetId,
        finished.baselineFrom,
        finished.baselineConfirmed,
        finished.latestValue,
      )
    }
  }, [commitLiveWrite])

  const applyTarget = useCallback(
    (value: number | null) => {
      if (USE_MOCK_DATA) {
        // No-op guard (Gate-1 Minor): a resolved target equal to the current
        // one (e.g. End while already at 100, or a drag rounding back to the
        // same value) records/emits NOTHING — no redundant "100 -> 100" event.
        if (storylineMock.getStoryline().targetIntensity === value) return

        const change = storylineMock.setTargetIntensity(value)
        // Synchronous write — nothing to be "pending" about; confirmed immediately.
        setLastChangeDetail(change.detail)
        emitSteeringAction(MOCK_STORYLINE_ID, change.from, change.to, change.detail)
        return
      }

      // LIVE — read fresh (never a stale closure over a memoized snapshot).
      // Gate-2 W-104: a fresh attempt ALWAYS clears a stale write error
      // FIRST, before any early return below — a retry must never leave a
      // stale failure banner on screen just because the burst settles to a
      // no-op or reuses an in-flight burst's baseline.
      setWriteError(null)

      const burst = liveBurstRef.current
      if (burst) {
        // Mid-burst: reuse the ORIGINAL baseline (captured at the burst's
        // first call) — never re-read a value an earlier call in this same
        // burst may have already patched optimistically.
        burst.latestValue = value
        clearTimeout(burst.timer)
        liveStorylineStore.applyOptimistic({ targetIntensity: value })
        burst.timer = setTimeout(() => settleBurst(), LIVE_COMMIT_DEBOUNCE_MS)
        return
      }

      // First call of a NEW burst: capture the baseline from the CURRENT
      // snapshot. The no-op guard only applies here, and only against a
      // CONFIRMED baseline (Gate-2 W-104) — a retained-but-unconfirmed value
      // must never silently suppress a genuine attempt.
      const snapshot = liveStorylineStore.getSnapshot()
      const priorData = snapshot.data
      const baselineConfirmed = snapshot.status === 'live'
      const baselineFrom = baselineConfirmed ? (priorData?.targetIntensity ?? null) : null

      if (baselineConfirmed && baselineFrom === value) return

      const targetId = priorData?.storylineId ?? PRIMARY_STORYLINE_SENTINEL

      liveStorylineStore.applyOptimistic({ targetIntensity: value })
      setPendingChangeDetail(`${formatTarget(baselineFrom)} → ${formatTarget(value)}`)

      const timer = setTimeout(() => settleBurst(), LIVE_COMMIT_DEBOUNCE_MS)

      liveBurstRef.current = {
        baselineFrom,
        baselineConfirmed,
        targetId,
        latestValue: value,
        timer,
      }
    },
    [emitSteeringAction, settleBurst],
  )
  // Note: `applyTarget` above intentionally lists `emitSteeringAction` (used
  // in the MOCK branch) and `settleBurst` (used in the LIVE branch) — both
  // are exhaustive-deps-correct for their respective branches within the
  // same callback.

  const setTarget = useCallback(
    (value: number) => {
      const clamped = Math.min(100, Math.max(0, Math.round(value)))
      applyTarget(clamped)
    },
    [applyTarget],
  )

  const clearTarget = useCallback(() => {
    applyTarget(null)
  }, [applyTarget])

  return {
    storylineId,
    title,
    dataStatus,
    intensity,
    targetIntensity,
    phase,
    phaseLabel: phaseLabel(phase),
    lastChangeDetail,
    pendingChangeDetail,
    writeError,
    setTarget,
    clearTarget,
  }
}
