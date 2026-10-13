/**
 * features/login/services/participantSignInService.ts
 * ---------------------------------------------------------------------------
 * The participant sign-in data seam (feature: login, story 02 — "Participant
 * sign-in"; GitHub #305; extended by easy-login story 09 — "Sign-in page:
 * Today's word"; GitHub #474). Consumes the FROZEN backend contract (story 01 /
 * identity-auth-roles for the first two; easy-login `implementation.md` wire
 * table + backend story 05 for the third):
 *
 *   POST /auth/login   { username, password }      — named account
 *   POST /auth/shared  { password }                — shared (view-only) exercise code
 *   POST /auth/word    { signInName, word }        — sign-in name + TODAY'S WORD
 *
 * ALL THREE return the SAME success envelope: `{ token, refreshToken?, session? }`.
 * A bad credential/code/word responds 401 on any endpoint; `/auth/word` also
 * answers 400 (missing/oversized field) and 429 (per-IP limiter) and never says
 * which half of a name + word pair was wrong. See `@/core/services/api.ts`'s own
 * header for why these paths (plus `/auth/staff/login`, `/auth/join`) are
 * excluded from the shared client's silent-refresh retry — a bad-credentials 401
 * here is never mistaken for an expired session.
 *
 * MOCK vs LIVE — TWO DIFFERENT STANCES IN ONE FILE:
 *   - `signInWithPassword` / `signInWithSharedCode` have NO MOCK ADAPTER
 *     (deliberately, unlike `exerciseContextResolver.ts` / `sessionResolver.ts`
 *     / `staffAssignmentsService.ts`): they were built against a live backend
 *     (story 02) and a canned success would defeat the purpose of a credentials
 *     gate. They always route through the shared axios client with no
 *     `adapter:` escape hatch.
 *   - `signInWithDayWord` IS MOCK-FIRST (easy-login `implementation.md`:
 *     "frontend runs mock-first behind the frozen contract"), because the
 *     backend route (easy-login story 05) lands after this page. It follows the
 *     `features/planner/services/accountImportService.ts` precedent: every call
 *     still goes through the shared client (so the request shape is exactly the
 *     live one), and a per-request `adapter` short-circuits the network at ONE
 *     env-guarded flip point, `USE_MOCK_DAY_WORD = USE_MOCK_DATA` — true in a
 *     dev build or when `VITE_USE_MOCK_DATA=true`; a production build without
 *     the flag FAILS CLOSED to the real endpoint (COR-001). Flip to live = no
 *     consumer change. THE MOCK'S RULES (demo config, not product copy):
 *       * the word `demo-word` with any non-blank sign-in name -> 200 with a
 *         canned mock-participant envelope. The word is compared the way the
 *         real server will compare it (EL-9): NFKD, combining marks stripped,
 *         lower-cased, only `a-z0-9` kept - so `Demo-Word`, `demoword` and
 *         `  DEMO word ` all sign in, as they would against the real route;
 *       * ANYTHING ELSE (wrong word, blank name, unparseable body) -> 401 with
 *         no detail, exactly like the real route;
 *       * the sentinel `slow` — as the sign-in name OR the word (trimmed,
 *         case-insensitive) — makes the mock wait ~1.5 s before answering (the
 *         outcome is still decided by the word), so the "Signing in…" state and
 *         its double-submit guard can be seen by hand. `slow` as a word is
 *         therefore a slow 401; `slow` as a name with `demo-word` is a slow
 *         success.
 *     The mock is exported as constants (`MOCK_DAY_WORD`, `MOCK_SLOW_DELAY_MS`,
 *     `MOCK_SLOW_SENTINEL`) so tests and the UAT script name them rather than
 *     retyping literals.
 *
 * DAY-WORD NORMALISATION IS THE SERVER'S JOB (EL-9). The server normalises the
 * word (NFKD, accents stripped, lower-case, `a-z0-9` only) before hashing; this
 * seam therefore sends the sign-in name and word EXACTLY AS GIVEN. The page
 * trims surrounding whitespace and does nothing else — no case-folding, no
 * stripping — and this module does not even trim. (Only the MOCK adapter
 * applies the rule, privately, so the demo accepts what the real server
 * would.)
 *
 * ERROR TRANSLATION mirrors `staffAssignmentsService.ts`'s
 * `StaffAssignmentError` precedent: `ParticipantSignInError` carries a
 * transport-agnostic `status`/`serverMessage` so the page can render clear
 * feedback without coupling itself to axios internals.
 * `isUnauthorizedSignInError()` is the ONE seam the page uses to detect "bad
 * credentials/code/word" (status 401), and `isRateLimitedSignInError()` the one
 * for "too many tries" (status 429) — the page never inspects `serverMessage`
 * for either decision, so a server that happens to distinguish "no such
 * handle" from "wrong password" in its own logs can never leak that
 * distinction into the participant-facing copy (NFR-009, anti-enumeration).
 *
 * THE DAY-WORD PATH IS STATUS-ONLY (NFR-004 / NFR-009). Unlike the two older
 * endpoints, `signInWithDayWord` rethrows a `ParticipantSignInError` that keeps
 * ONLY the HTTP status: no `serverMessage` and no `cause`. An axios error's
 * `config.data` holds the request body — i.e. the word — so carrying it as a
 * `cause` would put the word one `console.error(error)` / `JSON.stringify(error)`
 * away from a log, and a server body echoing the request must not become an
 * error string either.
 *
 * NEVER logs a username, password, word, or token — this module has no console
 * output at all, matching `tokenStore.ts` / `core/services/api.ts`'s own
 * precedent.
 *
 * World: participant. Pure data/service module — no UI, no COBRA, no
 * participant skin. Exempt from the scenario-time rule (COR-053): this seam
 * carries no participant-visible timestamps.
 */

