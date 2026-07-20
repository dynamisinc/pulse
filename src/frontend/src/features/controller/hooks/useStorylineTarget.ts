/**
 * features/controller/hooks/useStorylineTarget.ts
 * ---------------------------------------------------------------------------
 * The escalation-dial's target-setting hook (feature: world-steering, story 02
 * — "Escalation dial — actual + target, engine follows"; CTL-022 / D5-014/2.2).
 * STAFF world — pure hook, no UI, no COBRA.
 *
 * Reads the mock storyline's actual state (`intensity` + `phase`, from
 * `storylineMock`) and manages the controller-set `targetIntensity`:
 *   - `setTarget(value)` clamps 0-100 and records the change on the mock store
 *     (mirroring `Storyline.SetTargetIntensity`'s from/to semantics).
 *   - `clearTarget()` unsets the target (`setTargetIntensity(null)`).
 *   - Both EXPOSE the current `targetIntensity` for the deferred (Phase 2) E8
 *     engine-follow tick (`Storyline.Tick`'s `TickTowardTarget` branch, which
 *     runs server-side) to consume later — that loop itself is a no-op stub
 *     this pass; this hook only captures + exposes the target.
 *   - Each call emits exactly ONE `steering_action` telemetry event (XC-004)
 *     via the caller-safe `buildAndEmit`, mirroring `reviewActions.ts`'s
 *     `emitReviewed()` shape: `channel: 'system'`, `actor: { kind: 'system',
 *     actingHumanId, role }` (a controller/system action on world state, not
 *     engine-authored content — never `'engine'`), `target: { entityType:
 *     'storyline', entityId }`, `payload` carrying the before/after detail
 *     string (`"78 → 60"` / `"none → 60"`). The same detail string is exposed
 *     back as `lastChangeDetail` so `<EscalationDial>` can render the exact
 *     transition text the AC calls for, without re-deriving it.
 *
 * ISOLATION (COR-001) — `exerciseId`/`timeZone` from `useExerciseContext()`
 * STAMP the telemetry event only, never a fetch-scoping parameter. STAFF-ONLY
 * (XC-002) — `useControllerIdentity()` supplies the acting human + role.
 *
 * SUBSCRIPTION — reads `storylineMock` via `useSyncExternalStore` so every
 * mount reacts to a target/intensity change from ANY source (this hook,
 * another mounted dial, or — later — the Phase-2 engine tick) without a
 * separate polling loop.
 */

import { useCallback, useState, useSyncExternalStore } from 'react'
import { useExerciseContext } from '@/core/exerciseContext'
import { scenarioNow } from '@/core/clock'
import { buildAndEmit } from '@/core/telemetry'
import { wallClockNowIso } from '@/core/time/wallClock'
import { useControllerIdentity } from '../identity/controllerIdentity'
import {
  MOCK_STORYLINE_ID,
  phaseLabel,
  storylineMock,
  type StorylinePhase,
} from '../services/storylineMock'

/** The escalation dial's read/write surface for one storyline's target. */
export interface UseStorylineTargetResult {
  /** The storyline this target applies to (mock: the single seeded storyline). */
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
 * The escalation dial's target-management hook. See the module header for the
 * full contract; `<EscalationDial>` is its intended consumer.
 *
 * @param storylineId Which storyline to target — defaults to the mock's single
 *   seeded storyline (`MOCK_STORYLINE_ID`). Accepted as a param (rather than
 *   hard-coded) so the hook does not foreclose a future multi-storyline board
 *   (D5-016/017, deferred) reusing it per-card with no signature change.
 */
export function useStorylineTarget(
  storylineId: string = MOCK_STORYLINE_ID,
): UseStorylineTargetResult {
  const { exerciseId, timeZone } = useExerciseContext()
  const { actingHumanId, role } = useControllerIdentity()

  const storyline = useSyncExternalStore(
    storylineMock.subscribe,
    storylineMock.getStoryline,
    storylineMock.getStoryline,
  )

  const [lastChangeDetail, setLastChangeDetail] = useState<string | null>(null)

  const applyTarget = useCallback(
    (value: number | null) => {
      const change = storylineMock.setTargetIntensity(value)
      setLastChangeDetail(change.detail)

      buildAndEmit({
        exerciseId,
        eventType: 'steering_action',
        channel: 'system',
        actor: { kind: 'system', actingHumanId, role },
        wallClockTime: wallClockNowIso(),
        scenarioTime: scenarioNow().toISOString(),
        timeZone,
        target: { entityType: 'storyline', entityId: storylineId },
        payload: {
          action: 'target-changed',
          from: change.from,
          to: change.to,
          detail: change.detail,
        },
      })
    },
    [exerciseId, timeZone, actingHumanId, role, storylineId],
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
    intensity: storyline.intensity,
    targetIntensity: storyline.targetIntensity,
    phase: storyline.phase,
    phaseLabel: phaseLabel(storyline.phase),
    lastChangeDetail,
    setTarget,
    clearTarget,
  }
}
