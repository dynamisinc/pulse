/**
 * features/press/mocks/pressMock.ts
 * ---------------------------------------------------------------------------
 * The press mock seam (press-room story 01, #738; PC-5 `mocks/`). The same
 * mechanism as `withPortalMock`: every press request still goes through the
 * shared axios client (`api`), so base URL, headers and interceptors run
 * exactly as they will against the live PC-4 routes; only the transport is
 * swapped, at ONE env-guarded flip point (`USE_MOCK_PRESS`). A production
 * build without `VITE_USE_MOCK_DATA` sends real requests and fails closed.
 *
 * The adapter answers the author routes `GET /press/orgs`,
 * `GET /press/releases` and `GET /press/releases/{id}` from the active
 * scenario (`activeNewsrooms` unless a test or harness picks another with
 * `setPressMockScenario`). Anything else, and an unknown release id, is a
 * 404: the same single not-found the live API gives. It never reads or sends
 * an exercise id.
 *
 * World: participant (data only).
 */

import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { PRESS_SCENARIOS, type PressScenarioKey } from './fixtures'

/**
 * The SINGLE mock/live flip point for every press request. Mock in dev/test
 * (or with the explicit `VITE_USE_MOCK_DATA=true` opt-in); live otherwise.
 */
export const USE_MOCK_PRESS = USE_MOCK_DATA

const DEFAULT_SCENARIO: PressScenarioKey = 'activeNewsrooms'
let activeScenario: PressScenarioKey = DEFAULT_SCENARIO

/** Selects the scenario the adapter serves (tests, dev harnesses). */
export function setPressMockScenario(key: PressScenarioKey): void {
  activeScenario = key
}

/** Restores the default scenario (`activeNewsrooms`); call it in a test's cleanup. */
export function resetPressMockScenario(): void {
  activeScenario = DEFAULT_SCENARIO
}

/** The scenario the adapter serves now. */
export function getPressMockScenario(): PressScenarioKey {
  return activeScenario
}

function respond(config: InternalAxiosRequestConfig, status: number, data: unknown): AxiosResponse {
  // A deep copy per response, so a consumer that mutates what it received can
  // never change the shared fixtures (or what the next test reads).
  const body: unknown = structuredClone(data)
  return { data: body, status, statusText: status === 200 ? 'OK' : 'Not Found', headers: {}, config }
}

/** Resolves one GET against the active scenario: `[status, body]`. */
function route(config: InternalAxiosRequestConfig): [number, unknown] {
  if ((config.method ?? 'get').toLowerCase() !== 'get') return [404, null]

  // A dummy origin only to parse the path; nothing is fetched.
  const url = new URL(config.url ?? '', 'http://mock.invalid')
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments[0] !== 'press') return [404, null]

  const scenario = PRESS_SCENARIOS[activeScenario]
  if (segments.length === 2 && segments[1] === 'orgs') return [200, scenario.orgs]
  if (segments[1] !== 'releases') return [404, null]
  if (segments.length === 2) return [200, scenario.releases]

  const release = scenario.releases.find(r => r.id === segments[2])
  return segments.length === 3 && release ? [200, release] : [404, null]
}

/**
 * Answers press requests from the active scenario. A non-200 rejects like
 * axios does for a real response (default `validateStatus`), so callers
 * exercise their not-found path.
 */
export const pressMockAdapter: AxiosAdapter = config => {
  const [status, data] = route(config)
  const response = respond(config, status, data)
  if (status >= 200 && status < 300) return Promise.resolve(response)
  const error = Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    config,
    response,
  })
  return Promise.reject(error)
}

/**
 * The request config every press call passes to `api`: the mock adapter
 * when `USE_MOCK_PRESS` is on, the caller's config untouched otherwise.
 */
export function withPressMock<D = unknown>(
  config?: AxiosRequestConfig<D>,
): AxiosRequestConfig<D> | undefined {
  return USE_MOCK_PRESS ? { ...config, adapter: pressMockAdapter } : config
}
