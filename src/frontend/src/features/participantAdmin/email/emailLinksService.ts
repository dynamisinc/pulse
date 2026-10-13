/**
 * features/participantAdmin/email/emailLinksService.ts
 * ---------------------------------------------------------------------------
 * The data seam for "Email links" (easy-login story 13; COR-017 in part). Consumes
 * the FROZEN contract (docs/features/easy-login/implementation.md):
 *
 *   POST /api/staff/roster/email-links   { participantIds?: string[] }
 *     omitted = every eligible participant (at most 100); otherwise 1..100 ids
 *   200 -> RosterEmailResultDto { results: [{ participantId, status, reason? }] }
 *   400 -> refused body / too many   401 -> no staff session
 *   403 -> not controller|planner    503 -> email delivery not configured
 *
 * NO EXERCISE ID IS EVER SENT (COR-001): the server scopes everything, and another
 * exercise's id comes back as an ordinary `notFound` skip.
 *
 * "EVERYONE" IS EXPLICIT. An EMPTY input is the body `{}` and nothing else does it;
 * a NON-empty input is cleaned (blank and repeated ids dropped) and sent as
 * `{ participantIds }`. If nothing usable is left it is refused as `badRequest` with
 * NO request made, never widened to everyone. More than 100 usable ids is refused
 * as `tooMany` with no request made (the server would answer 400). No chunking:
 * one request is one bounded batch, and each email is irrevocable.
 *
 * MOCK SEAM (mirrors `features/planner/services/accountImportService.ts` and
 * `cards/cardsService.ts`): every request goes through the shared axios client, so
 * the URL, headers and staff Authorization header are exactly the live ones. The mock
 * adapter is swapped in at ONE flip point (`USE_MOCK_EMAIL_LINKS = USE_MOCK_DATA`).
 *
 * SECRETS. The response carries ids and fixed reasons only, but errors still carry a
 * fixed message and a kind: no response body, no request config, no `cause`.
 *
 * RUNTIME GUARDS. An out-of-shape success body fails closed (`malformed`) instead of
 * being cast.
 *
 * World: STAFF. Pure data module: no UI, no COBRA.
 */
import axios from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { MAX_EMAILS_PER_REQUEST, usableIds } from './emailLinksFormat'
import { mockEmailLinksAdapter } from './emailLinksMocks'
import type {
  RosterEmailLinksBody,
  RosterEmailResultDto,
  RosterEmailResultItemDto,
  RosterEmailStatus,
} from './types'

/** The endpoint, relative to the shared client's `/api` base URL. */
export const EMAIL_LINKS_ENDPOINT = '/staff/roster/email-links'

/** The SINGLE mock/live flip point. Mock in dev/test; the live endpoint otherwise. */
const USE_MOCK_EMAIL_LINKS = USE_MOCK_DATA

const STATUSES: readonly RosterEmailStatus[] = ['sent', 'skipped', 'failed']

/**
 * What went wrong, in the terms the button needs to choose its message.
 *   notConfigured  503: email delivery, or the personal links themselves (no site address),
 *                  is not configured on this server.
 *   forbidden      403: signed in as staff, but not allowed to email links.
 *   unauthorized   401: no staff session.
 *   badRequest     400/413: the server refused the request, or nothing usable was given.
 *   tooMany        more than 100 people (refused here, nothing sent).
 *   malformed      200, but the body is not the frozen shape.
 *   unavailable    anything else: network failure, 5xx.
 */
export type EmailLinksErrorKind =
  | 'notConfigured'
  | 'forbidden'
  | 'unauthorized'
  | 'badRequest'
  | 'tooMany'
  | 'malformed'
  | 'unavailable'

const ERROR_MESSAGES: Readonly<Record<EmailLinksErrorKind, string>> = {
  notConfigured: 'Email delivery or personal links are not configured on this server.',
  forbidden: 'This account is not allowed to email sign-in links.',
  unauthorized: 'The staff session has ended. Sign in again.',
  badRequest: 'The server could not accept the email request.',
  tooMany: `At most ${MAX_EMAILS_PER_REQUEST} people can be emailed at once. Select fewer people.`,
  malformed: 'The email response was empty or malformed.',
  unavailable: 'The emails could not be sent. Check the connection and try again.',
}

/** A transport-agnostic error so the button can pick its copy without touching axios. */
export class EmailLinksError extends Error {
  readonly kind: EmailLinksErrorKind
  /** The HTTP status, when the server answered. */
  readonly status?: number

  constructor(kind: EmailLinksErrorKind, status?: number) {
    super(ERROR_MESSAGES[kind])
    this.name = 'EmailLinksError'
    this.kind = kind
    this.status = status
  }
}

function kindForStatus(status: number | undefined): EmailLinksErrorKind {
  switch (status) {
    case 400: return 'badRequest'
    case 413: return 'badRequest'
    case 401: return 'unauthorized'
    case 403: return 'forbidden'
    case 503: return 'notConfigured'
    default: return 'unavailable'
  }
}

function toEmailLinksError(error: unknown): EmailLinksError {
  if (error instanceof EmailLinksError) return error
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    return new EmailLinksError(kindForStatus(status), status)
  }
  return new EmailLinksError('unavailable')
}

function isResultItem(value: unknown): value is RosterEmailResultItemDto {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.participantId === 'string'
    && typeof item.status === 'string'
    && (STATUSES as readonly string[]).includes(item.status)
    && (item.reason === undefined || item.reason === null || typeof item.reason === 'string')
  )
}

function isResultBody(value: unknown): value is RosterEmailResultDto {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return Array.isArray(body.results) && body.results.every(isResultItem)
}

/** The request body for `ids`: `{}` for none, else `{ participantIds }`. Throws when unusable. */
export function emailLinksBody(ids: readonly string[]): RosterEmailLinksBody {
  if (ids.length === 0) return {}
  const usable = usableIds(ids)
  // A non-empty input with nothing usable in it is NOT "everyone": refuse, send nothing.
  if (usable.length === 0) throw new EmailLinksError('badRequest')
  if (usable.length > MAX_EMAILS_PER_REQUEST) throw new EmailLinksError('tooMany')
  return { participantIds: usable }
}

/**
 * Emails each listed participant their own personal sign-in link (empty = every
 * eligible participant). Resolves with one result per participant considered; a
 * per-person failure is a `failed` result, not a thrown error. Throws
 * `EmailLinksError` when the request itself is refused or fails.
 */
export async function sendEmailLinks(ids: readonly string[]): Promise<RosterEmailResultDto> {
  const body = emailLinksBody(ids)

  let data: unknown
  try {
    const response = await api.post<unknown>(EMAIL_LINKS_ENDPOINT, body, {
      ...(USE_MOCK_EMAIL_LINKS ? { adapter: mockEmailLinksAdapter } : {}),
    })
    data = response.data
  } catch (error) {
    throw toEmailLinksError(error)
  }

  if (!isResultBody(data)) throw new EmailLinksError('malformed')
  return {
    results: data.results.map(item => ({
      participantId: item.participantId,
      status: item.status,
      ...(typeof item.reason === 'string' ? { reason: item.reason } : {}),
    })),
  }
}
