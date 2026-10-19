/**
 * features/controller/engine/console/DraftTimerDriver.live.test.tsx
 * ---------------------------------------------------------------------------
 * LIVE-mode (`USE_MOCK_DATA === false`) contract for the client draft timer: it is
 * DISPLAY-ONLY. The SERVER (`EngineReviewService.EvaluateAutoHoldAsync`) decides the
 * Delayed-auto expiry outcome and emits its own `engine.reviewed`; the client must not
 * duplicate or contradict it from cached settings (`providerCutToFake` can be stale: a cut
 * POST response delayed past expiry, or a cut made from another tab).
 *
 * Asserted: (a) swamped + expired emits NO `engine.reviewed`/`post` telemetry, calls NO
 * `autoPublish` and flips NO local state, whatever the cached cut flag says; the queue is
 * refetched promptly on expiry. (b) mock mode still resolves locally. (c) the card shows a
 * neutral "resolving…" at 0 and then follows the server queue's update.
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { api } from '@/core/services/api'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { useControllerIdentity } from '../../identity/controllerIdentity'
import {
  AutonomyLevel,
  DelayedAutoCountdown,
  DraftDisposition,
  EngineReviewItem,
  runningAutonomy,
} from '../models/reviewContracts'
import { reviewStore } from '../services/reviewStore'
import { liveReviewStore } from '../services/liveReviewStore'
import * as reviewActions from '../services/reviewActions'
import { ReviewQueue } from '../components/ReviewQueue'
import { DraftTimerDriver, type DraftTimerDriverContext } from './DraftTimerDriver'

const mockFlag = vi.hoisted(() => ({ useMockData: false }))
vi.mock('@/core/config/mockData', () => ({
  get USE_MOCK_DATA() {
    return mockFlag.useMockData
  },
}))
vi.mock('@/core/exerciseContext', () => ({ useExerciseContext: vi.fn() }))
vi.mock('../../identity/controllerIdentity', () => ({ useControllerIdentity: vi.fn() }))
vi.mock('@/features/controller/access/useCanControl', () => ({ useCanControl: () => true }))
vi.mock('../services/reviewActions', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/reviewActions')>()
  return { ...actual, autoPublish: vi.fn(actual.autoPublish) }
})

const EX = 'ex-live-0001'
const STORY = 'storyline-water-advisory'
const DRAFT = 'draft-live-timer'
const CTX: DraftTimerDriverContext = {
  exerciseId: EX,
  timeZone: 'America/New_York',
  actingHumanId: 'human-controller-01',
}
const scope: ExerciseScope = {
  exerciseId: EX,
  exerciseName: 'Live Exercise',
  timeZone: 'America/New_York',
  status: 'active',
}

/** Deadline is scenario minute 105. */
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
    posts: [{ personaHandle: 'FulcoEM', text: 'Zones 2-4 remain under advisory.', sentiment: 0, hashtags: [] }],
    storylineTag: '#WaterIssues',
    storylineBrief: 'test brief',
    actionLabel: 'reply',
  })
}

/** The server's wire DTO for the draft in a given disposition. */
function wireItem(disposition: string) {
  return {
    exerciseId: EX,
    storylineId: STORY,
    draftId: DRAFT,
    routedAtLevel: 'delayed-auto',
    disposition,
    countdown: {
      exerciseId: EX,
      storylineId: STORY,
      draftId: DRAFT,
      startedScenarioMinute: 100,
      countdownMinutes: 5,
      decision: 'none',
    },
    posts: [{ personaHandle: 'FulcoEM', text: 'Zones 2-4 remain under advisory.', sentiment: 0, hashtags: [] }],
    storylineTag: '#WaterIssues',
    storylineBrief: 'test brief',
    actionLabel: 'reply',
  }
}

let serverQueue: unknown[] = []
let getSpy: ReturnType<typeof vi.spyOn>

function renderDriver(swamped: boolean, cut: boolean) {
  const countdown = makeCountdown()
  const ui = (cutFlag: boolean) => (
    <DraftTimerDriver
      item={makeItem(countdown)}
      countdown={countdown}
      swampedMode={swamped}
      effective={runningAutonomy(AutonomyLevel.DelayedAuto)}
      providerCutToFake={cutFlag}
      ctx={CTX}
    />
  )
  const view = render(ui(cut))
  return { ...view, rerenderWithCut: (c: boolean) => view.rerender(ui(c)) }
}

function engineTelemetry() {
  return getEmittedTelemetryEvents().filter(
    e => e.eventType === 'engine.reviewed' || e.eventType === 'post',
  )
}

beforeEach(() => {
  mockFlag.useMockData = false
  vi.mocked(useExerciseContext).mockReturnValue(scope)
  vi.mocked(useControllerIdentity).mockReturnValue({
    actingHumanId: 'human-controller-01',
    callSign: 'SIMCELL-1',
    role: 'controller',
  })
  // Fixed scenario clock PAST the minute-105 deadline: expired on mount.
  setExerciseClock({ scenarioNow: () => new Date(105 * 60_000) })
  reviewStore.resetForTests()
  liveReviewStore.resetForTests()
  resetTelemetryBuffer()
  vi.mocked(reviewActions.autoPublish).mockClear()
  serverQueue = [wireItem('held')]
  getSpy = vi.spyOn(api, 'get').mockImplementation((() =>
    Promise.resolve({ data: serverQueue })) as typeof api.get)
})

