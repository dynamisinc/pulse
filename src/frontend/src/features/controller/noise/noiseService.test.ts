/**
 * features/controller/noise/noiseService.test.ts
 * ---------------------------------------------------------------------------
 * Story 09, the LIVE white-noise service (USE_MOCK_DATA off):
 *   - GET / PUT go to `/staff/noise` on the shared client, PUT carries only `{ level }`;
 *   - a 400 shows the server's ProblemDetails `detail`, other failures a fixed sentence;
 *   - a malformed body is refused;
 *   - `NoiseStateChanged` frames on the shared hub connection reach the caller (malformed ones
 *     are dropped), a (re)connect asks for a resync, and unsubscribing detaches both;
 *   - `parseNoiseState` rebuilds the frozen `NoiseStateDto` from its keys only.
 */
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import {
  HubConnectionState,
  type RealtimeConnection,
  type RealtimeEventHandler,
  type RealtimeStateListener,
} from '@/core/realtime/connection'
import {
  fetchNoiseState,
  NOISE_PATH,
  NOISE_STATE_CHANGED_EVENT,
  putNoiseLevel,
  subscribeNoiseState,
} from './noiseService'
import { parseNoiseState } from './noiseTypes'

vi.mock('@/core/config/mockData', () => ({
  USE_MOCK_DATA: false,
  warnIfMockDataActive: () => undefined,
}))

const STATE = { level: 'low', ratePerMinute: 2, poolSize: 30, postedCount: 4, running: true }

function ok(data: unknown): AxiosResponse {
  return { data, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() } }
}

function httpError(status: number, data?: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError(`status ${status}`, 'ERR_BAD_RESPONSE', config, null, {
    data,
    status,
    statusText: String(status),
    headers: new AxiosHeaders(),
    config,
  })
}

/** A stand-in for the shared hub connection. */
function fakeConnection() {
  const handlers = new Map<string, Set<RealtimeEventHandler>>()
  const listeners = new Set<RealtimeStateListener>()
  const connection: RealtimeConnection = {
    subscribe: (eventName, handler) => {
      const set = handlers.get(eventName) ?? new Set()
      set.add(handler)
      handlers.set(eventName, set)
      return () => {
        set.delete(handler)
      }
    },
    onStateChange: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    start: vi.fn(() => Promise.resolve()),
    stop: () => Promise.resolve(),
    state: HubConnectionState.Connected,
  }
  return {
    connection,
    emit: (eventName: string, payload: unknown) =>
      handlers.get(eventName)?.forEach(h => h(payload)),
    setState: (state: HubConnectionState) => listeners.forEach(l => l(state)),
    handlerCount: (eventName: string) => handlers.get(eventName)?.size ?? 0,
    listenerCount: () => listeners.size,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('noiseService (live)', () => {
  it('reads the state from GET /staff/noise', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(ok(STATE))
    await expect(fetchNoiseState()).resolves.toEqual(STATE)
    expect(get).toHaveBeenCalledWith(
      NOISE_PATH,
      expect.objectContaining({ timeout: expect.any(Number) }),
    )
    expect(get.mock.calls[0]?.[1]).not.toHaveProperty('adapter')
  })

  it('sets the level with PUT /staff/noise { level } and returns the server state', async () => {
    const put = vi.spyOn(api, 'put').mockResolvedValue(ok({ ...STATE, level: 'high', ratePerMinute: 15 }))
    await expect(putNoiseLevel('high')).resolves.toMatchObject({ level: 'high', ratePerMinute: 15 })
    expect(put).toHaveBeenCalledWith(NOISE_PATH, { level: 'high' }, expect.any(Object))
  })

  it('shows the server detail for a 400', async () => {
    vi.spyOn(api, 'put').mockRejectedValue(httpError(400, { title: 'Bad', detail: 'Unknown level.' }))
    await expect(putNoiseLevel('low')).rejects.toThrow('Unknown level.')
  })

  it('says only a controller may change noise on a 403', async () => {
    vi.spyOn(api, 'put').mockRejectedValue(httpError(403))
    await expect(putNoiseLevel('low')).rejects.toThrow('Only a controller can change white noise.')
  })

  it('says the server could not be reached when there is no response', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'))
    await expect(fetchNoiseState()).rejects.toThrow(/could not be reached/)
  })

  it('refuses a malformed body', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(ok({ level: 'loud', ratePerMinute: 99 }))
    await expect(fetchNoiseState()).rejects.toThrow(/does not understand/)
  })

  it('delivers NoiseStateChanged frames from the shared connection and resyncs on connect', () => {
    const hub = fakeConnection()
    const onState = vi.fn()
    const onResync = vi.fn()
    const unsubscribe = subscribeNoiseState(onState, onResync, hub.connection)

    expect(hub.connection.start).toHaveBeenCalledTimes(1)
    hub.emit(NOISE_STATE_CHANGED_EVENT, { ...STATE, postedCount: 5 })
    expect(onState).toHaveBeenCalledWith({ ...STATE, postedCount: 5 })

    hub.emit(NOISE_STATE_CHANGED_EVENT, { level: 'off' })
    expect(onState).toHaveBeenCalledTimes(1)

    hub.setState(HubConnectionState.Reconnecting)
    expect(onResync).not.toHaveBeenCalled()
    hub.setState(HubConnectionState.Connected)
    expect(onResync).toHaveBeenCalledTimes(1)

    unsubscribe()
    expect(hub.handlerCount(NOISE_STATE_CHANGED_EVENT)).toBe(0)
    expect(hub.listenerCount()).toBe(0)
  })
})

describe('parseNoiseState', () => {
  it('rebuilds the contract keys and drops anything else', () => {
    expect(parseNoiseState({ ...STATE, lastPostedAt: '2026-10-20T09:00:00Z', extra: 'x' })).toEqual({
      ...STATE,
      lastPostedAt: '2026-10-20T09:00:00Z',
    })
  })

  it('treats a null lastPostedAt as absent', () => {
    expect(parseNoiseState({ ...STATE, lastPostedAt: null })).toEqual(STATE)
  })

  it.each([
    null,
    'text',
    { ...STATE, level: 'loud' },
    { ...STATE, ratePerMinute: -1 },
    { ...STATE, poolSize: 1.5 },
    { ...STATE, running: 'yes' },
    { ...STATE, lastPostedAt: 5 },
  ])('refuses %j', payload => {
    expect(parseNoiseState(payload)).toBeUndefined()
  })
})
