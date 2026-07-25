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
 *     `storylineMock.setTargetIntensity`.
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
 * In BOTH modes:
 *   - `setTarget(value)` clamps 0-100 and records the change (mirroring
 *     `Storyline.SetTargetIntensity`'s from/to semantics).
 *   - `clearTarget()` unsets the target (`setTargetIntensity(null)`).
 *   - A call that resolves to the SAME value as the current target (a no-op,
 *     e.g. `End` while already at 100) records + emits NOTHING — guards
 *     against redundant `"100 -> 100"`-style events (XC-004 hygiene).
 *   - Otherwise, each call emits exactly ONE `steering_action` telemetry event (XC-004)
 *     via the caller-safe `buildAndEmit`, mirroring `reviewActions.ts`'s
 *     `emitReviewed()` shape: `channel: 'system'`, `actor: { kind: 'system',
 *     actingHumanId, role }` (a controller/system action on world state, not
 *     engine-authored content — never `'engine'`), `target: { entityType:
 *     'storyline', entityId }`, `payload` carrying the before/after detail
 *     string (`"78 → 60"` / `"none → 60"`). The same detail string is exposed
 *     back as `lastChangeDetail` so `<EscalationDial>` can render the exact
 *     transition text the AC calls for, without re-deriving it. Emitted
 *     CLIENT-SIDE ONLY (unchanged in shape from the mock branch) — the live
 *     POST endpoint emits no `steering_action` telemetry of its own, so this
 *     is the ONE emission per commit either way (no double-emit, XC-004).
 *   - LIVE ONLY: the local view updates OPTIMISTICALLY the instant `setTarget`/
 *     `clearTarget` is called (so the dial feels as immediate as the mock),
 *     then RECONCILES against the POST's authoritative response; on a
 *     rejected POST, the optimistic change is REVERTED (mirrors
 *     `useEngineControl`'s kill-switch revert-on-rejection) — the dial must
 *     never claim a target commit the backend didn't actually apply. The
 *     telemetry already emitted still stands as the record of the attempted
 *     change either way.
 *
 * ISOLATION (COR-001) — `exerciseId`/`timeZone` from `useExerciseContext()`
 * STAMP the telemetry event only, never a fetch-scoping parameter (the live
 * GET/POST carry no client `exerciseId` either — scope is server-
 * authoritative). STAFF-ONLY (XC-002) — `useControllerIdentity()` supplies the
 * acting human + role.
 *
 * SUBSCRIPTION — reads either store via `useSyncExternalStore` so every mount
 * reacts to a change from ANY source (this hook, another mounted dial, or —
 * live only — the poll / the engine's own tick) without a separate render
 * loop of its own.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
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
import { liveStorylineStore } from '../services/liveStorylineStore'

/**
 * Mirrors `Storyline.FormatTarget` — `null` renders as the literal `"none"`
 * (the XC-004 detail convention).
 */
function formatTarget(value: number | null): string {
  return value === null ? 'none' : String(value)
}

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
  /** Actual intensity, 0-100 (`Storyline.Intensity`) — the track's fill. */
  readonly intensity: number
  /** Controller-set target, 0-100, or `null` when unset (`Storyline.TargetIntensity`). */
  readonly targetIntensity: number | null
  /** Mirrors `StorylinePhase` (`Storyline.Phase`). */
  readonly phase: StorylinePhase
  /** Uppercase phase label, exactly as `StorylineBriefProjection.PhaseLabel` produces it. */
  readonly phaseLabel: string
  /**
   * The from/to detail of the most recent target change this session (e.g.
   * `"78 → 60"`, `"none → 60"`), mirroring `Storyline.SetTargetIntensity`'s
   * detail-string convention. `null` before any change has been made yet.
   */
  readonly lastChangeDetail: string | null
  /** Sets the target (clamped 0-100), records it, and emits one `steering_action` event. */
  readonly setTarget: (value: number) => void
  /** Clears the target (`targetIntensity` -> `null`) and emits one `steering_action` event. */
  readonly clearTarget: () => void
}

/**
 * A safe default view while the LIVE snapshot has not loaded yet (before the
 * first GET resolves).
 */
const LIVE_LOADING_DEFAULTS = {
  intensity: 0,
  targetIntensity: null as number | null,
  phase: 'Dormant' as StorylinePhase,
}

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

  // LIVE only: kick off the initial GET + poll once (idempotent — see
  // liveStorylineStore.ensureStarted). No-op under mock data.
  useEffect(() => {
    if (!USE_MOCK_DATA) liveStorylineStore.ensureStarted(PRIMARY_STORYLINE_SENTINEL)
  }, [])

  const mockStoryline = useSyncExternalStore(
    storylineMock.subscribe,
    storylineMock.getStoryline,
    storylineMock.getStoryline,
  )
  const liveStoryline = useSyncExternalStore(
    liveStorylineStore.subscribe,
    liveStorylineStore.getSnapshot,
    liveStorylineStore.getSnapshot,
  )

  const [lastChangeDetail, setLastChangeDetail] = useState<string | null>(null)

  const storylineId = USE_MOCK_DATA
    ? MOCK_STORYLINE_ID
    : (liveStoryline?.storylineId ?? PRIMARY_STORYLINE_SENTINEL)
  const intensity = USE_MOCK_DATA
    ? mockStoryline.intensity
    : (liveStoryline?.intensity ?? LIVE_LOADING_DEFAULTS.intensity)
  const targetIntensity = USE_MOCK_DATA
    ? mockStoryline.targetIntensity
    : (liveStoryline?.targetIntensity ?? LIVE_LOADING_DEFAULTS.targetIntensity)
  const phase: StorylinePhase = USE_MOCK_DATA
    ? mockStoryline.phase
    : (liveStoryline?.phase ?? LIVE_LOADING_DEFAULTS.phase)

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

  const applyTarget = useCallback(
    (value: number | null) => {
      if (USE_MOCK_DATA) {
        // No-op guard (Gate-1 Minor): a resolved target equal to the current
        // one (e.g. End while already at 100, or a drag rounding back to the
        // same value) records/emits NOTHING — no redundant "100 -> 100" event.
        if (storylineMock.getStoryline().targetIntensity === value) return

        const change = storylineMock.setTargetIntensity(value)
        setLastChangeDetail(change.detail)
        emitSteeringAction(MOCK_STORYLINE_ID, change.from, change.to, change.detail)
        return
      }

      // LIVE — read fresh (never a stale closure over a memoized snapshot).
      const priorSnapshot = liveStorylineStore.getSnapshot()
      const from = priorSnapshot?.targetIntensity ?? null
      if (from === value) return // same no-op guard as mock

      const targetId = priorSnapshot?.storylineId ?? PRIMARY_STORYLINE_SENTINEL
      const detail = `${formatTarget(from)} → ${formatTarget(value)}`
      setLastChangeDetail(detail)

      // Optimistic local update — the dial feels as immediate as the mock —
      // then reconciled (or reverted) against the authoritative POST below.
      if (priorSnapshot) {
        liveStorylineStore.reconcile({ ...priorSnapshot, targetIntensity: value })
      }

      // Emitted BEFORE the POST settles (mirrors useEngineControl): the audit
      // trail records the attempted change even if the POST later rejects and
      // the optimistic update is reverted.
      emitSteeringAction(targetId, from, value, detail)

      liveSetStorylineTarget(targetId, value)
        .then(authoritative => liveStorylineStore.reconcile(authoritative))
        .catch(() => {
          // The backend never applied this change — revert to the last-known
          // authoritative snapshot rather than claim a commit that didn't
          // happen. A no-op if there was no prior snapshot to revert to
          // (nothing has loaded yet — the next poll tick will seed it).
          if (priorSnapshot) liveStorylineStore.reconcile(priorSnapshot)
        })
    },
    [emitSteeringAction],
  )

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
    intensity,
    targetIntensity,
    phase,
    phaseLabel: phaseLabel(phase),
    lastChangeDetail,
    setTarget,
    clearTarget,
  }
}
