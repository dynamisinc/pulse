/**
 * features/controller/engine/hooks/useDraftTimer.test.ts
 * ---------------------------------------------------------------------------
 * The SAFETY-CRITICAL coverage for story 02 (ADP-040, D5-014/1.1 supersedes
 * D5-005). The load-bearing invariant under test: SILENCE IS NEVER APPROVAL —
 * a timed draft whose countdown expires with NO controller decision auto-HOLDS
 * (never auto-sends) in the default config; the ONLY publish-on-expiry is the
 * swamped-mode path on a still-Delayed-auto, running draft. Also asserts the
 * scenario-time countdown label (NFR-001 text, never color-only), and that the
 * expiry→terminal transition logs EXACTLY ONE `engine.reviewed` event and fires
 * `onResolve` exactly once.
 *
 * `useControllerIdentity` + `useExerciseContext` are mocked at the module
 * boundary (mirrors `controllerIdentity.test.tsx`) so the hook unit-tests
 * without mounting providers; telemetry uses the real mock sink buffer.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import {
  AutonomyLevel,
  ControllerDecision,
  DelayedAutoCountdown,
  DraftDisposition,
  EngineReviewItem,
  STOPPED_AUTONOMY,
  TimeoutDisposition,
  runningAutonomy,
  type EffectiveAutonomy,
} from '../models/reviewContracts'
import { useDraftTimer } from './useDraftTimer'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(() => ({
    exerciseId: 'ex-mock-0001',
    exerciseName: 'Test Exercise',
    timeZone: 'America/New_York',
    status: 'active',
  })),
}))

vi.mock('../../identity/controllerIdentity', () => ({
  useControllerIdentity: vi.fn(() => ({
    actingHumanId: 'human-controller-01',
    callSign: 'SIMCELL-1',
    role: 'controller',
    isLead: true,
  })),
}))

const EX = 'ex-mock-0001'
const STORY = 'storyline-1'
const DRAFT = 'draft-1'

/** Deadline is minute 105 (start 100 + length 5) for every countdown below. */
function makeCountdown(decision?: ControllerDecision): DelayedAutoCountdown {
  return new DelayedAutoCountdown({
    exerciseId: EX,
    storylineId: STORY,
    draftId: DRAFT,
    startedScenarioMinute: 100,
    countdownMinutes: 5,
    ...(decision !== undefined ? { decision } : {}),
  })
}

/** A fixed scenario clock at whole scenario minute `minute` (ms since epoch). */
function clockAt(minute: number): () => Date {
  return () => new Date(minute * 60_000)
}

const delayedAuto = runningAutonomy(AutonomyLevel.DelayedAuto)

function reviewedEvents() {
  return getEmittedTelemetryEvents().filter(e => e.eventType === 'engine.reviewed')
}

