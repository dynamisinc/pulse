/**
 * features/controller/engine/console/DraftTimerDriver.test.tsx
 * ---------------------------------------------------------------------------
 * THE SAFETY DEMO, under test (feature: engine-review-cockpit, integration
 * seam; ADP-040, D5-014/1.1). Covers the composition the integration spec
 * calls out as load-bearing:
 *
 *  - DEFAULT config (swamped off): an expired timer resolves the item to
 *    Held and publishes NOTHING (silence is never approval).
 *  - swamped(lead) + still-effectively-Delayed-auto: the ONE auto-send path —
 *    `autoPublish` appends an `origin: 'engine'` post, and its participant
 *    view strips all provenance (XC-002/SOC-003).
 *  - THE CLAMP-SUSPENDS-SWAMPED COMPOSITION: with a REAL `useEngineControl()`
 *    clamped to STOP / Suggest-only / degraded, a swamped-mode expired timer
 *    STILL resolves Hold, never `autoPublish` — proven by feeding
 *    `DraftTimerDriver` the ACTUAL `effective` value `useEngineControl()`
 *    computed (not a hand-built stand-in), so a regression in either hook's
 *    formula would fail this test.
 *
 * `@/core/exerciseContext` and the sibling `controllerIdentity` module are
 * mocked at the module boundary (mirrors `useDraftTimer.test.ts`), and the
 * scenario clock is fixed past the countdown's deadline via `setExerciseClock`
 * so the terminal transition fires on mount — no fake timers needed.
 */
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { listPosts, toParticipantView } from '@/features/social'
import { postStore } from '@/features/social/services/postStore'
import { useControllerIdentity, type ControllerIdentity } from '../../identity/controllerIdentity'
import {
  AutonomyLevel,
  DelayedAutoCountdown,
  DraftDisposition,
  EngineReviewItem,
  runningAutonomy,
  type EffectiveAutonomy,
} from '../models/reviewContracts'
import { reviewStore } from '../services/reviewStore'
import { engineControlStore, useEngineControl } from '../hooks/useEngineControl'
import { DraftTimerDriver, type DraftTimerDriverContext } from './DraftTimerDriver'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))
vi.mock('../../identity/controllerIdentity', () => ({
  useControllerIdentity: vi.fn(),
}))

const mockedUseExerciseContext = vi.mocked(useExerciseContext)
const mockedUseControllerIdentity = vi.mocked(useControllerIdentity)

const EX = 'ex-mock-0001'
const STORY = 'storyline-water-advisory'
const DRAFT = 'draft-timer-driver-test'

function scopeFor(exerciseId: string): ExerciseScope {
  return { exerciseId, exerciseName: 'Test Exercise', timeZone: 'America/New_York', status: 'active' }
}

function identity(overrides: Partial<ControllerIdentity> = {}): ControllerIdentity {
  return {
    actingHumanId: 'human-controller-01',
    callSign: 'SIMCELL-1',
    role: 'controller',
    isLead: true,
    ...overrides,
  }
}

const CTX: DraftTimerDriverContext = {
  exerciseId: EX,
  timeZone: 'America/New_York',
  actingHumanId: 'human-controller-01',
}

/** Deadline is scenario minute 105 (start 100 + length 5). */
function makeCountdown(): DelayedAutoCountdown {
  return new DelayedAutoCountdown({
    exerciseId: EX,
    storylineId: STORY,
    draftId: DRAFT,
    startedScenarioMinute: 100,
    countdownMinutes: 5,
  })
}

function makeItem(countdown: DelayedAutoCountdown): EngineReviewItem {
  return new EngineReviewItem({
    exerciseId: EX,
    storylineId: STORY,
    draftId: DRAFT,
    routedAtLevel: AutonomyLevel.DelayedAuto,
    disposition: DraftDisposition.CountingDown,
    countdown,
    posts: [
      { personaHandle: 'FulcoEM', text: 'Zones 2-4 remain under advisory.', sentiment: 0, hashtags: [] },
    ],
    storylineTag: '#WaterIssues',
    storylineBrief: 'test brief',
    actionLabel: 'reply → @mvega_fh',
  })
}

function itemDisposition(): DraftDisposition | undefined {
  return reviewStore.getItems().find(i => i.draftId === DRAFT)?.disposition
}

function baselinePostCount(): number {
  return listPosts().length
}

beforeEach(() => {
  mockedUseExerciseContext.mockReturnValue(scopeFor(EX))
  mockedUseControllerIdentity.mockReturnValue(identity())
  // Fixed scenario clock PAST the countdown's minute-105 deadline, so
  // `useDraftTimer`'s terminal transition fires on the very first tick/mount.
  setExerciseClock({ scenarioNow: () => new Date(105 * 60_000) })
  postStore.resetForTests()
  reviewStore.resetForTests()
  engineControlStore.resetForTests()
  resetTelemetryBuffer()
})

afterEach(() => {
  resetExerciseClock()
  vi.clearAllMocks()
})

