/**
 * features/participantAdmin/dayWord/dayWordMocks.ts
 * ---------------------------------------------------------------------------
 * The mock adapter that stands in for backend story 05 so the staff "Today's
 * word" panel runs and is tested with NO backend (easy-login story 11). It is
 * attached by `dayWordService.ts` at its single `USE_MOCK_DATA` flip point and
 * implements the three calls of the FROZEN contract (implementation.md):
 *
 *   GET    /staff/day-word                 -> 200 DayWordStatusDto
 *   PUT    /staff/day-word  {word?, date?} -> 200 DayWordSetResultDto
 *                                             | 400 (bad word / bad date)
 *   DELETE /staff/day-word[?date=]         -> 204, idempotent | 400
 *   any call, when forbidden               -> 403 (an evaluator / wrong role)
 *
 * What it models, because the panel's behaviour depends on it:
 *  - ONE word per exercise per calendar DATE in the exercise zone (EL-9); "today"
 *    is the real wall clock there. `todayEndsAt` / `validUntil` are the real next
 *    local midnight in that zone.
 *  - The word is NEVER stored or logged. Like the server (a PBKDF2 hash), the mock
 *    keeps only { setAt, setByName, replacedCount } per date, so `GET` cannot leak
 *    what `PUT` returned and there is nothing here to read back. Even the
 *    test-only request log (`putRequests()`) records just { hasWord, date? } -
 *    whether a word was typed, never which.
 *  - Generated vs typed (`generated`), first set vs rotation (`replaced`,
 *    `replacedCount`), the 14-day pre-set window, and the same 6-to-64
 *    letters-and-digits rule the real server enforces (via the shared
 *    `normalizeDayWord`).
 *  - A deterministic way to hit every error path (`dayWordMockControls`) so tests
 *    do not depend on a magic input: a queued 4xx / 5xx for the next request (of a
 *    given method), a blanket 403, and a 2xx whose body is not the contract's shape
 *    AFTER the change committed (the "may have been set" case).
 *
 * It is DEMO / TEST CONFIG, not product behaviour: deleted from the call path the
 * moment the live endpoint is deployed (the flip point stops attaching it).
 *
 * `dayWordMockControls` is a test seam only. Production code never imports it.
 *
 * World: STAFF. No UI.
 */

import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { addDaysToDate, isDateString, isPresetDateInRange } from './dayWordDates'
import { normalizeDayWord } from './dayWordNormalize'
import {
  DAY_WORD_MAX_DAYS_AHEAD,
  DAY_WORD_MAX_LENGTH,
  DAY_WORD_MIN_LENGTH,
  type DayWordSetResultDto,
  type DayWordStatusDto,
} from './types'

/** The mock exercise's IANA zone (matches the mock exercise-context resolver). */
export const MOCK_DAY_WORD_TIME_ZONE = 'America/New_York'

/** The mock staff member recorded as having set a word. */
export const MOCK_DAY_WORD_STAFF_NAME = 'Casey Controller'

/** What the mock records about a set word. The word itself is never kept. */
interface MockWordRow {
  setAt: string
  setByName: string
  replacedCount: number
}

type MockMethod = 'get' | 'put' | 'delete'

/** A failure queued by a test to be returned by the next matching request. */
interface QueuedFailure {
  status: number
  detail: string
  /** Only fail a request of this method; absent = the next request of any method. */
  method?: MockMethod
}

/** What the test-only request log keeps of a `PUT`: never the word itself. */
export interface MockPutRequest {
  hasWord: boolean
  date?: string
}

const FORBIDDEN_DETAIL =
  'Only a controller or planner assigned to this exercise can manage the day word.'

let rows = new Map<string, MockWordRow>()
let queuedFailures: QueuedFailure[] = []
let forbidden = false
let nowOverride: Date | null = null
let putRequests: MockPutRequest[] = []
let malformNextResponse = false

const now = (): Date => nowOverride ?? new Date()

// ---------------------------------------------------------------- zone arithmetic

/** The calendar date (`yyyy-MM-dd`) of `instant` in `timeZone`. */
function dateInZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const pick = (type: string): string => parts.find(part => part.type === type)?.value ?? ''
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

/** `timeZone`'s offset from UTC at `instant`, in ms (east of UTC is positive). */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const n = (type: string): number => Number(parts.find(part => part.type === type)?.value ?? '0')
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/** The instant a calendar `date` begins (local midnight) in `timeZone`. */
function startOfDateInZone(date: string, timeZone: string): Date {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number)
  const wallClockAsUtc = Date.UTC(y, m - 1, d)
  const first = wallClockAsUtc - zoneOffsetMs(new Date(wallClockAsUtc), timeZone)
  // One correction pass covers a DST change between the guess and the answer.
  const second = wallClockAsUtc - zoneOffsetMs(new Date(first), timeZone)
  return new Date(second)
}