beforeEach(() => {
  resetTelemetryBuffer()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('useDraftTimer — counting down (not yet expired)', () => {
  it('reports AwaitDecision + a scenario-time "holds in M:SS" label, and resolves nothing', () => {
    const onResolve = vi.fn()
    // Minute 103, 30s in → deadline 105 → 90s remaining → "holds in 1:30".
    const now = () => new Date(103 * 60_000 + 30_000)
    const { result } = renderHook(() =>
      useDraftTimer(makeCountdown(), delayedAuto, false, { onResolve, now }),
    )

    expect(result.current.disposition).toBe(TimeoutDisposition.AwaitDecision)
    expect(result.current.hasExpired).toBe(false)
    expect(result.current.minutesRemaining).toBe(2)
    expect(result.current.label).toBe('holds in 1:30')
    expect(onResolve).not.toHaveBeenCalled()
    expect(reviewedEvents()).toHaveLength(0)
  })
})

describe('useDraftTimer — scenario-time countdown decreases as scenario minute advances', () => {
  it('minutesRemaining counts down 5..0 purely from the injected scenario clock, never wall-clock', () => {
    // Same countdown (deadline 105); only the injected scenario minute moves. Wall-
    // clock is never touched — the hook reads exclusively from `now`.
    const observed = [100, 101, 102, 103, 104, 105, 999].map(minute => {
      const { result } = renderHook(() =>
        useDraftTimer(makeCountdown(), delayedAuto, false, { now: clockAt(minute) }),
      )
      return result.current.minutesRemaining
    })

    expect(observed).toEqual([5, 4, 3, 2, 1, 0, 0])
    // Strictly non-increasing as scenario time advances (never resets/increases).
    for (let i = 1; i < observed.length; i += 1) {
      const current = observed[i] ?? 0
      const previous = observed[i - 1] ?? 0
      expect(current).toBeLessThanOrEqual(previous)
    }
  })

  it('advances live as the injected clock ticks forward (no rerender/remount needed)', () => {
    vi.useFakeTimers()
    let minute = 100
    const now = () => new Date(minute * 60_000)

    const { result } = renderHook(() =>
      useDraftTimer(makeCountdown(), delayedAuto, false, { now, tickMs: 1000 }),
    )
    expect(result.current.minutesRemaining).toBe(5)

    minute = 103
    act(() => vi.advanceTimersByTime(1000))
    expect(result.current.minutesRemaining).toBe(2)

    minute = 105
    act(() => vi.advanceTimersByTime(1000))
    expect(result.current.minutesRemaining).toBe(0)
    expect(result.current.hasExpired).toBe(true)
  })
})

describe('useDraftTimer — expiry with no decision auto-HOLDS (default config)', () => {
  it('resolves Hold (never Publish), labels it "timer expired — held for you", and does not auto-send', () => {
    const onResolve = vi.fn()
    const { result } = renderHook(() =>
      useDraftTimer(makeCountdown(), delayedAuto, false, { onResolve, now: clockAt(105) }),
    )

    expect(result.current.disposition).toBe(TimeoutDisposition.Hold)
    expect(result.current.disposition).not.toBe(TimeoutDisposition.Publish)
    expect(result.current.hasExpired).toBe(true)
    expect(result.current.minutesRemaining).toBe(0)
    expect(result.current.label).toBe('timer expired — held for you')

    expect(onResolve).toHaveBeenCalledTimes(1)
    expect(onResolve).toHaveBeenCalledWith(
      TimeoutDisposition.Hold,
      expect.objectContaining({ disposition: TimeoutDisposition.Hold, viaSwampedMode: false }),
    )
  })

  it('logs EXACTLY ONE engine.reviewed transition (action hold-on-expiry) with storyline + scenario time', () => {
    renderHook(() =>
      useDraftTimer(makeCountdown(), delayedAuto, false, { now: clockAt(105) }),
    )

    const events = reviewedEvents()
    expect(events).toHaveLength(1)
    const event = events[0]
    expect(event?.actor).toMatchObject({ kind: 'engine', actingHumanId: 'human-controller-01' })
    expect(event?.channel).toBe('system')
    expect(event?.origin).toBe('engine')
    expect(event?.exerciseId).toBe(EX)
    expect(event?.timeZone).toBe('America/New_York')
    // Scenario time (COR-053) is the injected scenario clock, not wall-clock.
    expect(event?.scenarioTime).toBe(new Date(105 * 60_000).toISOString())
    expect(event?.target).toMatchObject({ entityType: 'engine-draft', entityId: DRAFT })
    expect(event?.payload).toMatchObject({
      action: 'hold-on-expiry',
      storylineId: STORY,
      disposition: TimeoutDisposition.Hold,
      viaSwampedMode: false,
      scenarioMinute: 105,
    })
  })
})

describe('useDraftTimer — swamped mode is the ONLY auto-send path', () => {
  it('resolves Publish (action auto-send) on expiry when swamped + still Delayed-auto', () => {
    const onResolve = vi.fn()
    const { result } = renderHook(() =>
      useDraftTimer(makeCountdown(), delayedAuto, true, { onResolve, now: clockAt(106) }),
    )

    expect(result.current.disposition).toBe(TimeoutDisposition.Publish)
    expect(onResolve).toHaveBeenCalledTimes(1)
    expect(onResolve).toHaveBeenCalledWith(
      TimeoutDisposition.Publish,
      expect.objectContaining({ disposition: TimeoutDisposition.Publish, viaSwampedMode: true }),
    )

    const events = reviewedEvents()
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toMatchObject({ action: 'auto-send', viaSwampedMode: true })
  })

  it('STILL holds under swamped mode when a full stop suspends the engine (no publish, no transition log)', () => {
    const onResolve = vi.fn()
    const { result } = renderHook(() =>
      useDraftTimer(makeCountdown(), STOPPED_AUTONOMY, true, { onResolve, now: clockAt(200) }),
    )

    // A full stop overrides even swamped mode; and it is not a timeout transition
    // to log here (logged on the safety path), so nothing fires from this hook.
    expect(result.current.disposition).toBe(TimeoutDisposition.Hold)
    expect(onResolve).not.toHaveBeenCalled()
    expect(reviewedEvents()).toHaveLength(0)
  })

  it('STILL holds under swamped mode when a safety clamp lowered the level below Delayed-auto', () => {
    const onResolve = vi.fn()
    const clamped: EffectiveAutonomy = runningAutonomy(AutonomyLevel.Suggest)
    const { result } = renderHook(() =>
      useDraftTimer(makeCountdown(), clamped, true, { onResolve, now: clockAt(200) }),
    )

    expect(result.current.disposition).toBe(TimeoutDisposition.Hold)
    expect(onResolve).toHaveBeenCalledTimes(1)
    expect(onResolve).toHaveBeenCalledWith(TimeoutDisposition.Hold, expect.anything())
    expect(reviewedEvents()[0]?.payload).toMatchObject({ action: 'hold-on-expiry' })
  })
})

describe('useDraftTimer — an explicit human decision is not a timeout transition', () => {
  it('does not emit/resolve for a vetoed draft (logged on the review-action path)', () => {
    const onResolve = vi.fn()
    const { result } = renderHook(() =>
      useDraftTimer(makeCountdown(ControllerDecision.Vetoed), delayedAuto, false, {
        onResolve,
        now: clockAt(200),
      }),
    )

    expect(result.current.disposition).toBe(TimeoutDisposition.Hold)
    expect(onResolve).not.toHaveBeenCalled()
    expect(reviewedEvents()).toHaveLength(0)
  })

  it('resolves an approved draft to Publish regardless of the timer (even before expiry), and does not log a timeout transition', () => {
    const onResolve = vi.fn()
    // Minute 101 — well before the minute-105 deadline. An explicit approval wins
    // over the still-running countdown (autoHoldPolicy precedence #2).
    const { result } = renderHook(() =>
      useDraftTimer(makeCountdown(ControllerDecision.Approved), delayedAuto, false, {
        onResolve,
        now: clockAt(101),
      }),
    )

    expect(result.current.disposition).toBe(TimeoutDisposition.Publish)
    // A human decision is logged on the review-action path (`reviewActions`), not
    // here — this hook only resolves/logs an on-expiry, NO-decision transition.
    expect(onResolve).not.toHaveBeenCalled()
    expect(reviewedEvents()).toHaveLength(0)
  })

  it('resolves an approved draft to Publish even past the deadline (approval, not expiry, drives it)', () => {
    const { result } = renderHook(() =>
      useDraftTimer(makeCountdown(ControllerDecision.Approved), delayedAuto, false, {
        now: clockAt(200),
      }),
    )

    expect(result.current.disposition).toBe(TimeoutDisposition.Publish)
    expect(reviewedEvents()).toHaveLength(0)
  })
})

describe('useDraftTimer — held-on-expiry marks the item as needing the controller', () => {
  it('feeds story 01\'s EngineReviewItem.needsController via the same frozen contract (not a re-derived copy)', () => {
    // Wire the hook's terminal Hold the way integration will: onResolve flips the
    // item's disposition to Held through the SAME EngineReviewItem the queue uses.
    const item = new EngineReviewItem({
      exerciseId: EX,
      storylineId: STORY,
      draftId: DRAFT,
      routedAtLevel: AutonomyLevel.DelayedAuto,
      disposition: DraftDisposition.CountingDown,
      countdown: makeCountdown(),
      posts: [],
      storylineTag: '#Test',
      storylineBrief: 'brief',
      actionLabel: 'reply',
    })
    expect(item.needsController).toBe(false) // still counting down — no decision needed yet

    let held: EngineReviewItem | undefined
    renderHook(() =>
      useDraftTimer(makeCountdown(), delayedAuto, false, {
        now: clockAt(105),
        onResolve: disposition => {
          if (disposition === TimeoutDisposition.Hold) {
            held = item.withDisposition(DraftDisposition.Held)
          }
        },
      }),
    )

    expect(held?.disposition).toBe(DraftDisposition.Held)
    expect(held?.needsController).toBe(true)
  })
})

describe('useDraftTimer — the transition fires exactly once across ticks', () => {
  it('resolves + logs once even as the clock keeps ticking past expiry', () => {
    vi.useFakeTimers()
    const onResolve = vi.fn()
    let minute = 104 // not yet expired (deadline 105)
    const now = () => new Date(minute * 60_000)

    renderHook(() =>
      useDraftTimer(makeCountdown(), delayedAuto, false, { onResolve, now, tickMs: 1000 }),
    )
    expect(onResolve).not.toHaveBeenCalled()

    // Cross the deadline, then keep ticking well past it.
    minute = 105
    act(() => vi.advanceTimersByTime(1000))
    minute = 106
    act(() => vi.advanceTimersByTime(1000))
    minute = 999
    act(() => vi.advanceTimersByTime(1000))

    expect(onResolve).toHaveBeenCalledTimes(1)
    expect(onResolve).toHaveBeenCalledWith(TimeoutDisposition.Hold, expect.anything())
    expect(reviewedEvents()).toHaveLength(1)
  })
})
