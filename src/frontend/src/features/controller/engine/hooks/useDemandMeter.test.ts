/**
 * features/controller/engine/hooks/useDemandMeter.test.ts
 * ---------------------------------------------------------------------------
 * Covers the CTL-034 demand meter mock hook (D5-014/2.7):
 *  - starts at 0/6, not over budget;
 *  - counts one demand event per controller review DECISION — the
 *    `engine.reviewed` `approve | edit | veto | re-roll` actions
 *    `reviewActions.ts` already emits (batch approve emits one per item, so
 *    "each batch item" falls out of this for free — no separate wiring);
 *  - does NOT count `useDraftTimer`'s own `hold-on-expiry` / `auto-send`
 *    system transitions — those are not a controller decision;
 *  - is exercise/controller-scoped (COR-001): another exercise's or another
 *    controller's decisions never inflate this meter;
 *  - flips `overBudget` strictly past the CTL-034 budget (exactly at budget is
 *    within budget) — DEMAND, never a controller-performance measure
 *    (D5-014/2.7 — this test file's very shape proves the meter counts
 *    decisions DEMANDED, not how fast/slow the controller handled them).
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { buildAndEmit, resetTelemetryBuffer } from '@/core/telemetry'
import { useControllerIdentity, type ControllerIdentity } from '../../identity/controllerIdentity'
import { DEMAND_BUDGET_PER_MINUTE, useDemandMeter } from './useDemandMeter'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))
vi.mock('../../identity/controllerIdentity', () => ({
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

/** Emits a real `engine.reviewed` telemetry event, mirroring `reviewActions.emitReviewed`. */
function emitReviewed(
  action: string,
  overrides: { exerciseId?: string; actingHumanId?: string } = {},
) {
  buildAndEmit({
    exerciseId: overrides.exerciseId ?? EX,
    eventType: 'engine.reviewed',
    channel: 'system',
    actor: { kind: 'engine', actingHumanId: overrides.actingHumanId ?? HUMAN },
    origin: 'engine',
    wallClockTime: new Date('2033-09-04T14:00:00.000Z').toISOString(),
    scenarioTime: SCENARIO_TIME,
    timeZone: 'America/New_York',
    target: { entityType: 'engine-draft', entityId: 'draft-x' },
    payload: { action },
  })
}

function tick() {
  act(() => {
    vi.advanceTimersByTime(1000)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  setExerciseClock({ scenarioNow: () => new Date(SCENARIO_TIME) })
  resetTelemetryBuffer()
  mockedUseExerciseContext.mockReturnValue(scopeFor(EX))
  mockedUseControllerIdentity.mockReturnValue(identity())
})

afterEach(() => {
  resetExerciseClock()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('useDemandMeter — baseline', () => {
  it('starts at 0/6, not over budget', () => {
    const { result } = renderHook(() => useDemandMeter())
    expect(result.current.demand).toBe(0)
    expect(result.current.budget).toBe(DEMAND_BUDGET_PER_MINUTE)
    expect(result.current.overBudget).toBe(false)
  })
})

describe('useDemandMeter — counts controller review decisions as demand', () => {
  it('counts approve/edit/veto/re-roll — one demand event per decision', () => {
    const { result } = renderHook(() => useDemandMeter())
    emitReviewed('approve')
    emitReviewed('edit')
    emitReviewed('veto')
    emitReviewed('re-roll')
    tick()

    expect(result.current.demand).toBe(4)
  })

  it('does NOT count hold-on-expiry / auto-send — those are system/timer transitions, not a controller decision', () => {
    const { result } = renderHook(() => useDemandMeter())
    emitReviewed('hold-on-expiry')
    emitReviewed('auto-send')
    tick()

    expect(result.current.demand).toBe(0)
  })

  it('does not count another exercise\'s or another controller\'s decisions (COR-001 scoping)', () => {
    const { result } = renderHook(() => useDemandMeter())
    emitReviewed('approve', { exerciseId: 'ex-other' })
    emitReviewed('approve', { actingHumanId: 'human-someone-else' })
    tick()

    expect(result.current.demand).toBe(0)
  })
})

describe('useDemandMeter — over-budget is DEMAND, never controller performance (D5-014/2.7)', () => {
  it('exactly at budget (6) is within budget; the 7th sustained decision trips overBudget', () => {
    const { result } = renderHook(() => useDemandMeter())

    for (let i = 0; i < 6; i += 1) emitReviewed('approve')
    tick()
    expect(result.current.demand).toBe(6)
    expect(result.current.overBudget).toBe(false)

    emitReviewed('approve')
    tick()
    expect(result.current.demand).toBe(7)
    expect(result.current.overBudget).toBe(true)
  })
})