describe('DraftTimerDriver — default config (swamped off): auto-HOLD, never publish', () => {
  it('resolves the item to Held and appends nothing to the live feed', async () => {
    const countdown = makeCountdown()
    reviewStore.appendItem(makeItem(countdown))
    const baseline = baselinePostCount()

    render(
      <DraftTimerDriver
        item={makeItem(countdown)}
        countdown={countdown}
        swampedMode={false}
        effective={runningAutonomy(AutonomyLevel.DelayedAuto)}
        ctx={CTX}
      />,
    )

    await waitFor(() => expect(itemDisposition()).toBe(DraftDisposition.Held))
    expect(postStore.getPosts()).toHaveLength(baseline)
  })
})

describe('DraftTimerDriver — swamped(lead) + still Delayed-auto: the ONE auto-send path', () => {
  it('autoPublish appends an origin: engine post; its participant view strips provenance', async () => {
    const countdown = makeCountdown()
    reviewStore.appendItem(makeItem(countdown))
    const baseline = baselinePostCount()

    render(
      <DraftTimerDriver
        item={makeItem(countdown)}
        countdown={countdown}
        swampedMode={true}
        effective={runningAutonomy(AutonomyLevel.DelayedAuto)}
        ctx={CTX}
      />,
    )

    await waitFor(() => expect(itemDisposition()).toBe(DraftDisposition.Published))

    const posts = postStore.getPosts()
    expect(posts.length).toBe(baseline + 1)
    const published = posts[posts.length - 1]
    if (!published) throw new Error('expected an appended post')
    expect(published.origin).toBe('engine')
    expect(published.actingHumanId).toBe('human-controller-01')

    const view = toParticipantView(published)
    expect(view).not.toHaveProperty('origin')
    expect(view).not.toHaveProperty('actingHumanId')
    expect(view).not.toHaveProperty('createdWallClock')
  })
})

describe('DraftTimerDriver — the clamp-suspends-swamped composition (REAL useEngineControl)', () => {
  /** Drives `useEngineControl()` to `configure` it, then returns the resulting `effective`. */
  function effectiveAfter(
    configure: (control: ReturnType<typeof useEngineControl>) => void,
  ): EffectiveAutonomy {
    const control = renderHook(() => useEngineControl())
    act(() => configure(control.result.current))
    const effective = control.result.current.effective
    control.unmount()
    return effective
  }

  it('STOP: a swamped expired timer still holds — never autoPublish', () => {
    const effective = effectiveAfter(c => c.setMode('stop'))
    expect(effective.generationStopped).toBe(true)

    const countdown = makeCountdown()
    reviewStore.appendItem(makeItem(countdown))
    const baseline = baselinePostCount()

    render(
      <DraftTimerDriver
        item={makeItem(countdown)}
        countdown={countdown}
        swampedMode={true}
        effective={effective}
        ctx={CTX}
      />,
    )

    // A full stop is NOT a "timeout transition" (`autoHoldPolicy.evaluate` /
    // `useDraftTimer`'s documented precedent — it is logged on the kill-
    // switch's OWN safety path, not this one) — so `onResolve` never fires
    // here and the item's stored disposition is simply left untouched. The
    // safety invariant under test is the one that matters: despite an EXPIRED
    // timer AND swamped mode being on, nothing publishes while the engine is
    // fully stopped.
    expect(itemDisposition()).toBe(DraftDisposition.CountingDown)
    expect(itemDisposition()).not.toBe(DraftDisposition.Published)
    expect(postStore.getPosts()).toHaveLength(baseline)
  })

  it('Suggest-only: a swamped expired timer still resolves Hold, never autoPublish', async () => {
    const effective = effectiveAfter(c => c.setMode('suggest-only'))
    expect(effective.level).toBe(AutonomyLevel.Suggest)

    const countdown = makeCountdown()
    reviewStore.appendItem(makeItem(countdown))
    const baseline = baselinePostCount()

    render(
      <DraftTimerDriver
        item={makeItem(countdown)}
        countdown={countdown}
        swampedMode={true}
        effective={effective}
        ctx={CTX}
      />,
    )

    await waitFor(() => expect(itemDisposition()).toBe(DraftDisposition.Held))
    expect(postStore.getPosts()).toHaveLength(baseline)
  })

  it('degraded (provider clamp): a swamped expired timer still resolves Hold, never autoPublish', async () => {
    const effective = effectiveAfter(c => c.degrade('mock provider degraded'))
    expect(effective.level).toBe(AutonomyLevel.Suggest)
    expect(effective.generationStopped).toBe(false)

    const countdown = makeCountdown()
    reviewStore.appendItem(makeItem(countdown))
    const baseline = baselinePostCount()

    render(
      <DraftTimerDriver
        item={makeItem(countdown)}
        countdown={countdown}
        swampedMode={true}
        effective={effective}
        ctx={CTX}
      />,
    )

    await waitFor(() => expect(itemDisposition()).toBe(DraftDisposition.Held))
    expect(postStore.getPosts()).toHaveLength(baseline)
  })
})
