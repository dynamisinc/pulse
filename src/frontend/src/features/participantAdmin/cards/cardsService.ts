/**
 * features/participantAdmin/cards/cardsService.ts
 * ---------------------------------------------------------------------------
 * The data seam for the printable card sheet (feature: easy-login, story 12; COR-017
 * in part). Consumes the FROZEN backend contract (docs/features/easy-login/
 * implementation.md):
 *
 *   POST /api/staff/roster/cards          (EL-20; it was a GET with repeated `?id=`)
 *     body `{ participantIds: string[] }` (1 to 500 ids)  or  `{ all: true }`:
 *     exactly one of the two. Both, neither, an empty array, more than 500 ids or an
 *     unknown property is a 400. Body limit 64 KiB.
 *   200 -> RosterCardsDto { exerciseName, cards[], skipped[] }
 *   400 -> a body the server refuses   409 -> join base URL not configured
 *   401 -> no staff session            403 -> not assigned / wrong role (controller|planner)
 *
 * NO EXERCISE ID IS EVER SENT (COR-001): the server scopes everything. A participant id
 * from another exercise comes back as an ordinary `notFound` skip, indistinguishable from
 * an unknown id.
 *
 * CHUNKING. The server rejects more than 500 ids, so a larger selection is split into
 * requests of at most {@link MAX_CARDS_PER_REQUEST} ids, each `{ participantIds: chunk }`,
 * sent one after the other; the `cards` and `skipped` of every response are concatenated in
 * request order. When more than one request was needed the merged cards are re-sorted by
 * name, because each response is only ordered within itself and a hand-out sheet should
 * read A to Z. An EMPTY input is ONE request with the explicit body `{ all: true }`
 * ("every eligible participant"): that is the only way to ask for everyone, and an empty
 * `participantIds` array is never sent (the server refuses it). A NON-empty input is
 * de-duplicated and stripped of blank ids first (first occurrence wins); if nothing usable
 * is left it is refused as a `badRequest` with NO request made, never widened to everyone.
 *
 * CANCELLATION. React Query hands the query function an `AbortSignal` that fires when the
 * preview closes mid-load. It is passed to every request (so axios aborts the one in
 * flight) and checked before each next chunk, so closing the preview stops the remaining
 * requests instead of fetching a thousand credentials nobody will see.
 *
 * WIRE FORMAT. Ids travel in a JSON body, never in the URL: 500 GUIDs in a query string
 * (about 20 KB) exceed the server's 8 KB request line (a 414 above roughly 203 ids), and an
 * array spelling the server did not recognise (`?id[]=`) silently widened the request to
 * every participant. A strict body makes "everyone" an explicit choice. No `id=` query
 * parameter is ever sent; `cardsService.test.ts` asserts the real serialized request.
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
import { usableIds } from './cardFormat'
import { mockCardsAdapter } from './cardsMocks'
import type {
  RosterCardDto,
  RosterCardSkipReason,
  RosterCardSkippedDto,
  RosterCardsDto,
  RosterCardsRequest,
} from './types'

/** The cards endpoint, relative to the shared client's `/api` base URL. */
export const CARDS_ENDPOINT = '/staff/roster/cards'

/** The server's `MaxCardsPerRequest`: the most ids one request body may carry. */
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
 *   badRequest     400: the server refused the request (e.g. too many ids), or the input
 *                  held no usable id at all (refused here, nothing sent).
 *   malformed      200, but the body is not the frozen shape.
 *   cancelled      the request was aborted (the preview closed mid-load).
 *   unavailable    anything else: network failure, 5xx.
 */
export type RosterCardsErrorKind =
  | 'notConfigured'
  | 'forbidden'
  | 'unauthorized'
  | 'badRequest'
  | 'malformed'
  | 'cancelled'
  | 'unavailable'

/** Fixed, secret-free messages (they may end up in a log; they never carry a body). */
const ERROR_MESSAGES: Readonly<Record<RosterCardsErrorKind, string>> = {
  notConfigured: 'Personal links are not configured on this server.',
  forbidden: 'This account is not allowed to print cards.',
  unauthorized: 'The staff session has ended.',
  badRequest: 'The server could not accept the card request.',
  malformed: 'The card response was empty or malformed.',
  cancelled: 'The card request was cancelled.',
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
    // 413: the server's 64 KiB body limit. Unreachable with roster GUIDs (500 x ~39 B), but it is
    // a refusal of what we sent, never an outage.
    case 413: return 'badRequest'
    case 401: return 'unauthorized'
    case 403: return 'forbidden'
    case 409: return 'notConfigured'
    default: return 'unavailable'
  }
}

/** Translates any thrown transport failure into a `RosterCardsError` (and drops the cause). */
function toCardsError(error: unknown): RosterCardsError {
  if (error instanceof RosterCardsError) return error
  if (axios.isCancel(error)) return new RosterCardsError('cancelled')
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

/** Splits `ids` into runs of at most `size` (an empty list gives no chunks). */
export function chunkIds(ids: readonly string[], size: number = MAX_CARDS_PER_REQUEST): string[][] {
  const chunks: string[][] = []
  for (let start = 0; start < ids.length; start += size) {
    chunks.push(ids.slice(start, start + size))
  }
  return chunks
}

/** One request. The body is `{ all: true }` or `{ participantIds }`, never anything else. */
async function fetchChunk(
  body: RosterCardsRequest,
  signal: AbortSignal | undefined,
): Promise<RosterCardsDto> {
  let data: unknown
  try {
    const response = await api.post<unknown>(CARDS_ENDPOINT, body, {
      ...(signal !== undefined ? { signal } : {}),
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

/** Throws the `cancelled` error when `signal` has fired. Checked before every request. */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new RosterCardsError('cancelled')
}

/** A-to-Z by name, case- and accent-insensitive, numbers in order; ties keep request order. */
const NAME_COLLATOR = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

/**
 * Fetches the printable cards for `ids`. An empty `ids` means every eligible participant
 * (sent as `{ all: true }`, and the ONLY thing that does). Otherwise the ids are cleaned,
 * split into requests of at most 500 and merged: cards and skipped entries in request
 * order, and the cards re-sorted by name when more than one request was needed. `signal`
 * (React Query's) stops the remaining requests when it fires.
 *
 * Throws `RosterCardsError` on any failure; one failed chunk fails the whole sheet (a
 * half sheet handed out as a whole one is worse than an error).
 */
export async function fetchRosterCards(
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<RosterCardsDto> {
  throwIfAborted(signal)
  if (ids.length === 0) return fetchChunk({ all: true }, signal)

  const chunks = chunkIds(usableIds(ids))
  // A non-empty input with nothing usable in it is NOT "everyone": refuse, send nothing.
  if (chunks.length === 0) throw new RosterCardsError('badRequest')

  let result: RosterCardsDto | undefined
  for (const chunk of chunks) {
    throwIfAborted(signal)
    const part = await fetchChunk({ participantIds: chunk }, signal)
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
  if (chunks.length > 1) {
    result = {
      ...result,
      cards: [...result.cards].sort((a, b) => NAME_COLLATOR.compare(a.name, b.name)),
    }
  }
  return result
}