import axios, { AxiosError, type AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'

const LOGIN_ENDPOINT = '/auth/login'
const SHARED_ENDPOINT = '/auth/shared'
const WORD_ENDPOINT = '/auth/word'

/** Named-account credentials for `POST /auth/login`. */
export interface NamedSignInCredentials {
  readonly username: string
  readonly password: string
}

/** The shared exercise code for `POST /auth/shared` (a single password field). */
export interface SharedSignInCredentials {
  readonly password: string
}

/**
 * The sign-in name + today's word for `POST /auth/word`. Both are sent exactly
 * as given (EL-9: normalisation is the server's job); the page has already
 * trimmed surrounding whitespace.
 */
export interface DayWordCredentials {
  readonly signInName: string
  readonly word: string
}

/**
 * The shared success envelope ALL THREE endpoints return. The page only needs
 * `token` + `refreshToken` (passed straight to `setTokens()`); `session` is
 * carried through untyped since neither this seam nor the page reads it.
 */
export interface LoginEnvelope {
  readonly token: string
  readonly refreshToken?: string
  readonly session?: unknown
}

/**
 * A transport-agnostic error this seam throws so the page can render clear
 * feedback WITHOUT coupling itself to axios internals. `status` is the HTTP
 * status when the server responded (401/…), or `undefined` when the request
 * never reached a response (network failure). Mirrors `StaffAssignmentError`
 * (`features/staff/services/staffAssignmentsService.ts`).
 */
export interface ParticipantSignInErrorInit {
  readonly status?: number
  readonly serverMessage?: string
  readonly cause?: unknown
}

export class ParticipantSignInError extends Error {
  readonly status?: number
  readonly serverMessage?: string

  constructor(message: string, init: ParticipantSignInErrorInit = {}) {
    super(message)
    this.name = 'ParticipantSignInError'
    this.status = init.status
    this.serverMessage = init.serverMessage
    if (init.cause !== undefined) {
      this.cause = init.cause
    }
  }
}

/**
 * True when `error` is a `ParticipantSignInError` for a 401 (bad
 * handle/password or bad shared code) — the ONE signal the page uses to show
 * the generic anti-enumeration message (NFR-009). Anything else (network
 * failure, 5xx, malformed response) is a different, non-enumeration failure
 * the page renders with its own generic "try again" copy.
 */
export function isUnauthorizedSignInError(error: unknown): boolean {
  return error instanceof ParticipantSignInError && error.status === 401
}

/**
 * True when `error` is a `ParticipantSignInError` for a 429 (the per-IP
 * limiter on `/auth/word`). Like the 401 check this branches on the HTTP
 * status only, never on server-supplied text.
 */
export function isRateLimitedSignInError(error: unknown): boolean {
  return error instanceof ParticipantSignInError && error.status === 429
}

/** Pulls a human-readable reason off a server error body (string or object). */
function extractServerMessage(data: unknown): string | undefined {
  if (typeof data === 'string') {
    const trimmed = data.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  if (typeof data === 'object' && data !== null) {
    const body = data as Record<string, unknown>
    for (const key of ['message', 'detail', 'title'] as const) {
      const value = body[key]
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim()
      }
    }
  }
  return undefined
}

/** Translates any thrown transport failure into a `ParticipantSignInError`. */
function toSignInError(error: unknown, fallbackMessage: string): ParticipantSignInError {
  if (error instanceof ParticipantSignInError) {
    return error
  }
  if (axios.isAxiosError(error)) {
    return new ParticipantSignInError(error.message, {
      status: error.response?.status,
      serverMessage: extractServerMessage(error.response?.data),
      cause: error,
    })
  }
  if (error instanceof Error) {
    return new ParticipantSignInError(error.message, { cause: error })
  }
  return new ParticipantSignInError(fallbackMessage, { cause: error })
}

/**
 * Runtime guard so this seam stays defensive against a malformed/empty
 * response body: an out-of-shape envelope fails closed (throws) rather than
 * handing the page a `token` that doesn't exist. `refreshToken`/`session` are
 * optional — a shared read-only session may omit `refreshToken` entirely.
 */
function isLoginEnvelope(value: unknown): value is LoginEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return (
    typeof body.token === 'string' && body.token.length > 0 &&
    (body.refreshToken === undefined || typeof body.refreshToken === 'string')
  )
}