const today = (): string => dateInZone(now(), MOCK_DAY_WORD_TIME_ZONE)

/** The instant the given date ends: the next local midnight in the exercise zone. */
const endOfDate = (date: string): string =>
  startOfDateInZone(addDaysToDate(date, 1), MOCK_DAY_WORD_TIME_ZONE).toISOString()

// ---------------------------------------------------------------- generator

/** Unambiguous words for a readable generated phrase (mock only). */
const WORDS = [
  'amber', 'harbor', 'cedar', 'falcon', 'lantern', 'meadow', 'copper', 'summit',
  'willow', 'granite', 'beacon', 'orchard', 'thistle', 'compass', 'juniper', 'ember',
]

function pick<T>(items: readonly T[]): T {
  // Mock-only randomness: the real generator is server-side and cryptographic.
  const choice = items[Math.floor(Math.random() * items.length)]
  if (choice === undefined) throw new Error('dayWordMocks: empty pick list')
  return choice
}

function generateMockWord(): string {
  const digits = String(10 + Math.floor(Math.random() * 90))
  return `${pick(WORDS)}-${pick(WORDS)}-${digits}`
}

// ---------------------------------------------------------------- responses

function respond(config: InternalAxiosRequestConfig, status: number, data: unknown) {
  return {
    data,
    status,
    statusText: status === 204 ? 'No Content' : 'OK',
    headers: {},
    config,
  }
}

/** Rejects like axios does for a non-2xx: an `AxiosError` carrying the response. */
function fail(config: InternalAxiosRequestConfig, status: number, detail: string): never {
  const response = {
    data: { title: status === 403 ? 'Forbidden' : 'Bad Request', status, detail },
    status,
    statusText: status === 403 ? 'Forbidden' : 'Bad Request',
    headers: {},
    config,
  }
  throw new AxiosError(
    `Request failed with status code ${status}`,
    status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
    config,
    null,
    response,
  )
}

function parseJsonBody(config: InternalAxiosRequestConfig): unknown {
  const raw: unknown = config.data
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

function dateParam(config: InternalAxiosRequestConfig): string | undefined {
  const params: unknown = config.params
  if (typeof params !== 'object' || params === null) return undefined
  const value = (params as Record<string, unknown>).date
  return typeof value === 'string' ? value : undefined
}

// ---------------------------------------------------------------- the three calls

function status(config: InternalAxiosRequestConfig) {
  const todayDate = today()
  const row = rows.get(todayDate)
  const upcoming = [...rows.entries()]
    .filter(([date]) => date > todayDate)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, value]) => ({ date, setAt: value.setAt }))
  const body: DayWordStatusDto = {
    timeZone: MOCK_DAY_WORD_TIME_ZONE,
    today: todayDate,
    todayEndsAt: endOfDate(todayDate),
    todaySet: row !== undefined,
    ...(row ? { setAt: row.setAt, setByName: row.setByName } : {}),
    replacedCount: row?.replacedCount ?? 0,
    upcoming,
  }
  return respond(config, 200, body)
}

function put(config: InternalAxiosRequestConfig) {
  const parsed = parseJsonBody(config)
  const body: Record<string, unknown> =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  const word = body.word
  const date = body.date
  putRequests.push({
    hasWord: typeof word === 'string',
    ...(typeof date === 'string' ? { date } : {}),
  })

  if (word !== undefined && typeof word !== 'string') {
    fail(config, 400, 'The word must be text.')
  }
  if (date !== undefined && !isDateString(date)) {
    fail(config, 400, 'The date must be written yyyy-MM-dd.')
  }
  const todayDate = today()
  const targetDate = typeof date === 'string' ? date : todayDate
  if (targetDate < todayDate) {
    fail(config, 400, 'A word cannot be set for a date in the past.')
  }
  if (!isPresetDateInRange(targetDate, todayDate)) {
    fail(config, 400, `A word can be set at most ${DAY_WORD_MAX_DAYS_AHEAD} days ahead.`)
  }
  if (typeof word === 'string') {
    const length = normalizeDayWord(word).length
    if (length < DAY_WORD_MIN_LENGTH || length > DAY_WORD_MAX_LENGTH) {
      fail(
        config,
        400,
        `The word must be ${DAY_WORD_MIN_LENGTH} to ${DAY_WORD_MAX_LENGTH} letters and digits ` +
          'once capitals, spaces and punctuation are ignored.',
      )
    }
  }

  const existing = rows.get(targetDate)
  const setAt = now().toISOString()
  rows.set(targetDate, {
    setAt,
    setByName: MOCK_DAY_WORD_STAFF_NAME,
    replacedCount: existing ? existing.replacedCount + 1 : 0,
  })

  const result: DayWordSetResultDto = {
    date: targetDate,
    word: typeof word === 'string' ? word.trim() : generateMockWord(),
    generated: typeof word !== 'string',
    replaced: existing !== undefined,
    setAt,
    validUntil: endOfDate(targetDate),
  }
  return respond(config, 200, result)
}

