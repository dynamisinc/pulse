/**
 * core/clock/serverClockSync.test.tsx
 * The sync driver and its mount (fix/noise-new-posts-clock): initial read, push applied,
 * resync on reconnect, periodic resync, a read losing to a newer push, unreachable read,
 * exercise switch (late answer for the exercise left is dropped), teardown restores the
 * default clock, mock mode makes no call.
 */
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HubConnectionState } from '@/core/realtime/connection'
import { getExerciseClock, resetExerciseClock, scenarioNow } from './index'
import { createServerExerciseClock } from './serverClock'
import type { ScenarioClockState } from './serverClock'
import { SCENARIO_CLOCK_CHANGED_EVENT, startServerClockSync } from './serverClockSync'
import type { ScenarioClockRead } from './serverClockSync'
import { ServerClockSync } from './ServerClockMount'

type Handler = (payload: unknown) => void
type StateListener = (state: HubConnectionState, reason?: 'stopped') => void

const hub = vi.hoisted(() => ({
  handlers: new Map<string, Set<(payload: unknown) => void>>(),
  stateListeners: new Set<StateListener>(),
}))

let mockExerciseId: string | undefined = 'ex-1'
let mockUseMock = false
vi.mock('@/core/config/mockData', () => ({
  get USE_MOCK_DATA() {
    return mockUseMock
  },
}))
vi.mock('@/core/exerciseContext/exerciseContext', () => ({
  useOptionalExerciseContext: () =>
    mockExerciseId === undefined ? undefined : { exerciseId: mockExerciseId },
}))
const apiGet = vi.fn()
vi.mock('@/core/services/api', () => ({ api: { get: (...args: unknown[]) => apiGet(...args) } }))
vi.mock('@/core/realtime/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/realtime/connection')>()
  return {
    ...actual,
    realtimeConnection: {
      subscribe: (name: string, handler: Handler) => {
        const set = hub.handlers.get(name) ?? new Set<Handler>()
        set.add(handler)
        hub.handlers.set(name, set)
        return () => { set.delete(handler) }
      },
      onStateChange: (listener: StateListener) => {
        hub.stateListeners.add(listener)
        return () => { hub.stateListeners.delete(listener) }
      },
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      state: actual.HubConnectionState.Connected,
    },
  }
})

function frame(overrides: Partial<ScenarioClockState> = {}, exerciseId = 'ex-1') {
  return { ...body(overrides), exerciseId }
}

function push(name: string, payload: unknown): void {
  hub.handlers.get(name)?.forEach(handler => handler(payload))
}
function emitState(state: HubConnectionState): void {
  hub.stateListeners.forEach(listener => listener(state))
}
function handlerCount(name: string): number {
  return hub.handlers.get(name)?.size ?? 0
}

function body(overrides: Partial<ScenarioClockState> = {}): ScenarioClockState {
  return {
    started: true,
    frozen: false,
    scenarioTime: '2026-10-21T14:00:00.000Z',
    serverTime: '2026-10-21T15:00:00.000Z',
    ...overrides,
  }
}

const flush = async (): Promise<void> => {
  await act(async () => { await Promise.resolve() })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date('2026-10-21T15:00:00.000Z'))
  mockExerciseId = 'ex-1'
  mockUseMock = false
  apiGet.mockReset()
  hub.handlers.clear()
  hub.stateListeners.clear()
})

afterEach(() => {
  resetExerciseClock()
  vi.useRealTimers()
})

