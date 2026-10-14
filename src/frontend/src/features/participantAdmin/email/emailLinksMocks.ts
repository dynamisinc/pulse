/**
 * features/participantAdmin/email/emailLinksMocks.ts
 * ---------------------------------------------------------------------------
 * The MOCK adapter for `POST /api/staff/roster/email-links` (easy-login story 13),
 * so the button, the confirm step and the result summary can be built and tested
 * with no backend. It follows the FROZEN contract (implementation.md, "email") and
 * is swapped in at ONE flip point, `USE_MOCK_EMAIL_LINKS` in `emailLinksService.ts`
 * (= `USE_MOCK_DATA`), never per call. NOTHING IS SENT: no address exists here.
 *
 * WHAT IT SERVES
 *   - `{}` ("every eligible participant"): a canned mix showing every status and
 *     reason: two `sent`, one `skipped` per skip reason the roster can produce
 *     (`noEmail`, `noActiveLink`, `disabled`, `tokenUnrecoverable`), and one
 *     `failed` / `rateLimited` (what an Azure-managed sender does past 5 a minute).
 *   - `{ participantIds }`: one `sent` per id (de-duplicated), in request order. Ids
 *     are not looked up (the mock cannot know the roster mock's people).
 *   - The SAME 400 rules as the server, as a ProblemDetails: a JSON object body,
 *     no property but `participantIds`, which, when present, is a non-empty array of
 *     strings with at most 100 entries.
 *
 * SCENARIOS. {@link setMockEmailLinksScenario} switches it to answer `503` (email not
 * configured), `403`, `401` or `500`, so every error state is reachable. Module
 * state, default `'ok'`; tests call {@link resetMockEmailLinks} in `afterEach`.
 *
 * World: STAFF (data only). No UI.
 */
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import type { RosterEmailResultDto } from './types'

/** The cap the real endpoint enforces. */
const MOCK_MAX_IDS = 100

/** Which answer the adapter gives. */
export type MockEmailLinksScenario = 'ok' | 'notConfigured' | 'forbidden' | 'unauthorized' | 'serverError'

let scenario: MockEmailLinksScenario = 'ok'

/** Switches the adapter's answer (tests and manual review). */
export function setMockEmailLinksScenario(next: MockEmailLinksScenario): void {
  scenario = next
}

/** Back to the default. */
export function resetMockEmailLinks(): void {
  scenario = 'ok'
}

/** The canned "everyone eligible" answer: every status and reason once. */
export function mockEveryoneResult(): RosterEmailResultDto {
  return {
    results: [
      { participantId: 'mock-participant-0001', status: 'sent' },
      { participantId: 'mock-participant-0002', status: 'sent' },
      { participantId: 'mock-participant-0003', status: 'skipped', reason: 'noEmail' },
      { participantId: 'mock-participant-0004', status: 'skipped', reason: 'noActiveLink' },
      { participantId: 'mock-participant-0005', status: 'skipped', reason: 'disabled' },
      { participantId: 'mock-participant-0006', status: 'skipped', reason: 'tokenUnrecoverable' },
      { participantId: 'mock-participant-0007', status: 'failed', reason: 'rateLimited' },
    ],
  }
}

const STATUS_TEXT: Readonly<Record<number, string>> = {
  200: 'OK',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
}

function respond(config: InternalAxiosRequestConfig, status: number, data: unknown) {
  const response = { data, status, statusText: STATUS_TEXT[status] ?? '', headers: {}, config }
  if (status >= 200 && status < 300) return Promise.resolve(response)
  return Promise.reject(new AxiosError(
    `Request failed with status code ${status}`,
    status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
    config,
    null,
    response,
  ))
}

function problem(config: InternalAxiosRequestConfig, status: number, detail: string) {
  return respond(config, status, { status, title: STATUS_TEXT[status] ?? '', detail })
}

/** Parses the serialized body the way the server's strict reader does; a string is the refusal. */
function parseBody(raw: unknown): { ids: string[] | null } | string {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return 'The body must be JSON.'
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'The body must be a JSON object.'
  }
  const keys = Object.keys(value)
  if (keys.some(key => key !== 'participantIds')) return 'Only participantIds is allowed.'
  if (!keys.includes('participantIds')) return { ids: null }

  const ids = (value as { participantIds: unknown }).participantIds
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) {
    return 'participantIds must be an array of strings.'
  }
  if (ids.length === 0) return 'participantIds must hold at least one id; to email everyone, omit it.'
  if (ids.length > MOCK_MAX_IDS) return `At most ${MOCK_MAX_IDS} participants may be emailed at once.`
  return { ids: ids as string[] }
}

/** The adapter. Answers like the live endpoint, from the request it is actually given. */
export const mockEmailLinksAdapter: AxiosAdapter = config => {
  switch (scenario) {
    case 'notConfigured': return problem(config, 503, 'Email delivery is not configured')
    case 'forbidden': return respond(config, 403, '')
    case 'unauthorized': return respond(config, 401, '')
    case 'serverError': return problem(config, 500, 'Mock server error.')
    default: break
  }

  const parsed = parseBody(config.data)
  if (typeof parsed === 'string') return problem(config, 400, parsed)
  if (parsed.ids === null) return respond(config, 200, mockEveryoneResult())

  const result: RosterEmailResultDto = {
    results: [...new Set(parsed.ids)].map(participantId => ({ participantId, status: 'sent' as const })),
  }
  return respond(config, 200, result)
}
