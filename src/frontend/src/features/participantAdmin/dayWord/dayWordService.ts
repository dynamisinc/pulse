/**
 * features/participantAdmin/dayWord/dayWordService.ts
 * ---------------------------------------------------------------------------
 * The data seam for the staff "Today's word" panel (feature: easy-login, story
 * 11; EL-9). Consumes the FROZEN backend contract (implementation.md):
 *
 *   GET    /api/staff/day-word                  -> 200 DayWordStatusDto
 *   PUT    /api/staff/day-word   DayWordPutBody -> 200 DayWordSetResultDto | 400
 *   DELETE /api/staff/day-word?date=yyyy-MM-dd  -> 204, idempotent       | 400
 *
 * Staff only: a live staff session assigned to the active exercise holding
 * `controller` or `planner` (401 no session, 403 wrong role). No request carries
 * an `exerciseId` - the server scopes everything (COR-001); the panel's React
 * Query key carries the id for CACHE separation only (see `useDayWord.ts`).
 *
 * THE WORD IS A SECRET. Only the PUT response ever carries the plaintext, once.
 * This module never logs, stores or caches it: it hands the parsed result to the
 * caller and forgets it. Error messages built here never include a request or
 * response body, so a rejected word cannot leak into a log via an error string.
 *
 * MOCK SEAM (same pattern as `features/planner/services/accountImportService.ts`):
 * every request goes through the shared axios client so the method / URL /
 * headers match the live endpoint exactly, and a per-request mock `adapter`
 * (`./dayWordMocks`) is attached at EXACTLY ONE env-guarded flip point
 * (`USE_MOCK_DAY_WORD = USE_MOCK_DATA`), never per call. A production build that
 * omits `VITE_USE_MOCK_DATA` therefore hits the real API and fails closed rather
 * than serving a canned word (COR-001).
 *
 * AUTH: this module never reads or attaches a token; the shared client's auth
 * layer does.
 *
 * World: STAFF. Pure data module - no UI, no COBRA.
 */

import axios, { type AxiosRequestConfig } from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { dayWordMockAdapter } from './dayWordMocks'
import { isDateString } from './dayWordDates'
import type { DayWordPutBody, DayWordSetResultDto, DayWordStatusDto } from './types'

/** The day-word endpoint, relative to the shared client's `/api` base URL. */
export const DAY_WORD_ENDPOINT = '/staff/day-word'

/** The SINGLE mock/live flip point for this module. */
const USE_MOCK_DAY_WORD = USE_MOCK_DATA

const mockConfig = (): Pick<AxiosRequestConfig, 'adapter'> =>
  USE_MOCK_DAY_WORD ? { adapter: dayWordMockAdapter } : {}

/**
 * What went wrong, so the panel can word it truthfully:
 *  - `http`      the server answered with a non-2xx (`status` / `serverMessage` set);
 *  - `network`   no answer at all (offline, timeout, CORS) - "check your connection";
 *  - `malformed` the server answered 2xx but the body was not the contract's shape.
 *                The call may well have COMMITTED, so this must never be reported
 *                as a connection problem;
 *  - `unknown`   anything else thrown inside the call.
 */
export type DayWordErrorKind = 'http' | 'network' | 'malformed' | 'unknown'

/**
 * The only thing kept of the underlying failure: a machine code and a status.
 * NEVER the original error - an `AxiosError` carries `config.data` (the request
 * body, i.e. the word staff just typed) and `request`/`response`, and an Error's
 * `cause` is a serialisable, loggable own property.
 */
export interface DayWordErrorCause {
  readonly code?: string
  readonly status?: number
}

/**
 * A transport-agnostic error so the panel renders status-aware feedback without
 * coupling to axios. `status` is the HTTP status when the server answered, or
 * `undefined` when no response arrived. `serverMessage` is the server's own
 * reason (ProblemDetails `detail`) when present - shown verbatim on a `400`.
 */
export interface DayWordErrorInit {
  readonly kind?: DayWordErrorKind
  readonly status?: number
  readonly serverMessage?: string
  readonly cause?: DayWordErrorCause
}

export class DayWordError extends Error {
  readonly kind: DayWordErrorKind
  readonly status?: number
  readonly serverMessage?: string

  constructor(message: string, init: DayWordErrorInit = {}) {
    super(message)
    this.name = 'DayWordError'
    this.kind = init.kind ?? 'unknown'
    this.status = init.status
    this.serverMessage = init.serverMessage
    if (init.cause !== undefined) {
      this.cause = init.cause
    }
  }
}

/** A readable reason is a sentence, not a page: cap what we are willing to show. */
const MAX_SERVER_MESSAGE_LENGTH = 300

/**
 * Pulls a readable reason off a ProblemDetails error body. A bare STRING body is
 * trusted only on a `400` (where the contract says the server explains itself);
 * on any other status it is more likely a proxy's or gateway's page (an HTML
 * "Bad Gateway"), which must not be pasted into the panel - the panel falls back
 * to generic wording instead.
 */
