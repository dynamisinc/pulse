/**
 * features/controller/engine/hooks/useSwampedMode.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the lead-gated swamped-mode toggle (engine-review-cockpit/03;
 * ADP-040, COR-001, COR-018, XC-004):
 *  - off by default;
 *  - a lead controller can enable/disable it, each logging one telemetry event
 *    with actor.actingHumanId + scenario time;
 *  - a non-lead controller's `setSwampedMode(true)` is a NO-OP — rejected, not
 *    recorded, not logged;
 *  - a non-lead's `setSwampedMode(false)` is not gated (nothing unsafe about
 *    disabling);
 *  - the flag is per-exercise scoped — a different exercise never sees another
 *    exercise's flag (COR-001).
 *
 * `@/core/exerciseContext` and the sibling `controllerIdentity` module are
 * mocked at the module boundary (mirrors `controllerIdentity.test.tsx` /
 * `useReviewQueue`'s own test precedent) so each test controls the exercise
 * scope + lead gate directly and deterministically.
 */
import { renderHook, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { useControllerIdentity, type ControllerIdentity } from '../../identity/controllerIdentity'
import { swampedModeStore, useSwampedMode } from './useSwampedMode'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))
vi.mock('../../identity/controllerIdentity', () => ({
  useControllerIdentity: vi.fn(),
}))

const mockedUseExerciseContext = vi.mocked(useExerciseContext)
const mockedUseControllerIdentity = vi.mocked(useControllerIdentity)

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

function swampedEvents() {
  return getEmittedTelemetryEvents().filter(e => e.eventType === 'engine.swamped_mode_changed')
}

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:00Z') })
  swampedModeStore.resetForTests()
  resetTelemetryBuffer()
})

afterEach(() => {
  resetExerciseClock()
  vi.clearAllMocks()
})

describe('useSwampedMode — default state', () => {
  it('is off by default for a fresh exercise', () => {
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-mock-0001'))
    mockedUseControllerIdentity.mockReturnValue(identity())

    const { result } = renderHook(() => useSwampedMode())
    expect(result.current.swampedMode).toBe(false)
  })
})

describe('useSwampedMode — lead can toggle', () => {
  it('enables swamped mode and logs one telemetry event with actor + scenario time', () => {
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-mock-0001'))
    mockedUseControllerIdentity.mockReturnValue(identity({ isLead: true, actingHumanId: 'human-lead-1' }))

    const { result } = renderHook(() => useSwampedMode())
    act(() => result.current.setSwampedMode(true))

    expect(result.current.swampedMode).toBe(true)
    const events = swampedEvents()
    expect(events).toHaveLength(1)
    expect(events[0]?.actor).toEqual({ kind: 'engine', actingHumanId: 'human-lead-1' })
    expect(events[0]?.scenarioTime).toBe('2033-09-04T14:00:00.000Z')
    expect(events[0]?.channel).toBe('system')
    expect(events[0]?.payload).toEqual({ action: 'swamped-mode-enabled' })
  })

  it('disables swamped mode and logs a second telemetry event', () => {
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-mock-0001'))
    mockedUseControllerIdentity.mockReturnValue(identity({ isLead: true }))

    const { result } = renderHook(() => useSwampedMode())
    act(() => result.current.setSwampedMode(true))
    act(() => result.current.setSwampedMode(false))

    expect(result.current.swampedMode).toBe(false)
    expect(swampedEvents()).toHaveLength(2)
    expect(swampedEvents()[1]?.payload).toEqual({ action: 'swamped-mode-disabled' })
  })

  it('is a no-op (no state change, no telemetry) when set to its current value', () => {
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-mock-0001'))
    mockedUseControllerIdentity.mockReturnValue(identity({ isLead: true }))

    const { result } = renderHook(() => useSwampedMode())
    act(() => result.current.setSwampedMode(false))

    expect(result.current.swampedMode).toBe(false)
    expect(swampedEvents()).toHaveLength(0)
  })
})

describe('useSwampedMode — non-lead cannot enable it (ADP-040)', () => {
  it('setSwampedMode(true) is rejected: state stays off, nothing is logged', () => {
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-mock-0001'))
    mockedUseControllerIdentity.mockReturnValue(identity({ isLead: false }))

    const { result } = renderHook(() => useSwampedMode())
    act(() => result.current.setSwampedMode(true))

    expect(result.current.swampedMode).toBe(false)
    expect(result.current.isLead).toBe(false)
    expect(swampedEvents()).toHaveLength(0)
  })

  it('setSwampedMode(false) is not gated for a non-lead', () => {
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-mock-0001'))
    mockedUseControllerIdentity.mockReturnValue(identity({ isLead: true }))
    const lead = renderHook(() => useSwampedMode())
    act(() => lead.result.current.setSwampedMode(true))
    lead.unmount()

    mockedUseControllerIdentity.mockReturnValue(identity({ isLead: false }))
    const nonLead = renderHook(() => useSwampedMode())
    expect(nonLead.result.current.swampedMode).toBe(true)

    act(() => nonLead.result.current.setSwampedMode(false))
    expect(nonLead.result.current.swampedMode).toBe(false)
  })
})

describe('useSwampedMode — per-exercise scoping (COR-001)', () => {
  it('a different exercise never observes another exercise\'s flag', () => {
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-alpha'))
    mockedUseControllerIdentity.mockReturnValue(identity({ isLead: true }))
    const alpha = renderHook(() => useSwampedMode())
    act(() => alpha.result.current.setSwampedMode(true))
    expect(alpha.result.current.swampedMode).toBe(true)
    alpha.unmount()

    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-bravo'))
    const bravo = renderHook(() => useSwampedMode())
    expect(bravo.result.current.swampedMode).toBe(false)
  })
})
