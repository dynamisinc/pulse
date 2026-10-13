/**
 * features/login/services/joinService.ts
 * ---------------------------------------------------------------------------
 * The "tap your personal link" data seam (feature: easy-login, story 08 — the
 * join page; COR-011, COR-012; decisions EL-6, EL-7). Consumes the FROZEN wire
 * contract in `docs/features/easy-login/implementation.md`:
 *
 *   POST /auth/join   { token }          (the token travels in the BODY, never
 *                                          in the URL, a header or a query string:
 *                                          EL-7, so it stays out of API access logs)
 *   200 -> LoginEnvelope  (the SAME envelope POST /auth/login answers)
 *   400 -> missing body / field
 *   401 -> everything else — wrong, revoked, replaced, expired — with NO detail
 *   429 -> the dedicated `easy-login-join` rate limit
 *
 * What it adds over `participantSignInService.ts`: ONE function, `signInWithLink`,
 * and ONE classifier, `classifyJoinFailure`. Everything shared is IMPORTED from
 * that module and never forked: `LoginEnvelope`, the runtime guard
 * (`isLoginEnvelope`), the transport-error translator (`toSignInError`),
 * `ParticipantSignInError` and `isUnauthorizedSignInError`.
 *
 * THE TOKEN IS A BEARER CREDENTIAL. This module therefore:
 *   - sends it only as `{ token }` in the POST body;
 *   - has NO console output of any kind;
 *   - never puts it in a thrown error. The axios error a failed call produces
 *     carries the request (`config.data` is the JSON body, token included) and
 *     axios messages are not ours to vouch for, so a failure is RE-WRAPPED into a
 *     fresh `ParticipantSignInError` with a FIXED message and the HTTP status only:
 *     no `cause`, no `serverMessage`, no request echo. (The server's own 401 body
 *     is dropped too, so no reason text can ever reach the page: anti-enumeration,
 *     NFR-009.)
 *   - never returns it: the mock envelope below contains fixed fake tokens, not
 *     the join token.
 *
 * A PARTICIPANT LINK MAY ONLY EVER YIELD A PARTICIPANT SESSION. The page stores
 * whatever this returns in `localStorage` (`persist: true`), the wider-blast-radius
 * store that is for participant tokens only (EL-10); staff tokens belong in
 * `sessionStorage`. So when the envelope's `session.role` is PRESENT and is not a
 * participant-world role (`participant` / `pio`; anything else, or a value that is
 * not a role at all, counts) the call is refused: it throws a 401-shaped error,
 * classified and worded exactly like a refused link, and nothing is stored. A
 * missing `session` or `session.role` is not refused (the contract always sends one,
 * but the guard only acts on a role it can SEE).
 *
 * ERROR CLASSES the page renders (`classifyJoinFailure`, the one seam, keyed on
 * HTTP status only — never on server text):
 *   - `link-invalid`  401, and 400 (a malformed request can never succeed on a
 *                     retry, so it reads as "this link isn't working").
 *   - `rate-limited`  429.
 *   - `unreachable`   everything else: no response at all (network, timeout),
 *                     5xx, any other status, or a 200 whose body is not a
 *                     `LoginEnvelope` (fail closed). These are retryable.
 * The request has a 20 s timeout (the same bound the silent refresh uses) so a
 * phone on a bad network gets "Couldn't reach the exercise" + Try again instead
 * of a spinner that never ends.
 *
 * THE EXCHANGE IS ANONYMOUS, SO IT CARRIES NO STORED CREDENTIAL. The shared client
 * attaches the stored `Authorization: Bearer …` to every request, but a browser
 * that opens a join link often still holds an OLD session (yesterday's, or another
 * participant's, which this very exchange is about to replace). The server honours
 * a live participant session before it looks at the route, and a session bound to a
 * different exercise than the host resolves to is refused outright with a 403
 * (`SessionAuthenticationMiddleware`): the join would then fail on the strength of
 * a credential it does not need, and "Try again" would repeat the same refusal.
 * So the call sets `Authorization: false`, axios' documented way to send no such
 * header, which also makes the shared client's interceptor skip its attach.
 *
 * MOCK-FIRST (the frontend builds ahead of the backend; `implementation.md`
 * "Reuse map"; mirrors `features/planner/services/accountImportService.ts` and
 * `core/auth/sessionResolver.ts`): the flip is ONE env-guarded constant,
 * `USE_MOCK_JOIN = USE_MOCK_DATA` (`@/core/config/mockData`: a Vite dev build,
 * or an explicit `VITE_USE_MOCK_DATA=true`). The request still goes through the
 * shared axios client so its shape matches the live call exactly; only the
 * `adapter` differs. A production build that omits the flag always calls the real
 * endpoint (fail closed, COR-001). In mock mode the token's PREFIX picks the
 * outcome, so a demo can show every state without a backend:
 *
 *   demo-…     200: signs in as the mock participant (Dana Reyes, the same
 *              citizen `core/auth/sessionResolver.ts` mocks: acct-dreyes in
 *              ex-mock-0001), with fixed fake tokens
 *   slow-…     waits about 1.5 s (so "Signing you in…" is visible), then 200 as
 *              above
 *   expired-…  401, as a revoked/replaced/expired link would answer
 *   (any other token)  401 too — an unknown link is never a login
 *
 * World: participant (pre-auth). Pure data/service module — no UI, no COBRA, no
 * participant skin. Exempt from the scenario-time rule (COR-053): it carries no
 * participant-visible timestamps.
 */

