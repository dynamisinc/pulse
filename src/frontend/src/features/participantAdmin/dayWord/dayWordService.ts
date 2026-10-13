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
 * A transport-agnostic error so the panel renders status-aware feedback without
 * coupling to axios. `status` is the HTTP status when the server answered, or
 * `undefined` when no response arrived. `serverMessage` is the server's own
 * reason (ProblemDetails `detail`) when present - shown verbatim on a `400`.
 */
export interface DayWordErrorInit {
  readonly status?: number
  readonly serverMessage?: string
  readonly cause?: unknown
}

export class DayWordError extends Error {
  readonly status?: number
  readonly serverMessage?: string

  constructor(message: string, init: DayWordErrorInit = {}) {
    super(message)
    this.name = 'DayWordError'
    this.status = init.status
    this.serverMessage = init.serverMessage
    if (init.cause !== undefined) {
      this.cause = init.cause
    }
  }
}

/** Pulls a readable reason off a ProblemDetails (or plain string) error body. */
function extractServerMessage(data: unknown): string | undefined {
  if (typeof data === 'string') {
    const trimmed = data.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (typeof data === 'object' && data !== null) {
    const body = data as Record<string, unknown>
    for (const key of ['detail', 'message', 'title'] as const) {
      const value = body[key]
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim()
      }
    }
  }
  return undefined
}

/** Translates any thrown transport failure into a `DayWordError`. */
function toDayWordError(error: unknown): DayWordError {
  if (axios.isAxiosError(error)) {
    return new DayWordError(error.message, {
      status: error.response?.status,
      serverMessage: extractServerMessage(error.response?.data),
      cause: error,
    })
  }
  if (error instanceof Error) {
    return new DayWordError(error.message, { cause: error })
  }
  return new DayWordError('The day-word request failed for an unknown reason.', { cause: error })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
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
    throw new DayWordError('The day-word status response was empty or malformed.')
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
    throw new DayWordError('The day-word response was empty or malformed.')
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
