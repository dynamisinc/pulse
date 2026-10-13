/**
 * features/participantAdmin/cards/cardsService.ts
 * ---------------------------------------------------------------------------
 * The data seam for the printable card sheet (feature: easy-login, story 12; COR-017
 * in part). Consumes the FROZEN backend contract (docs/features/easy-login/
 * implementation.md):
 *
 *   GET /api/staff/roster/cards?id={id}&id={id}...
 *     repeated optional `id` (none = every eligible participant); at most 500 per request.
 *   200 -> RosterCardsDto { exerciseName, cards[], skipped[] }
 *   400 -> more than 500 ids      409 -> join base URL not configured
 *   401 -> no staff session       403 -> not assigned / wrong role (controller|planner only)
 *
 * NO EXERCISE ID IS EVER SENT (COR-001): the server scopes everything. A participant id
 * from another exercise comes back as an ordinary `notFound` skip, indistinguishable from
 * an unknown id.
 *
 * CHUNKING. The server rejects more than 500 ids, so a larger selection is split into
 * requests of at most {@link MAX_CARDS_PER_REQUEST} ids, sent one after the other, and
 * the `cards` and `skipped` of every response are concatenated in request order. An empty
 * selection is ONE request with no `id` at all ("every eligible participant"). The ids are
 * de-duplicated first (first occurrence wins) so a repeated id cannot be sent twice.
 *
 * WIRE FORMAT. Axios serializes an array param as `id[]=a&id[]=b` by default; the server
 * binds repeated plain `id=a&id=b`. `paramsSerializer: { indexes: null }` produces exactly
 * that, and `cardsService.test.ts` asserts the resulting query string.
 *
 * MOCK SEAM (mirrors `features/planner/services/accountImportService.ts`): every request
 * goes through the shared axios client (`@/core/services/api`), so URL, base URL, headers
 * and the staff Authorization header are exactly the live ones. The mock adapter is
 * swapped in at ONE env-guarded flip point (`USE_MOCK_CARDS = USE_MOCK_DATA`), never per
 * call; a deploy that omits the flag fails closed to the live endpoint (COR-001).
 *
 * SECRETS. A response carries bearer credentials (`joinUrl`, and the QR that encodes it).
 * This module never logs, stores or echoes them. Errors carry a fixed message and a kind
 * only: no response body, no request config (which would hold the Authorization header)
 * and no `cause`.
 *
 * RUNTIME GUARDS. An out-of-shape success body fails closed (a thrown `malformed` error)
 * instead of being cast into `RosterCardsDto`, so a contract drift shows up as a clear
 * message rather than a half-rendered sheet. The QR string is checked for SHAPE only
 * here (it must be a string); whether it may reach an `<img src>` is decided where it
 * is rendered, by `safeQrDataUri.ts`, so a bad QR degrades one card and not the batch.
 *
 * World: STAFF. Pure data module: no UI, no COBRA.
 */

import axios from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { mockCardsAdapter } from './cardsMocks'
import type {
  RosterCardDto,
  RosterCardSkipReason,
  RosterCardSkippedDto,
  RosterCardsDto,
} from './types'

/** The cards endpoint, relative to the shared client's `/api` base URL. */
export const CARDS_ENDPOINT = '/staff/roster/cards'

/** The server's `MaxCardsPerRequest`: the most `id`s one request may carry. */
export const MAX_CARDS_PER_REQUEST = 500

/** The SINGLE mock/live flip point. Mock in dev/test; the live endpoint otherwise. */
const USE_MOCK_CARDS = USE_MOCK_DATA

/** The four skip reasons, for the runtime guard. */
const SKIP_REASONS: readonly RosterCardSkipReason[] = [
  'notFound',
  'noActiveLink',
  'disabled',
  'tokenUnrecoverable',
]

/**
 * What went wrong, in the terms the preview needs to choose its message.
 *   notConfigured  409: the server has no join base URL (`Authentication:FrontendBaseUrl`).
 *   forbidden      403: signed in as staff, but not allowed to print cards.
 *   unauthorized   401: no staff session (the shared client already tried one refresh).
 *   badRequest     400: the server refused the request (e.g. too many ids).
 *   malformed      200, but the body is not the frozen shape.
 *   unavailable    anything else: network failure, 5xx.
 */
export type RosterCardsErrorKind =
  | 'notConfigured'
  | 'forbidden'
  | 'unauthorized'
  | 'badRequest'
  | 'malformed'
  | 'unavailable'

/** Fixed, secret-free messages (they may end up in a log; they never carry a body). */
const ERROR_MESSAGES: Readonly<Record<RosterCardsErrorKind, string>> = {
  notConfigured: 'Personal links are not configured on this server.',
  forbidden: 'This account is not allowed to print cards.',
  unauthorized: 'The staff session has ended.',
  badRequest: 'The server could not accept the card request.',
  malformed: 'The card response was empty or malformed.',
  unavailable: 'The cards could not be loaded.',
}