import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { SESSION_TTL_MS } from '@/core/auth/sessionResolver'
import { isExerciseRole, isParticipantRole } from '@/core/auth/roles'
import {
  ParticipantSignInError,
  isLoginEnvelope,
  isUnauthorizedSignInError,
  toSignInError,
  type LoginEnvelope,
} from './participantSignInService'

/** The exchange endpoint, relative to the shared client's `/api` base URL. */
const JOIN_ENDPOINT = '/auth/join'

/** How long the exchange may take before it counts as "couldn't reach the exercise". */
const JOIN_TIMEOUT_MS = 20_000

/** Mock mode: how long a `slow-` token waits before answering. */
export const MOCK_SLOW_JOIN_MS = 1500

/** Fixed, fake, NON-secret tokens the mock envelope carries (never the join token). */
const MOCK_ACCESS_TOKEN = 'mock-join-access-token'
const MOCK_REFRESH_TOKEN = 'mock-join-refresh-token'

/** Fixed error text: nothing here can contain a token, a URL or server text. */
const NO_RESPONSE_MESSAGE = 'The join request did not reach the server.'
const MALFORMED_MESSAGE = 'The join response was empty or malformed.'
const NOT_A_PARTICIPANT_MESSAGE = 'The join response was not a participant session.'

/**
 * How the page should present a failed exchange (see the module header). The
 * page maps each to its own copy; this type is the whole vocabulary.
 */
export type JoinFailure = 'link-invalid' | 'rate-limited' | 'unreachable'

/**
 * The SINGLE mock/live flip point (mirrors the resolver precedents). Mock in a
 * dev build or when explicitly opted in; the real endpoint otherwise.
 */
const USE_MOCK_JOIN = USE_MOCK_DATA

/** Resolves after `ms` (the mock's artificial latency). */
function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Reads `{ token }` out of the request body axios hands a custom adapter (a JSON string). */
function tokenFromRequestBody(data: unknown): string {
  let body: unknown = data
  if (typeof data === 'string') {
    try {
      body = JSON.parse(data)
    } catch {
      return ''
    }
  }
  if (typeof body === 'object' && body !== null) {
    const token = (body as Record<string, unknown>).token
    if (typeof token === 'string') return token
  }
  return ''
}

/** The mock participant's envelope: Dana Reyes, consistent with the mock session resolver. */
function mockEnvelope(): LoginEnvelope {
  return {
    token: MOCK_ACCESS_TOKEN,
    refreshToken: MOCK_REFRESH_TOKEN,
    session: {
      exerciseId: 'ex-mock-0001',
      accountId: 'acct-dreyes',
      role: 'participant',
      personaId: 'persona-dreyes_fh',
      actingHumanId: 'human-dreyes',
      isReadOnly: false,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    },
  }
}