afterEach(() => {
  vi.restoreAllMocks()
  liveReviewStore.resetForTests()
  resetExerciseClock()
})

describe('DraftTimerDriver (LIVE) - display-only, the server is the authority', () => {
  it.each([
    ['cached cut flag false while the server says Held (cut from another tab)', false],
    ['cached cut flag true', true],
  ])('swamped + expired: no engine.reviewed / post telemetry, no autoPublish - %s', async (_n, cut) => {
    reviewStore.appendItem(makeItem(makeCountdown()))
    renderDriver(true, cut)

    await waitFor(() => expect(getSpy).toHaveBeenCalled())
    expect(engineTelemetry()).toEqual([])
    expect(reviewActions.autoPublish).not.toHaveBeenCalled()
    // no local state flip: the (mock) store's copy is untouched
    expect(reviewStore.getItems().find(i => i.draftId === DRAFT)?.disposition).toBe(
      DraftDisposition.CountingDown,
    )
  })

  it('a cut response landing AFTER expiry (flag flips false -> true) still adds nothing client-side', async () => {
    const { rerenderWithCut } = renderDriver(true, false)
    await waitFor(() => expect(getSpy).toHaveBeenCalled())
    rerenderWithCut(true)
    rerenderWithCut(false)

    expect(engineTelemetry()).toEqual([])
    expect(reviewActions.autoPublish).not.toHaveBeenCalled()
  })

  it('default config (swamped off) expiry also takes no client-side terminal action', async () => {
    renderDriver(false, false)
    await waitFor(() => expect(getSpy).toHaveBeenCalled())
    expect(engineTelemetry()).toEqual([])
    expect(reviewActions.autoPublish).not.toHaveBeenCalled()
  })

  it('several expired drivers share ONE poller: one GET at expiry, then one per 3 s', async () => {
    vi.useFakeTimers()
    try {
      // The server keeps the draft CountingDown (e.g. FullStop), so the queue stays expired.
      serverQueue = [wireItem('counting-down')]
      const countdown = makeCountdown()
      const { unmount } = render(
        <>
          {[0, 1, 2].map(n => (
            <DraftTimerDriver
              key={n}
              item={makeItem(countdown)}
              countdown={countdown}
              swampedMode={true}
              effective={runningAutonomy(AutonomyLevel.DelayedAuto)}
              ctx={CTX}
            />
          ))}
        </>,
      )
      expect(getSpy).toHaveBeenCalledTimes(1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(getSpy).toHaveBeenCalledTimes(2)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(getSpy).toHaveBeenCalledTimes(3)
      // Polling is queue-level: it does not depend on any one driver staying mounted.
      unmount()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })
      expect(getSpy).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('the shared poller stops once the server resolves the item', async () => {
    vi.useFakeTimers()
    try {
      serverQueue = [wireItem('held')]
      renderDriver(true, false)
      expect(getSpy).toHaveBeenCalledTimes(1)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })
      expect(getSpy).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('the displayed state is neutral "resolving…" at 0, then follows the server queue update', async () => {
    serverQueue = [wireItem('counting-down')]
    liveReviewStore.ensureStarted({
      subscribe: () => () => {},
      onStateChange: () => () => {},
      start: () => Promise.resolve(),
    } as unknown as Parameters<typeof liveReviewStore.ensureStarted>[0])
    await waitFor(() => expect(liveReviewStore.getItems()).toHaveLength(1))

    render(
      <>
        <ReviewQueue />
        <DraftTimerDriver
          item={makeItem(makeCountdown())}
          countdown={makeCountdown()}
          swampedMode={true}
          effective={runningAutonomy(AutonomyLevel.DelayedAuto)}
          providerCutToFake={false}
          ctx={CTX}
        />
      </>,
    )
    const state = () => screen.getByTestId('countdown-state')
    await waitFor(() => expect(state()).toHaveTextContent('resolving…'))
    expect(state()).toHaveAttribute('data-countdown-kind', 'resolving')

    // The server resolves the expiry (Held); the next refetch lands it.
    serverQueue = [wireItem('held')]
    await act(async () => {
      await liveReviewStore.refetch()
    })
    await waitFor(() => expect(state()).toHaveTextContent('timer expired — held for you'))
    expect(engineTelemetry()).toEqual([])
  })
})

describe('DraftTimerDriver (MOCK) - local resolution unchanged', () => {
  it('swamped + expired: resolves locally with the engine.reviewed auto-send and publishes', async () => {
    mockFlag.useMockData = true
    reviewStore.appendItem(makeItem(makeCountdown()))
    renderDriver(true, false)

    await waitFor(() => expect(reviewActions.autoPublish).toHaveBeenCalledTimes(1))
    expect(getEmittedTelemetryEvents().some(e => e.eventType === 'engine.reviewed')).toBe(true)
    expect(getSpy).not.toHaveBeenCalled()
  })

  it('cut to Fake: holds locally (providerCutToFake port intact)', async () => {
    mockFlag.useMockData = true
    reviewStore.appendItem(makeItem(makeCountdown()))
    renderDriver(true, true)

    await waitFor(() =>
      expect(reviewStore.getItems().find(i => i.draftId === DRAFT)?.disposition).toBe(
        DraftDisposition.Held,
      ),
    )
    expect(reviewActions.autoPublish).not.toHaveBeenCalled()
  })
})