/**
 * Signs in with a named account: `POST /auth/login`. Throws
 * `ParticipantSignInError` on failure (bad credentials, network failure, or a
 * malformed response) — fail closed, never a default/partial envelope.
 */
export async function signInWithPassword(
  credentials: NamedSignInCredentials,
): Promise<LoginEnvelope> {
  let data: unknown
  try {
    const response = await api.post<LoginEnvelope>(LOGIN_ENDPOINT, credentials)
    data = response.data
  } catch (error) {
    throw toSignInError(error, 'Could not sign in. Please try again.')
  }

  if (!isLoginEnvelope(data)) {
    throw new ParticipantSignInError('signInWithPassword: response was empty or malformed.')
  }

  return data
}

/**
 * Signs in with the shared exercise code: `POST /auth/shared`. Throws
 * `ParticipantSignInError` on failure (bad code, network failure, or a
 * malformed response) — fail closed, never a default/partial envelope.
 */
export async function signInWithSharedCode(
  credentials: SharedSignInCredentials,
): Promise<LoginEnvelope> {
  let data: unknown
  try {
    const response = await api.post<LoginEnvelope>(SHARED_ENDPOINT, credentials)
    data = response.data
  } catch (error) {
    throw toSignInError(error, 'Could not sign in. Please try again.')
  }

  if (!isLoginEnvelope(data)) {
    throw new ParticipantSignInError('signInWithSharedCode: response was empty or malformed.')
  }

  return data
}

// ---------------------------------------------------------------------------
// Today's word (easy-login story 09): `POST /auth/word`, mock-first.
// ---------------------------------------------------------------------------

/**
 * The one word the mock accepts. Demo config. It is compared AFTER the EL-9
 * normalisation (see `normaliseDayWord`), so any spelling that normalises to
 * `demoword` signs in.
 */
export const MOCK_DAY_WORD = 'demo-word'

/** How long the mock waits when the `slow` sentinel is typed (milliseconds). */
export const MOCK_SLOW_DELAY_MS = 1500