function remove(config: InternalAxiosRequestConfig) {
  const date = dateParam(config)
  if (date !== undefined && !isDateString(date)) {
    fail(config, 400, 'The date must be written yyyy-MM-dd.')
  }
  const todayDate = today()
  const targetDate = date ?? todayDate
  if (!isPresetDateInRange(targetDate, todayDate)) {
    fail(config, 400, `The date must be today or up to ${DAY_WORD_MAX_DAYS_AHEAD} days ahead.`)
  }
  // Idempotent: deleting a date with no word is still a 204.
  rows.delete(targetDate)
  return respond(config, 204, undefined)
}

/** The mock adapter `dayWordService` attaches per request when `USE_MOCK_DATA` is on. */
export const dayWordMockAdapter: AxiosAdapter = async config => {
  const method = (config.method ?? 'get').toLowerCase()
  const queuedIndex = queuedFailures.findIndex(
    failure => failure.method === undefined || failure.method === method,
  )
  if (queuedIndex !== -1) {
    const [queued] = queuedFailures.splice(queuedIndex, 1)
    if (queued) fail(config, queued.status, queued.detail)
  }
  if (forbidden) fail(config, 403, FORBIDDEN_DETAIL)

  let response: ReturnType<typeof respond>
  switch (method) {
    case 'get':
      response = status(config)
      break
    case 'put':
      response = put(config)
      break
    case 'delete':
      response = remove(config)
      break
    default:
      return fail(config, 400, 'Unsupported day-word method.')
  }

  if (malformNextResponse && response.status !== 204) {
    // The change above COMMITTED; only the answer is garbled (a proxy rewrite, a
    // server bug, a contract drift). The caller must not assume nothing happened.
    malformNextResponse = false
    return { ...response, data: { unexpected: true } }
  }
  return response
}

/**
 * TEST / DEMO SEAM. Lets a test put the in-memory mock into a known state and
 * reach each error path deterministically. Never imported by production code.
 */
export const dayWordMockControls = {
  /** Clears every set word and every override. Call in `beforeEach`. */
  reset(): void {
    rows = new Map()
    queuedFailures = []
    forbidden = false
    nowOverride = null
    putRequests = []
    malformNextResponse = false
  },
  /** Pins "now" (the wall clock in the exercise zone). `null` restores real time. */
  setNow(instant: Date | null): void {
    nowOverride = instant
  },
  /** The mock's idea of today in the exercise zone (`yyyy-MM-dd`). */
  today,
  /** Marks `date` as having a word, as if staff had set it earlier. */
  seedWord(
    date: string,
    row: Partial<MockWordRow> = {},
  ): void {
    rows.set(date, {
      setAt: row.setAt ?? now().toISOString(),
      setByName: row.setByName ?? MOCK_DAY_WORD_STAFF_NAME,
      replacedCount: row.replacedCount ?? 0,
    })
  },
  /** Every following request answers `403` (an evaluator or a wrong-role staff). */
  forbid(): void {
    forbidden = true
  },
  /**
   * The NEXT matching request fails with `status` and a ProblemDetails `detail`.
   * `method` limits it to a GET / PUT / DELETE (e.g. fail the status refetch that
   * follows a successful PUT); `times` queues that many consecutive failures
   * (a retried query needs one per attempt).
   */
  failNext(
    status: number,
    detail: string,
    options: { method?: MockMethod; times?: number } = {},
  ): void {
    for (let i = 0; i < (options.times ?? 1); i += 1) {
      queuedFailures.push({
        status,
        detail,
        ...(options.method !== undefined ? { method: options.method } : {}),
      })
    }
  },
  /**
   * The NEXT successful request still performs its change but answers with a 2xx
   * body that is not the contract's shape - "the word may have been set".
   */
  malformNext(): void {
    malformNextResponse = true
  },
  /**
   * What each `PUT` carried, in order: whether a word was typed and the date - NEVER
   * the word. (Tests that need the exact wire body spy on `api.put` instead.)
   */
  putRequests(): readonly MockPutRequest[] {
    return putRequests
  },
}