/**
 * True when the envelope names a role that is not a participant-world role (see
 * the module header). Only a role that is PRESENT is judged.
 */
function carriesNonParticipantRole(envelope: LoginEnvelope): boolean {
  const session = envelope.session
  if (typeof session !== 'object' || session === null) return false
  const role = (session as Record<string, unknown>).role
  if (role === undefined) return false
  return !(isExerciseRole(role) && isParticipantRole(role))
}

/** A 401 shaped like the real one: no body, no detail. */
function mockUnauthorized(config: InternalAxiosRequestConfig): AxiosError {
  return new AxiosError(
    'Request failed with status code 401',
    AxiosError.ERR_BAD_REQUEST,
    config,
    undefined,
    { data: '', status: 401, statusText: 'Unauthorized', headers: {}, config },
  )
}

/**
 * Mock-mode adapter: short-circuits the network while the request still travels
 * through the shared client's pipeline exactly as a live call would. The token's
 * prefix selects the outcome (module header).
 */
const mockAdapter: AxiosAdapter = async config => {
  const token = tokenFromRequestBody(config.data)
  if (token.startsWith('slow-')) {
    await wait(MOCK_SLOW_JOIN_MS)
  }
  if (token.startsWith('demo-') || token.startsWith('slow-')) {
    return { data: mockEnvelope(), status: 200, statusText: 'OK', headers: {}, config }
  }
  throw mockUnauthorized(config)
}

/**
 * Re-wraps a transport failure so the result can be logged, stringified or
 * serialised without leaking the join token: fixed message, status only, no
 * `cause` (which would hold the axios error and its request body), no
 * `serverMessage`.
 */
function withoutRequestEcho(error: ParticipantSignInError): ParticipantSignInError {
  if (error.status === undefined) {
    return new ParticipantSignInError(NO_RESPONSE_MESSAGE)
  }
  return new ParticipantSignInError(
    `The join request was refused (HTTP ${error.status}).`,
    { status: error.status },
  )
}

/**
 * Exchanges a personal link token for a session: `POST /auth/join { token }`.
 * Resolves with the `LoginEnvelope` (the caller stores it and hands off). Throws
 * a token-free `ParticipantSignInError` on any failure — a refused link, a rate
 * limit, no network, a 5xx, or a malformed body — and never a default/partial
 * envelope (fail closed).
 */
export async function signInWithLink(token: string): Promise<LoginEnvelope> {
  let data: unknown
  try {
    const response = await api.post<LoginEnvelope>(
      JOIN_ENDPOINT,
      { token },
      {
        timeout: JOIN_TIMEOUT_MS,
        // Anonymous exchange: never present a stored session (see the module header).
        headers: { Authorization: false },
        ...(USE_MOCK_JOIN ? { adapter: mockAdapter } : {}),
      },
    )
    data = response.data
  } catch (error) {
    throw withoutRequestEcho(toSignInError(error, NO_RESPONSE_MESSAGE))
  }

  if (!isLoginEnvelope(data)) {
    throw new ParticipantSignInError(MALFORMED_MESSAGE)
  }

  // Never let staff (or any non-participant) tokens reach the page, which would
  // persist them in `localStorage`. Reads as a refused link: status 401.
  if (carriesNonParticipantRole(data)) {
    throw new ParticipantSignInError(NOT_A_PARTICIPANT_MESSAGE, { status: 401 })
  }

  return data
}

/**
 * Sorts a failed exchange into the three presentations the page has (module
 * header). Decides on HTTP status ONLY, so a server that explained itself could
 * never change what a participant is told.
 */
export function classifyJoinFailure(error: unknown): JoinFailure {
  if (isUnauthorizedSignInError(error)) return 'link-invalid'
  if (error instanceof ParticipantSignInError) {
    if (error.status === 400) return 'link-invalid'
    if (error.status === 429) return 'rate-limited'
  }
  return 'unreachable'
}