/** Typed as the sign-in name or the word, makes the mock answer after ~1.5 s. */
export const MOCK_SLOW_SENTINEL = 'slow'

/** The canned mock-participant envelope the mock returns on a successful word. */
const MOCK_DAY_WORD_ENVELOPE: LoginEnvelope = {
  token: 'mock-participant-access-token',
  refreshToken: 'mock-participant-refresh-token',
}

/**
 * The SINGLE mock/live flip point for this endpoint (mirrors
 * `accountImportService.ts`): mock in dev/test or with `VITE_USE_MOCK_DATA=true`,
 * the real `POST /api/auth/word` otherwise (fails closed — COR-001).
 */
const USE_MOCK_DAY_WORD = USE_MOCK_DATA

/** Reads `{ signInName, word }` off the serialized request body; blanks when unreadable. */
function readMockDayWordBody(data: unknown): { signInName: string; word: string } {
  let parsed: unknown = data
  if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data)
    } catch {
      parsed = undefined
    }
  }
  const body = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  return {
    signInName: typeof body.signInName === 'string' ? body.signInName : '',
    word: typeof body.word === 'string' ? body.word : '',
  }
}

/**
 * The EL-9 day-word normalisation, exactly as the server applies it before
 * hashing: NFKD, strip combining marks (accents), lower-case, keep only ASCII
 * `a-z0-9`. Marks are stripped BEFORE lower-casing so a letter such as `İ`
 * (which lower-cases to `i` + a combining dot) ends up as plain `i`.
 * MOCK-ONLY: the real client never normalises (the server's job).
 */
function normaliseDayWord(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

const NORMALISED_MOCK_DAY_WORD = normaliseDayWord(MOCK_DAY_WORD)

function isSlowSentinel(value: string): boolean {
  return value.trim().toLowerCase() === MOCK_SLOW_SENTINEL
}

/**
 * Short-circuits the network with the mock's rules (see the file header) while
 * still exercising the shared client's request pipeline exactly as a live call
 * would. A rejection is a real `AxiosError` carrying a 401 `response`, so the
 * ordinary error translation below handles it with no mock-only branch.
 */
const mockDayWordAdapter: AxiosAdapter = async config => {
  const { signInName, word } = readMockDayWordBody(config.data)

  if (isSlowSentinel(signInName) || isSlowSentinel(word)) {
    await new Promise<void>(resolve => setTimeout(resolve, MOCK_SLOW_DELAY_MS))
  }

  if (normaliseDayWord(word) === NORMALISED_MOCK_DAY_WORD && signInName.trim().length > 0) {
    return { data: MOCK_DAY_WORD_ENVELOPE, status: 200, statusText: 'OK', headers: {}, config }
  }

  throw new AxiosError(
    'Request failed with status code 401',
    AxiosError.ERR_BAD_REQUEST,
    config,
    undefined,
    { data: '', status: 401, statusText: 'Unauthorized', headers: {}, config },
  )
}

/**
 * Signs in with a sign-in name + today's word: `POST /auth/word`. Throws
 * `ParticipantSignInError` on failure (bad name/word, rate limit, network
 * failure, or a malformed response) — fail closed, never a default/partial
 * envelope. The thrown error carries the HTTP status ONLY (see the file
 * header): no server text, no cause, never the word.
 */
export async function signInWithDayWord(
  credentials: DayWordCredentials,
): Promise<LoginEnvelope> {
  const body = { signInName: credentials.signInName, word: credentials.word }

  let data: unknown
  try {
    const response = USE_MOCK_DAY_WORD
      ? await api.post<LoginEnvelope>(WORD_ENDPOINT, body, { adapter: mockDayWordAdapter })
      : await api.post<LoginEnvelope>(WORD_ENDPOINT, body)
    data = response.data
  } catch (error) {
    const translated = toSignInError(error, 'Could not sign in. Please try again.')
    throw new ParticipantSignInError('signInWithDayWord: the sign-in request failed.', {
      status: translated.status,
    })
  }

  if (!isLoginEnvelope(data)) {
    throw new ParticipantSignInError('signInWithDayWord: response was empty or malformed.')
  }

  return data
}
