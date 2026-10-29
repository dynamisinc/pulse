/**
 * features/controller/hooks/usePauseState.serverClock.test.tsx
 * ---------------------------------------------------------------------------
 * fix/noise-new-posts-clock: under a LIVE session the server clock (`core/clock`) is the
 * ONE clock, and the controller's tiered pause DEFERS to it:
 *  - Freeze flips the server clock OPTIMISTICALLY (the header stops at once) and installs
 *    NO competing pausable clock;
 *  - the server's push (`apply`) replaces the optimistic flip;
 *  - a refused Freeze (revert to running) lands back on the server's running time, not on a
 *    clock resumed from the stale held instant;
 *  - with the server clock NOT installed (mock mode) the pausable clock still drives.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getExerciseClock,
  resetExerciseClock,
  scenarioNow,
  serverExerciseClock,
  setExerciseClock,
} from '@/core/clock'
import { useExerciseContext } from '@/core/exerciseContext'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { useControllerIdentity } from '../identity/controllerIdentity'
import { engineControlStore } from '../engine/hooks/useEngineControl'
import { pausableExerciseClock } from '../services/pausableExerciseClock'
import { resetPauseStateForTest, usePauseState } from './usePauseState'

vi.mock('@/core/exerciseContext', () => ({ useExerciseContext: vi.fn() }))
vi.mock('../identity/controllerIdentity', () => ({ useControllerIdentity: vi.fn() }))
vi.mock('@/core/services/api', () => ({ api: { post: vi.fn().mockResolvedValue(undefined) } }))

const SERVER_SCENARIO = '2026-10-21T14:00:00.000Z'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-21T15:00:00.000Z'))
  vi.mocked(useExerciseContext).mockReturnValue({
    exerciseId: 'ex-1', exerciseName: 'X', timeZone: 'UTC', status: 'active',
  })
  vi.mocked(useControllerIdentity).mockReturnValue({
    actingHumanId: 'h-1', callSign: 'C1', role: 'controller',
  })
  resetTelemetryBuffer()
  resetPauseStateForTest()
  engineControlStore.resetForTests()
  // A synced, RUNNING server clock one hour behind the wall.
  serverExerciseClock.apply({
    started: true, frozen: false, scenarioTime: SERVER_SCENARIO, serverTime: '2026-10-21T15:00:00.000Z',
  })
})

afterEach(() => {
  resetPauseStateForTest()
  serverExerciseClock.reset()
  resetExerciseClock()
  vi.useRealTimers()
})

describe('usePauseState with the server clock installed', () => {
  it('Freeze holds the SERVER clock optimistically and installs no competing clock', () => {
    setExerciseClock(serverExerciseClock)
    const { result } = renderHook(() => usePauseState())

    act(() => result.current.setTier('freeze'))
    expect(getExerciseClock()).toBe(serverExerciseClock) // not the pausable clock
    expect(getExerciseClock()).not.toBe(pausableExerciseClock)
    const held = scenarioNow().toISOString()
    expect(held).toBe(SERVER_SCENARIO)

    vi.advanceTimersByTime(60_000)
    expect(scenarioNow().toISOString()).toBe(held)
  })

  it('the server push replaces the optimistic flip', () => {
    setExerciseClock(serverExerciseClock)
    const { result } = renderHook(() => usePauseState())
    act(() => result.current.setTier('freeze'))
    vi.advanceTimersByTime(5_000)

    // The server froze a touch later than the click: its instant wins.
    act(() => serverExerciseClock.apply({
      started: true, frozen: true, scenarioTime: '2026-10-21T14:00:03.000Z',
      serverTime: '2026-10-21T15:00:05.000Z',
    }))
    expect(scenarioNow().toISOString()).toBe('2026-10-21T14:00:03.000Z')
  })

  it('a refused Freeze reverts to the server running time, not the stale held instant', () => {
    setExerciseClock(serverExerciseClock)
    const { result } = renderHook(() => usePauseState())
    act(() => result.current.setTier('freeze'))
    vi.advanceTimersByTime(30_000)
    act(() => result.current.setTier('running'))

    expect(scenarioNow().toISOString()).toBe('2026-10-21T14:00:30.000Z')
  })

  it('without the server clock installed (mock mode) the pausable clock still drives', () => {
    const { result } = renderHook(() => usePauseState())
    act(() => result.current.setTier('freeze'))
    expect(getExerciseClock()).toBe(pausableExerciseClock)
  })
})