describe('startServerClockSync', () => {
  it('reads on start, installs the clock, and follows the server (frozen)', async () => {
    const clock = createServerExerciseClock()
    const read = vi.fn().mockResolvedValue({ state: body({ frozen: true }), roundTripMs: 0 })
    const stop = startServerClockSync('ex-1', { clock, read })
    expect(getExerciseClock()).toBe(clock)
    await flush()
    vi.advanceTimersByTime(120_000)
    expect(scenarioNow().toISOString()).toBe('2026-10-21T14:00:00.000Z')
    stop()
  })

  it('RUNNING with offset from the read, half the round trip added', async () => {
    const clock = createServerExerciseClock()
    startServerClockSync('ex-1', {
      clock, read: () => Promise.resolve({ state: body(), roundTripMs: 100 }),
    })
    await flush()
    expect(scenarioNow().toISOString()).toBe('2026-10-21T14:00:00.050Z')
  })

  it('NOT STARTED or unreachable: keeps the wall clock', async () => {
    const clock = createServerExerciseClock()
    const read = vi.fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ state: body({ started: false, scenarioTime: null }), roundTripMs: 0 })
    startServerClockSync('ex-1', { clock, read, resyncIntervalMs: 1000 })
    await flush()
    expect(clock.mirrorsWallClock).toBe(true)
    vi.advanceTimersByTime(1000)
    await flush()
    expect(clock.mirrorsWallClock).toBe(true)
  })

  it('applies a ScenarioClockChanged push from the shared connection', () => {
    const clock = createServerExerciseClock()
    startServerClockSync('ex-1', { clock, read: () => new Promise(() => {}) })
    act(() => push(SCENARIO_CLOCK_CHANGED_EVENT, frame({ frozen: true })))
    expect(clock.isFrozen).toBe(true)
    // A malformed push is ignored.
    act(() => push(SCENARIO_CLOCK_CHANGED_EVENT, { nonsense: true }))
    expect(clock.isFrozen).toBe(true)
  })

  it('drops a push for another exercise or with no id, without discarding an in-flight read', async () => {
    const clock = createServerExerciseClock()
    const slow = deferred<ScenarioClockRead>()
    startServerClockSync('ex-1', { clock, read: () => slow.promise })
    act(() => push(SCENARIO_CLOCK_CHANGED_EVENT, frame({ frozen: true }, 'ex-other')))
    act(() => push(SCENARIO_CLOCK_CHANGED_EVENT, body({ frozen: true }))) // no exerciseId
    expect(clock.isSynced).toBe(false)
    slow.resolve({ state: body({ frozen: false }), roundTripMs: 0 })
    await flush()
    expect(clock.isSynced).toBe(true) // the read still landed
    expect(clock.isFrozen).toBe(false)
  })

  it('matches the push exercise id case-insensitively (the server writes lowercase GUIDs)', async () => {
    const clock = createServerExerciseClock()
    startServerClockSync('EX-1', { clock, read: () => new Promise<ScenarioClockRead>(() => {}) })
    act(() => push(SCENARIO_CLOCK_CHANGED_EVENT, frame({ frozen: true }, 'ex-1')))
    expect(clock.isSynced).toBe(true)
    expect(clock.isFrozen).toBe(true)
  })

  it('a read that began before a push does not overwrite it', async () => {
    const clock = createServerExerciseClock()
    const slow = deferred<ScenarioClockRead>()
    startServerClockSync('ex-1', { clock, read: () => slow.promise })
    act(() => push(SCENARIO_CLOCK_CHANGED_EVENT, frame({ frozen: true })))
    slow.resolve({ state: body({ frozen: false }), roundTripMs: 0 })
    await flush()
    expect(clock.isFrozen).toBe(true)
  })

  it('resyncs after a realtime reconnect, not on a first connect', async () => {
    const clock = createServerExerciseClock()
    const read = vi.fn().mockResolvedValue({ state: body(), roundTripMs: 0 })
    startServerClockSync('ex-1', { clock, read })
    await flush()
    expect(read).toHaveBeenCalledTimes(1)
    act(() => emitState(HubConnectionState.Connected))
    expect(read).toHaveBeenCalledTimes(1)
    act(() => emitState(HubConnectionState.Reconnecting))
    act(() => emitState(HubConnectionState.Connected))
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('resyncs periodically', () => {
    const clock = createServerExerciseClock()
    const read = vi.fn().mockResolvedValue({ state: body(), roundTripMs: 0 })
    startServerClockSync('ex-1', { clock, read, resyncIntervalMs: 60_000 })
    vi.advanceTimersByTime(180_000)
    expect(read).toHaveBeenCalledTimes(4)
  })

  it('stop detaches, drops a late answer, and restores the default clock', async () => {
    const clock = createServerExerciseClock()
    const slow = deferred<ScenarioClockRead>()
    const stop = startServerClockSync('ex-1', { clock, read: () => slow.promise })
    stop()
    expect(handlerCount(SCENARIO_CLOCK_CHANGED_EVENT)).toBe(0)
    expect(getExerciseClock()).not.toBe(clock)
    slow.resolve({ state: body({ frozen: true }), roundTripMs: 0 })
    await flush()
    expect(clock.isSynced).toBe(false)
  })
})

describe('<ServerClockSync />', () => {
  const answer = (state: ScenarioClockState) => ({ data: state })

  it('mock mode installs nothing and makes no call', () => {
    mockUseMock = true
    render(<ServerClockSync />)
    expect(apiGet).not.toHaveBeenCalled()
    expect(getExerciseClock().mirrorsWallClock).toBe(true)
  })

  it('reads GET /clock for the bound exercise', async () => {
    apiGet.mockResolvedValue(answer(body({ frozen: true })))
    render(<ServerClockSync />)
    await flush()
    expect(apiGet).toHaveBeenCalledWith('/clock')
    expect(scenarioNow().toISOString()).toBe('2026-10-21T14:00:00.000Z')
  })

  it('an in-place exercise switch re-keys and drops the late answer for the one left', async () => {
    const first = deferred<{ data: ScenarioClockState }>()
    apiGet.mockReturnValueOnce(first.promise)
    apiGet.mockResolvedValueOnce(
      answer(body({ frozen: true, scenarioTime: '2026-10-21T09:00:00.000Z' })),
    )

    const view = render(<ServerClockSync />)
    mockExerciseId = 'ex-2'
    view.rerender(<ServerClockSync />)
    await flush()
    expect(apiGet).toHaveBeenCalledTimes(2)
    expect(scenarioNow().toISOString()).toBe('2026-10-21T09:00:00.000Z')

    // ex-1's answer finally lands: it must change nothing.
    first.resolve(answer(body({ frozen: true, scenarioTime: '2026-10-21T14:00:00.000Z' })))
    await flush()
    expect(scenarioNow().toISOString()).toBe('2026-10-21T09:00:00.000Z')
  })

  it('unmount restores the default wall-mirroring clock', async () => {
    apiGet.mockResolvedValue(answer(body()))
    const view = render(<ServerClockSync />)
    await flush()
    view.unmount()
    expect(getExerciseClock().mirrorsWallClock).toBe(true)
  })
})
