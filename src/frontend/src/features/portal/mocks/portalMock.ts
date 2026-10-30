/**
 * features/portal/mocks/portalMock.ts
 * ---------------------------------------------------------------------------
 * The portal mock seam (exercise-portal story 02, #768; PC-5 `mocks/`). The
 * same shape as `withChannelsMock`: every portal request still goes through
 * the shared axios client (`api`), so base URL, headers and interceptors run
 * exactly as they will against the live PC-4 routes; only the transport is
 * swapped, at ONE env-guarded flip point (`USE_MOCK_PORTAL`). A production
 * build without `VITE_USE_MOCK_DATA` sends real requests and fails closed.
 *
 * The adapter answers the participant routes `GET /portal`,
 * `GET /portal/resources` and `GET /portal/resources/{id}` from the active
 * scenario (`normalDay` unless a test or harness picks another with
 * `setPortalMockScenario`). Anything else, and an unknown resource id, is a
 * 404: the same single not-found the live API gives. It never reads or sends
 * an exercise id.
 *
 * World: both (data only).
 */

import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { PORTAL_SCENARIOS, type PortalScenarioKey } from './fixtures'

/**
 * The SINGLE mock/live flip point for every portal request. Mock in dev/test
 * (or with the explicit `VITE_USE_MOCK_DATA=true` opt-in); live otherwise.
 */
export const USE_MOCK_PORTAL = USE_MOCK_DATA

const DEFAULT_SCENARIO: PortalScenarioKey = 'normalDay'
let activeScenario: PortalScenarioKey = DEFAULT_SCENARIO

/** Selects the scenario the adapter serves (tests, dev harnesses). */
export function setPortalMockScenario(key: PortalScenarioKey): void {
  activeScenario = key
}

/** Restores the default scenario (`normalDay`); call it in a test's cleanup. */
export function resetPortalMockScenario(): void {
  activeScenario = DEFAULT_SCENARIO
}

/** The scenario the adapter serves now. */
export function getPortalMockScenario(): PortalScenarioKey {
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
  if (segments[0] !== 'portal') return [404, null]

  const scenario = PORTAL_SCENARIOS[activeScenario]
  if (segments.length === 1) return [200, scenario.portal]
  if (segments[1] !== 'resources') return [404, null]
  if (segments.length === 2) return [200, scenario.resources]

  const resource = scenario.resources.find(r => r.id === segments[2])
  return segments.length === 3 && resource ? [200, resource] : [404, null]
}

/**
 * Answers portal requests from the active scenario. A non-200 rejects like
 * axios does for a real response (default `validateStatus`), so callers
 * exercise their not-found path.
 */
export const portalMockAdapter: AxiosAdapter = config => {
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
 * The request config every portal call passes to `api`: the mock adapter
 * when `USE_MOCK_PORTAL` is on, the caller's config untouched otherwise.
 */
export function withPortalMock<D = unknown>(
  config?: AxiosRequestConfig<D>,
): AxiosRequestConfig<D> | undefined {
  return USE_MOCK_PORTAL ? { ...config, adapter: portalMockAdapter } : config
}