function extractServerMessage(data: unknown, status: number | undefined): string | undefined {
  let message: string | undefined
  if (typeof data === 'string') {
    if (status === 400) message = data.trim()
  } else if (typeof data === 'object' && data !== null) {
    const body = data as Record<string, unknown>
    for (const key of ['detail', 'message', 'title'] as const) {
      const value = body[key]
      if (typeof value === 'string' && value.trim().length > 0) {
        message = value.trim()
        break
      }
    }
  }
  if (message === undefined || message.length === 0) return undefined
  return message.length > MAX_SERVER_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_SERVER_MESSAGE_LENGTH)}…`
    : message
}

/** Translates any thrown transport failure into a `DayWordError`. */
function toDayWordError(error: unknown): DayWordError {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    return new DayWordError(error.message, {
      kind: error.response === undefined ? 'network' : 'http',
      status,
      serverMessage: extractServerMessage(error.response?.data, status),
      // Sanitised on purpose - see `DayWordErrorCause`.
      cause: {
        ...(error.code !== undefined ? { code: error.code } : {}),
        ...(status !== undefined ? { status } : {}),
      },
    })
  }
  if (error instanceof Error) {
    return new DayWordError(error.message, { kind: 'unknown' })
  }
  return new DayWordError('The day-word request failed for an unknown reason.', {
    kind: 'unknown',
  })
}

/** A 2xx whose body is not the contract's shape: the call may have committed. */
function malformed(what: string): DayWordError {
  return new DayWordError(`The day-word ${what} response was empty or malformed.`, {
    kind: 'malformed',
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * `setAt` and `setByName` are display-only, so a `null` (a server that writes
 * `null` instead of omitting) is read as "absent". Every other field is strict.
 */
function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string'
}

/**
 * Runtime guard + clean copy for `GET` so the seam swaps to the live endpoint
 * with no consumer change: an out-of-shape body fails closed (a thrown
 * `DayWordError`) instead of being cast blindly. Copying field by field also
 * guarantees the cached status object can never carry an extra property - in
 * particular a `word` - even if a server bug sent one.
 */
export function parseDayWordStatus(data: unknown): DayWordStatusDto | null {
  if (!isRecord(data)) return null
  const { timeZone, today, todayEndsAt, todaySet, setAt, setByName, replacedCount, upcoming } = data
  if (typeof timeZone !== 'string' || timeZone.length === 0) return null
  if (!isDateString(today)) return null
  if (typeof todayEndsAt !== 'string') return null
  if (typeof todaySet !== 'boolean') return null
  if (!isOptionalString(setAt) || !isOptionalString(setByName)) return null
  if (typeof replacedCount !== 'number' || !Number.isFinite(replacedCount)) return null
  if (!Array.isArray(upcoming)) return null

  const upcomingClean: DayWordStatusDto['upcoming'] = []
  for (const item of upcoming as unknown[]) {
    if (!isRecord(item) || !isDateString(item.date) || typeof item.setAt !== 'string') return null
    upcomingClean.push({ date: item.date, setAt: item.setAt })
  }

  return {
    timeZone,
    today,
    todayEndsAt,
    todaySet,
    ...(typeof setAt === 'string' ? { setAt } : {}),
    ...(typeof setByName === 'string' ? { setByName } : {}),
    replacedCount,
    upcoming: upcomingClean,
  }
}

/** Runtime guard + clean copy for the `PUT` result. */
export function parseDayWordSetResult(data: unknown): DayWordSetResultDto | null {
  if (!isRecord(data)) return null
  const { date, word, generated, replaced, setAt, validUntil } = data
  if (!isDateString(date)) return null
  if (typeof word !== 'string' || word.length === 0) return null
  if (typeof generated !== 'boolean' || typeof replaced !== 'boolean') return null
  if (typeof setAt !== 'string' || typeof validUntil !== 'string') return null
  return { date, word, generated, replaced, setAt, validUntil }
}

/**
 * `GET /staff/day-word`. Never returns or requests a word - only whether one is
 * set, who set it and when, and which later dates have one.
 */
export async function getDayWordStatus(): Promise<DayWordStatusDto> {
  let data: unknown
  try {
    const response = await api.get<unknown>(DAY_WORD_ENDPOINT, mockConfig())
    data = response.data
  } catch (error) {
    throw toDayWordError(error)
  }
  const status = parseDayWordStatus(data)
  if (status === null) {
    throw malformed('status')
  }
  return status
}

/**
 * `PUT /staff/day-word`. Omit `word` to have the server generate one; omit
 * `date` for today. Resolves with the plaintext word EXACTLY ONCE - the caller
 * must show it and drop it (see `OneTimeWordResult`), never cache it.
 */
export async function putDayWord(body: DayWordPutBody): Promise<DayWordSetResultDto> {
  // Send only the fields that were provided: "omit `word`" is the contract's
  // way of asking for a generated word, so an `undefined` must not become a key.
  const payload: DayWordPutBody = {
    ...(body.word !== undefined ? { word: body.word } : {}),
    ...(body.date !== undefined ? { date: body.date } : {}),
  }
  let data: unknown
  try {
    const response = await api.put<unknown>(DAY_WORD_ENDPOINT, payload, mockConfig())
    data = response.data
  } catch (error) {
    throw toDayWordError(error)
  }
  const result = parseDayWordSetResult(data)
  if (result === null) {
    throw malformed('set')
  }
  return result
}

/**
 * `DELETE /staff/day-word[?date=yyyy-MM-dd]` - turns word sign-in off for a day
 * (default today). Idempotent: clearing a day with no word is still a 204.
 */
export async function deleteDayWord(date?: string): Promise<void> {
  try {
    await api.delete(DAY_WORD_ENDPOINT, {
      ...(date !== undefined ? { params: { date } } : {}),
      ...mockConfig(),
    })
  } catch (error) {
    throw toDayWordError(error)
  }
}
