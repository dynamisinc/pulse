/**
 * features/controller/hooks/useStorylineTarget.test.ts
 * ---------------------------------------------------------------------------
 * Covers the escalation dial's target-management hook (feature: world-
 * steering, story 02 — "Escalation dial — actual + target, engine follows";
 * CTL-022 / D5-014/2.2, XC-004, COR-001, XC-002):
 *
 *  - exposes the mock storyline's actual `intensity`/`phase`/`phaseLabel`,
 *    reacting to a store change (`useSyncExternalStore`);
 *  - `setTarget` clamps 0-100, records the change on the mock storyline
 *    (mirroring `Storyline.SetTargetIntensity`'s from/to semantics), and
 *    exposes the exact transition detail (`lastChangeDetail`) — the value
 *    `<EscalationDial>` renders verbatim;
 *  - `clearTarget` unsets the target (`targetIntensity` -> `null`);
 *  - each call emits exactly ONE `steering_action` telemetry event (XC-004)
 *    with `channel: 'system'`, `actor: { kind: 'system', actingHumanId, role }`,
 *    `target: { entityType: 'storyline', entityId }`, and a payload carrying
 *    the before/after detail — scoped to the active exercise (`exerciseId`
 *    stamping-only, COR-001);
 *  - the exposed `targetIntensity` is the seam a future (Phase 2) engine-
 *    follow tick would consume — captured/exposed now, moving nothing itself
 *    (actual intensity is untouched by a target set/clear this phase).
 *
 * `@/core/exerciseContext` and the sibling `controllerIdentity` module are
 * mocked at the module boundary (mirrors `useEngineControl.test.ts` /
 * `useDemandMeter.test.ts`).
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { useControllerIdentity, type ControllerIdentity } from '../identity/controllerIdentity'
import { storylineMock } from '../services/storylineMock'
import { useStorylineTarget } from './useStorylineTarget'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))
vi.mock('../identity/controllerIdentity', () => ({
  useControllerIdentity: vi.fn(),
}))

const mockedUseExerciseContext = vi.mocked(useExerciseContext)
const mockedUseControllerIdentity = vi.mocked(useControllerIdentity)

const EX = 'ex-mock-0001'
const HUMAN = 'human-controller-01'
const SCENARIO_TIME = '2033-09-04T14:00:00.000Z'

function scopeFor(exerciseId: string): ExerciseScope {
  return { exerciseId, exerciseName: 'Test Exercise', timeZone: 'America/New_York', status: 'active' }
}

function identity(overrides: Partial<ControllerIdentity> = {}): ControllerIdentity {
  return {
    actingHumanId: HUMAN,
    callSign: 'SIMCELL-1',
    role: 'controller',
    isLead: true,
    ...overrides,
  }
}

function steeringEvents() {
  return getEmittedTelemetryEvents().filter(e => e.eventType === 'steering_action')
}

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date(SCENARIO_TIME) })
  storylineMock.resetForTests()
  resetTelemetryBuffer()
  mockedUseExerciseContext.mockReturnValue(scopeFor(EX))
  mockedUseControllerIdentity.mockReturnValue(identity())
})

afterEach(() => {
  resetExerciseClock()
  vi.clearAllMocks()
})

describe('useStorylineTarget — actual state', () => {
  it("exposes the mock storyline's seeded intensity/phase/phaseLabel and an unset target", () => {
    const { result } = renderHook(() => useStorylineTarget())

    expect(result.current.intensity).toBe(62)
    expect(result.current.phase).toBe('Escalating')
    expect(result.current.phaseLabel).toBe('ESCALATING')
    expect(result.current.targetIntensity).toBeNull()
    expect(result.current.lastChangeDetail).toBeNull()
  })

  it('reacts to a store change from another source (e.g. a second mounted dial)', () => {
    const { result } = renderHook(() => useStorylineTarget())

    act(() => {
      storylineMock.setTargetIntensity(45)
    })

    expect(result.current.targetIntensity).toBe(45)
  })
})

describe('useStorylineTarget — setTarget', () => {
  it('clamps, records the change on the mock storyline, and exposes the transition detail', () => {
    const { result } = renderHook(() => useStorylineTarget())

    act(() => {
      result.current.setTarget(150) // clamps to 100
    })

    expect(result.current.targetIntensity).toBe(100)
    expect(storylineMock.getStoryline().targetIntensity).toBe(100)
    expect(result.current.lastChangeDetail).toBe('none → 100')
  })

  it('the second setTarget reports the previous target as "from" ("78 → 60"-style)', () => {
    const { result } = renderHook(() => useStorylineTarget())

    act(() => result.current.setTarget(78))
    act(() => result.current.setTarget(60))

    expect(result.current.lastChangeDetail).toBe('78 → 60')
    expect(result.current.targetIntensity).toBe(60)
  })

  it('does not move actual intensity — only exposes the target for the (stubbed) engine-follow loop', () => {
    const { result } = renderHook(() => useStorylineTarget())
    const before = result.current.intensity

    act(() => result.current.setTarget(5))

    expect(result.current.intensity).toBe(before)
    // exposed for the deferred Phase 2 TickTowardTarget loop to consume
    expect(result.current.targetIntensity).toBe(5)
  })

  it('emits exactly ONE steering_action event per call', () => {
    const { result } = renderHook(() => useStorylineTarget())

    act(() => result.current.setTarget(60))

    expect(steeringEvents()).toHaveLength(1)
  })

  it('the emitted event carries the correct actor, target, channel, and payload (XC-004)', () => {
    const { result } = renderHook(() => useStorylineTarget())

    act(() => result.current.setTarget(60))

    const evt = steeringEvents()[0]
    expect(evt).toBeDefined()
    expect(evt?.exerciseId).toBe(EX)
    expect(evt?.channel).toBe('system')
    expect(evt?.actor).toEqual({ kind: 'system', actingHumanId: HUMAN, role: 'controller' })
    expect(evt?.target).toEqual({ entityType: 'storyline', entityId: 'storyline-water-advisory' })
    expect(evt?.payload).toMatchObject({
      action: 'target-changed',
      from: null,
      to: 60,
      detail: 'none → 60',
    })
    expect(evt?.scenarioTime).toBe(SCENARIO_TIME)
    expect(evt?.timeZone).toBe('America/New_York')
  })

  it('honors an explicit storylineId (a future per-card dial reuse, D5-016/017)', () => {
    const { result } = renderHook(() => useStorylineTarget('storyline-alt'))

    act(() => result.current.setTarget(20))

    const evt = steeringEvents()[0]
    expect(evt?.target).toEqual({ entityType: 'storyline', entityId: 'storyline-alt' })
    expect(result.current.storylineId).toBe('storyline-alt')
  })
})

describe('useStorylineTarget — clearTarget', () => {
  it('unsets the target and emits one steering_action event with a "{from} → none" payload', () => {
    const { result } = renderHook(() => useStorylineTarget())
    act(() => result.current.setTarget(60))
    resetTelemetryBuffer()

    act(() => result.current.clearTarget())

    expect(result.current.targetIntensity).toBeNull()
    expect(result.current.lastChangeDetail).toBe('60 → none')
    expect(steeringEvents()).toHaveLength(1)
    expect(steeringEvents()[0]?.payload).toMatchObject({ action: 'target-changed', from: 60, to: null })
  })
})

describe('useStorylineTarget — exercise scoping (COR-001)', () => {
  it('stamps the currently-bound exercise id on the telemetry event, not a hard-coded one', () => {
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-alpha'))
    const { result } = renderHook(() => useStorylineTarget())

    act(() => result.current.setTarget(33))

    expect(steeringEvents()[0]?.exerciseId).toBe('ex-alpha')
  })
})