/** A transport-agnostic error so the preview can pick its copy without touching axios. */
export class RosterCardsError extends Error {
  readonly kind: RosterCardsErrorKind
  /** The HTTP status, when the server answered. */
  readonly status?: number

  constructor(kind: RosterCardsErrorKind, status?: number) {
    super(ERROR_MESSAGES[kind])
    this.name = 'RosterCardsError'
    this.kind = kind
    this.status = status
  }
}

function kindForStatus(status: number | undefined): RosterCardsErrorKind {
  switch (status) {
    case 400: return 'badRequest'
    case 401: return 'unauthorized'
    case 403: return 'forbidden'
    case 409: return 'notConfigured'
    default: return 'unavailable'
  }
}

/** Translates any thrown transport failure into a `RosterCardsError` (and drops the cause). */
function toCardsError(error: unknown): RosterCardsError {
  if (error instanceof RosterCardsError) return error
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    return new RosterCardsError(kindForStatus(status), status)
  }
  return new RosterCardsError('unavailable')
}

// ---------------------------------------------------------------- guards

function isOptionalString(value: unknown): value is string | undefined | null {
  return value === undefined || value === null || typeof value === 'string'
}

function isCardBody(value: unknown): value is RosterCardDto {
  if (typeof value !== 'object' || value === null) return false
  const card = value as Record<string, unknown>
  return (
    typeof card.participantId === 'string' &&
    typeof card.name === 'string' &&
    typeof card.signInName === 'string' &&
    typeof card.joinUrl === 'string' &&
    card.joinUrl.length > 0 &&
    typeof card.qrSvgDataUri === 'string' &&
    isOptionalString(card.agency) &&
    isOptionalString(card.role)
  )
}

function isSkipReason(value: unknown): value is RosterCardSkipReason {
  return typeof value === 'string' && (SKIP_REASONS as readonly string[]).includes(value)
}

function isSkippedBody(value: unknown): value is RosterCardSkippedDto {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.participantId === 'string' && isSkipReason(entry.reason)
}

function isCardsBody(value: unknown): value is RosterCardsDto {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return (
    typeof body.exerciseName === 'string' &&
    Array.isArray(body.cards) &&
    body.cards.every(isCardBody) &&
    Array.isArray(body.skipped) &&
    body.skipped.every(isSkippedBody)
  )
}

/** A fresh, clean card (only known fields; a `null` optional becomes absent). */
function toCard(card: RosterCardDto): RosterCardDto {
  return {
    participantId: card.participantId,
    name: card.name,
    ...(card.agency ? { agency: card.agency } : {}),
    ...(card.role ? { role: card.role } : {}),
    signInName: card.signInName,
    joinUrl: card.joinUrl,
    qrSvgDataUri: card.qrSvgDataUri,
  }
}

// ---------------------------------------------------------------- requests

/** Unique ids, first occurrence wins, blanks dropped. */
function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(id => id.length > 0))]
}

/** Splits `ids` into runs of at most `size` (an empty list gives no chunks). */
export function chunkIds(ids: readonly string[], size: number = MAX_CARDS_PER_REQUEST): string[][] {
  const chunks: string[][] = []
  for (let start = 0; start < ids.length; start += size) {
    chunks.push(ids.slice(start, start + size))
  }
  return chunks
}

/** One request. `ids` empty = no `id` param at all (every eligible participant). */
async function fetchChunk(ids: readonly string[]): Promise<RosterCardsDto> {
  let data: unknown
  try {
    const response = await api.get<unknown>(CARDS_ENDPOINT, {
      ...(ids.length > 0
        ? { params: { id: ids }, paramsSerializer: { indexes: null } }
        : {}),
      ...(USE_MOCK_CARDS ? { adapter: mockCardsAdapter } : {}),
    })
    data = response.data
  } catch (error) {
    throw toCardsError(error)
  }
  if (!isCardsBody(data)) throw new RosterCardsError('malformed')
  return {
    exerciseName: data.exerciseName,
    cards: data.cards.map(toCard),
    skipped: data.skipped.map(entry => ({
      participantId: entry.participantId,
      reason: entry.reason,
    })),
  }
}

/**
 * Fetches the printable cards for `ids` (an empty list means every eligible participant).
 * Splits into requests of at most 500 and concatenates the results in request order.
 * Throws `RosterCardsError` on any failure; one failed chunk fails the whole sheet (a
 * half sheet handed out as a whole one is worse than an error).
 */
export async function fetchRosterCards(ids: readonly string[]): Promise<RosterCardsDto> {
  const chunks = chunkIds(uniqueIds(ids))
  if (chunks.length === 0) return fetchChunk([])

  let result: RosterCardsDto | undefined
  for (const chunk of chunks) {
    const part = await fetchChunk(chunk)
    result = result === undefined
      ? part
      : {
        exerciseName: result.exerciseName,
        cards: [...result.cards, ...part.cards],
        skipped: [...result.skipped, ...part.skipped],
      }
  }
  // `chunks` is non-empty here, so `result` is always set; guard instead of `!`.
  if (result === undefined) throw new RosterCardsError('unavailable')
  return result
}
