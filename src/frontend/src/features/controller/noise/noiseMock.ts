/**
 * features/controller/noise/noiseMock.ts
 * ---------------------------------------------------------------------------
 * The MOCK white-noise backend (demo-feedback story 09 AC5), used only when `USE_MOCK_DATA` is on
 * (`@/core/config/mockData`, the console's existing mock switch). STAFF world, no UI.
 *
 * It mirrors story 05's routes through an axios adapter on the shared client, so the service makes
 * exactly the same `GET`/`PUT /staff/noise` calls in both modes:
 *   - `GET`  answers the in-memory state;
 *   - `PUT { level }` sets the level (an unknown level is a 400 ProblemDetails, like the server)
 *     and then pushes the new state to every mock subscriber, standing in for the staff-group
 *     `NoiseStateChanged` frame (there is no hub in mock mode).
 * The pool is a fixed 24 entries and nothing is ever posted, so `postedCount` stays 0 and
 * `running` is simply "a level is set". The console's own Freeze rule (`noiseStatus.ts`) still
 * shows "Stopped: the world is frozen" when the mock world is frozen.
 */

import { AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { isNoiseLevel, type NoiseLevel, type NoiseStateDto } from './noiseTypes'

/** The rates the server uses (DF-12): off 0, low 2, medium 6, high 15 per minute. */
const RATES: Readonly<Record<NoiseLevel, number>> = { off: 0, low: 2, medium: 6, high: 15 }

const MOCK_POOL_SIZE = 24

let mockLevel: NoiseLevel = 'off'
const listeners = new Set<(state: NoiseStateDto) => void>()

/** The mock state as the server would report it. */
export function mockNoiseState(): NoiseStateDto {
  return {
    level: mockLevel,
    ratePerMinute: RATES[mockLevel],
    poolSize: MOCK_POOL_SIZE,
    postedCount: 0,
    running: RATES[mockLevel] > 0,
  }
}

/** Subscribes to the mock `NoiseStateChanged` push. Returns an unsubscribe. */
export function subscribeMockNoiseState(listener: (state: NoiseStateDto) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test-only: back to Off with no subscribers. */
export function resetNoiseMockForTest(): void {
  mockLevel = 'off'
  listeners.clear()
}

function respond(config: InternalAxiosRequestConfig, status: number, data: unknown): AxiosResponse {
  return { data, status, statusText: String(status), headers: new AxiosHeaders(), config }
}

function readLevel(data: unknown): unknown {
  const body: unknown = typeof data === 'string' ? JSON.parse(data) : data
  return typeof body === 'object' && body !== null ? (body as { level?: unknown }).level : undefined
}

/** The axios adapter for `GET`/`PUT /staff/noise` under mock data. */
export const mockNoiseAdapter: AxiosAdapter = config => {
  if (config.method?.toLowerCase() === 'put') {
    let level: unknown
    try {
      level = readLevel(config.data)
    } catch {
      level = undefined
    }
    if (!isNoiseLevel(level)) {
      const response = respond(config, 400, {
        title: 'Bad Request',
        status: 400,
        detail: 'The level must be off, low, medium or high.',
      })
      return Promise.reject(
        new AxiosError('Request failed with status code 400', AxiosError.ERR_BAD_REQUEST, config, null, response),
      )
    }
    mockLevel = level
    const state = mockNoiseState()
    for (const listener of [...listeners]) listener(state)
    return Promise.resolve(respond(config, 200, state))
  }
  return Promise.resolve(respond(config, 200, mockNoiseState()))
}
