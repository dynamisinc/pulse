/**
 * features/participantAdmin/services/rosterService.ts
 * ---------------------------------------------------------------------------
 * The staff ROSTER data seam (feature: easy-login, story 10; COR-011, COR-017,
 * COR-018). Consumes the FROZEN contract in
 * docs/features/easy-login/implementation.md:
 *
 *   GET  /api/staff/roster                         -> 200 RosterListDto       | 401 | 403
 *   POST /api/staff/roster            RosterRowWrite -> 201 RosterEntryDto    | 400 | 409
 *   POST /api/staff/roster/import?dryRun=true|false
 *        multipart `file` (CSV, 1 MB, 5000 rows)   -> 200 RosterImportResultDto | 400
 *   POST /api/staff/roster/{id}/link/reissue       -> 200 RosterActionResultDto | 404
 *   POST /api/staff/roster/{id}/link/revoke        -> 200 RosterActionResultDto | 404
 *   POST /api/staff/roster/{id}/disable            -> 200 RosterActionResultDto | 404
 *   POST /api/staff/roster/{id}/enable             -> 200 RosterActionResultDto | 404
 *
 * Staff routes need a live staff session assigned to the active exercise AND
 * holding `controller` or `planner` there (EL-13): 401 no session, 403 wrong
 * role. 400/404/409 bodies are ProblemDetails with a readable `detail`.
 *
 * ## No exercise id, ever (COR-001, XC-001)
 * NO request here carries an exercise id. The server scopes everything from the
 * staff session, and a cross-exercise participant id is indistinguishable from
 * an unknown one (404). The `{id}` in an action path is a participant (account)
 * id taken from the LIST RESPONSE and nowhere else.
 *
 * ## Mock-first, one flip point
 * Every request goes through the shared axios client (`@/core/services/api`) so
 * the method, URL, params and multipart body are exactly the live call's. When
 * `USE_MOCK_DATA` is on, each call carries the stateful mock adapter
 * (`../mocks/rosterMocks`) as a per-request `adapter`; with it off the SAME code
 * hits the live endpoints unchanged. Model: `planner/services/accountImportService`.
 *
 * ## Runtime guards (fail closed)
 * Every response is parsed, not cast. An out-of-shape body throws a `RosterError`
 * instead of rendering garbage — this is a live endpoint the day the mock flips.
 * Parsing is tolerant in exactly one way: an optional field sent as `null` is
 * treated as absent (the contract says "omitted, never null"; a serializer that
 * disagrees should not blank the whole roster).
 *
 * ## Secrets
 * `link.joinUrl` is passed through to the caller untouched and never logged,
 * stringified into an error message, or echoed anywhere here.
 *
 * World: STAFF. Pure data/service module — no UI, no COBRA. Instants are real
 * wall-clock (the scenario-time rule, COR-053, binds the participant world).
 */

import axios from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { rosterMockAdapter } from '../mocks/rosterMocks'
import type {
  RosterActionKind,
  RosterActionResultDto,
  RosterEntryDto,
  RosterImportResultDto,
  RosterImportRowDto,
  RosterLinkDto,
  RosterListDto,
  RosterPersonaDto,
  RosterRowStatus,
  RosterRowWrite,
} from '../types'

/** The roster collection, relative to the shared client's `/api` base URL. */
export const ROSTER_ENDPOINT = '/staff/roster'

/** The multipart file-part name the import endpoint expects (frozen: `file`). */
export const ROSTER_IMPORT_FILE_PART = 'file'

/** Max accepted upload size — mirrors the server's 1 MB limit. */
export const MAX_ROSTER_IMPORT_BYTES = 1024 * 1024

/** `accept` attribute for the file picker. */
export const ROSTER_IMPORT_ACCEPT = '.csv,text/csv'

/** The CSV template header (frozen contract); the template is a client-generated string. */
export const ROSTER_CSV_TEMPLATE_HEADER = 'name,agency,role,email,personaHandle,signInName'

/** The single mock/live flip point (see the module header). */
const USE_MOCK_ROSTER = USE_MOCK_DATA

function mockOptions(): { adapter?: typeof rosterMockAdapter } {
  return USE_MOCK_ROSTER ? { adapter: rosterMockAdapter } : {}
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export interface RosterErrorInit {
  readonly status?: number
  readonly serverMessage?: string
  readonly cause?: unknown
}

/**
 * A transport-agnostic error so components can render status-aware feedback
 * without touching axios. `status` is the HTTP status when the server answered
 * (401/403/400/404/409…), or `undefined` when no response arrived (network).
 * `serverMessage` is the server's own readable reason (ProblemDetails `detail`).
 */
export class RosterError extends Error {
  readonly status?: number
  readonly serverMessage?: string

  constructor(message: string, init: RosterErrorInit = {}) {
    super(message)
    this.name = 'RosterError'
    this.status = init.status
    this.serverMessage = init.serverMessage
    if (init.cause !== undefined) {
      this.cause = init.cause
    }
  }
}

/** True for the "you may not use the roster" answers (no session / wrong role). */
export function isRosterAccessDenied(error: unknown): boolean {
  return error instanceof RosterError && (error.status === 401 || error.status === 403)
}

function firstText(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim()
  }
  return undefined
}

/** Pulls a readable reason off a ProblemDetails / plain-string error body. */
function extractServerMessage(data: unknown): string | undefined {
  if (typeof data === 'string') return firstText(data)
  if (typeof data !== 'object' || data === null) return undefined
  const body = data as Record<string, unknown>

  // ASP.NET ValidationProblemDetails: { errors: { Field: ['reason', …] } }.
  if (typeof body.errors === 'object' && body.errors !== null) {
    for (const messages of Object.values(body.errors as Record<string, unknown>)) {
      if (Array.isArray(messages)) {
        const first = firstText(...messages)
        if (first !== undefined) return first
      }
    }
  }
  return firstText(body.detail, body.message, body.title, body.error)
}

function toRosterError(error: unknown, fallback: string): RosterError {
  if (error instanceof RosterError) return error
  if (axios.isAxiosError(error)) {
    return new RosterError(error.message, {
      status: error.response?.status,
      serverMessage: extractServerMessage(error.response?.data),
      cause: error,
    })
  }
  if (error instanceof Error) return new RosterError(error.message, { cause: error })
  return new RosterError(fallback, { cause: error })
}

// ---------------------------------------------------------------------------
// Guards (parse, don't cast)
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `undefined`/`null` -> absent; a string -> itself; anything else -> invalid. */
function optString(value: unknown): { ok: true, value: string | undefined } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: undefined }
  return typeof value === 'string' ? { ok: true, value } : { ok: false }
}

function parsePersona(value: unknown): RosterPersonaDto | undefined {
  if (!isRec(value)) return undefined
  if (
    typeof value.id !== 'string'
    || typeof value.handle !== 'string'
    || typeof value.displayName !== 'string'
    || (value.kind !== 'human' && value.kind !== 'org')
    || typeof value.autoCreated !== 'boolean'
  ) return undefined
  return {
    id: value.id,
    handle: value.handle,
    displayName: value.displayName,
    kind: value.kind,
    autoCreated: value.autoCreated,
  }
}

function parseLink(value: unknown): RosterLinkDto | undefined {
  if (!isRec(value)) return undefined
  if (value.status !== 'active' && value.status !== 'revoked' && value.status !== 'none') {
    return undefined
  }
  if (typeof value.useCount !== 'number') return undefined
  const issuedAt = optString(value.issuedAt)
  const revokedAt = optString(value.revokedAt)
  const lastUsedAt = optString(value.lastUsedAt)
  const joinUrl = optString(value.joinUrl)
  if (!issuedAt.ok || !revokedAt.ok || !lastUsedAt.ok || !joinUrl.ok) return undefined
  const needsReissue = value.needsReissue
  if (needsReissue !== undefined && needsReissue !== null && typeof needsReissue !== 'boolean') {
    return undefined
  }
  return {
    status: value.status,
    useCount: value.useCount,
    ...(issuedAt.value !== undefined ? { issuedAt: issuedAt.value } : {}),
    ...(revokedAt.value !== undefined ? { revokedAt: revokedAt.value } : {}),
    ...(lastUsedAt.value !== undefined ? { lastUsedAt: lastUsedAt.value } : {}),
    ...(joinUrl.value !== undefined ? { joinUrl: joinUrl.value } : {}),
    ...(needsReissue === true ? { needsReissue: true } : {}),
  }
}

function parseEntry(value: unknown): RosterEntryDto | undefined {
  if (!isRec(value)) return undefined
  if (
    typeof value.id !== 'string' || value.id.length === 0
    || typeof value.name !== 'string'
    || typeof value.signInName !== 'string'
    || (value.exerciseRole !== 'participant' && value.exerciseRole !== 'pio')
    || (value.access !== 'enabled' && value.access !== 'disabled')
    || typeof value.liveSessions !== 'number'
    || typeof value.createdAt !== 'string'
  ) return undefined

  const agency = optString(value.agency)
  const role = optString(value.role)
  const email = optString(value.email)
  const lastSignInAt = optString(value.lastSignInAt)
  if (!agency.ok || !role.ok || !email.ok || !lastSignInAt.ok) return undefined

  const link = parseLink(value.link)
  if (link === undefined) return undefined

  let persona: RosterPersonaDto | undefined
  if (value.persona !== undefined && value.persona !== null) {
    persona = parsePersona(value.persona)
    if (persona === undefined) return undefined
  }

  return {
    id: value.id,
    name: value.name,
    ...(agency.value !== undefined ? { agency: agency.value } : {}),
    ...(role.value !== undefined ? { role: role.value } : {}),
    ...(email.value !== undefined ? { email: email.value } : {}),
    signInName: value.signInName,
    exerciseRole: value.exerciseRole,
    ...(persona !== undefined ? { persona } : {}),
    link,
    access: value.access,
    liveSessions: value.liveSessions,
    ...(lastSignInAt.value !== undefined ? { lastSignInAt: lastSignInAt.value } : {}),
    createdAt: value.createdAt,
  }
}

function parseList(value: unknown): RosterListDto | undefined {
  if (!isRec(value) || !Array.isArray(value.participants)) return undefined
  if (typeof value.joinLinksAvailable !== 'boolean') return undefined
  const capabilities = value.capabilities
  if (!isRec(capabilities) || typeof capabilities.emailLinks !== 'boolean') return undefined

  const participants: RosterEntryDto[] = []
  for (const raw of value.participants) {
    const entry = parseEntry(raw)
    if (entry === undefined) return undefined
    participants.push(entry)
  }
  return {
    participants,
    joinLinksAvailable: value.joinLinksAvailable,
    capabilities: { emailLinks: capabilities.emailLinks },
  }
}

const ROW_STATUSES: readonly RosterRowStatus[] = ['created', 'updated', 'unchanged', 'failed']

function parseImportRow(value: unknown): RosterImportRowDto | undefined {
  if (!isRec(value)) return undefined
  if (
    typeof value.rowNumber !== 'number'
    || typeof value.name !== 'string'
    || typeof value.status !== 'string'
    || !(ROW_STATUSES as readonly string[]).includes(value.status)
    || typeof value.personaCreated !== 'boolean'
  ) return undefined
  const signInName = optString(value.signInName)
  const personaHandle = optString(value.personaHandle)
  const message = optString(value.message)
  if (!signInName.ok || !personaHandle.ok || !message.ok) return undefined
  return {
    rowNumber: value.rowNumber,
    name: value.name,
    ...(signInName.value !== undefined ? { signInName: signInName.value } : {}),
    status: value.status as RosterRowStatus,
    ...(personaHandle.value !== undefined ? { personaHandle: personaHandle.value } : {}),
    personaCreated: value.personaCreated,
    ...(message.value !== undefined ? { message: message.value } : {}),
  }
}

function parseImportResult(value: unknown): RosterImportResultDto | undefined {
  if (!isRec(value) || !Array.isArray(value.rows)) return undefined
  if (
    typeof value.dryRun !== 'boolean'
    || typeof value.totalRows !== 'number'
    || typeof value.createdCount !== 'number'
    || typeof value.updatedCount !== 'number'
    || typeof value.unchangedCount !== 'number'
    || typeof value.failedCount !== 'number'
  ) return undefined
  const rows: RosterImportRowDto[] = []
  for (const raw of value.rows) {
    const row = parseImportRow(raw)
    if (row === undefined) return undefined
    rows.push(row)
  }
  return {
    dryRun: value.dryRun,
    totalRows: value.totalRows,
    createdCount: value.createdCount,
    updatedCount: value.updatedCount,
    unchangedCount: value.unchangedCount,
    failedCount: value.failedCount,
    rows,
  }
}

/**
 * Parses an action result and fails closed unless it is ABOUT the participant that
 * was asked for: a result for someone else would announce the wrong person's name
 * and sessionsEnded count.
 */
function parseActionResult(
  value: unknown,
  requestedId: string,
): RosterActionResultDto | undefined {
  if (!isRec(value)) return undefined
  if (
    typeof value.participantId !== 'string'
    || value.participantId !== requestedId
    || (value.access !== 'enabled' && value.access !== 'disabled')
    || typeof value.sessionsEnded !== 'number'
  ) return undefined
  const link = parseLink(value.link)
  if (link === undefined) return undefined
  return {
    participantId: value.participantId,
    link,
    access: value.access,
    sessionsEnded: value.sessionsEnded,
  }
}

// ---------------------------------------------------------------------------
// Secrets: the join URL is read from the LIST only
// ---------------------------------------------------------------------------

/**
 * `link.joinUrl` is a bearer credential. The roster list is the one place it may
 * live in client state (query data, `staleTime: 0`, a short `gcTime`). The add and
 * action responses also carry it, but nothing needs it from there (the list is
 * refetched straight after), and a mutation result sits in React Query's mutation
 * cache — a second, separately-timed cache — so it is dropped HERE, at the seam,
 * before any caller or cache can hold it.
 */
function withoutJoinUrl<T extends { link: RosterLinkDto }>(value: T): T {
  if (value.link.joinUrl === undefined) return value
  const link = { ...value.link }
  delete link.joinUrl
  return { ...value, link }
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

/**
 * Runs one request, maps any transport failure to a `RosterError`, and parses
 * the body with `parse` (failing closed when it is out of shape).
 */
async function call<T>(
  what: string,
  send: () => Promise<{ data: unknown }>,
  parse: (data: unknown) => T | undefined,
): Promise<T> {
  let data: unknown
  try {
    data = (await send()).data
  } catch (error) {
    throw toRosterError(error, `${what} failed.`)
  }
  const parsed = parse(data)
  if (parsed === undefined) {
    throw new RosterError(`${what}: the response was empty or malformed.`)
  }
  return parsed
}

/** `GET /api/staff/roster` — everyone on the active exercise's roster. */
export function getRoster(): Promise<RosterListDto> {
  return call('Loading the roster', () => api.get<unknown>(ROSTER_ENDPOINT, mockOptions()), parseList)
}

/** Drops blank optional fields so the server takes its "derive it" path, not `""`. */
function toWireRow(row: RosterRowWrite): RosterRowWrite {
  const clean = (value: string | undefined): string | undefined => {
    const trimmed = value?.trim()
    return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined
  }
  const agency = clean(row.agency)
  const role = clean(row.role)
  const email = clean(row.email)
  const personaHandle = clean(row.personaHandle)
  const signInName = clean(row.signInName)
  return {
    name: row.name.trim(),
    ...(agency !== undefined ? { agency } : {}),
    ...(role !== undefined ? { role } : {}),
    ...(email !== undefined ? { email } : {}),
    ...(personaHandle !== undefined ? { personaHandle } : {}),
    ...(signInName !== undefined ? { signInName } : {}),
  }
}

/**
 * `POST /api/staff/roster` — add one participant. 400 invalid field, 409 already
 * on the roster. The returned row has NO `link.joinUrl` (see {@link withoutJoinUrl});
 * the new person's link is read from the refetched list.
 */
export function addParticipant(row: RosterRowWrite): Promise<RosterEntryDto> {
  return call(
    'Adding the participant',
    () => api.post<unknown>(ROSTER_ENDPOINT, toWireRow(row), mockOptions()),
    value => {
      const entry = parseEntry(value)
      return entry === undefined ? undefined : withoutJoinUrl(entry)
    },
  )
}

/**
 * `POST /api/staff/roster/import?dryRun=…` — upload a CSV. `dryRun: true`
 * validates and reports per row but writes NOTHING; `dryRun: false` applies the
 * valid rows. The file is sent as `multipart/form-data` with the single `file`
 * part; the content type is set explicitly so the client's JSON default cannot
 * serialize the FormData.
 *
 * Fails closed if the server's echoed `dryRun` is not the one requested: a
 * "validated, nothing written" answer to a real import (or the reverse) would
 * leave staff believing the wrong thing about the roster.
 */
export async function importRoster(
  file: File,
  options: { readonly dryRun: boolean },
): Promise<RosterImportResultDto> {
  const form = new FormData()
  form.append(ROSTER_IMPORT_FILE_PART, file)
  const what = options.dryRun ? 'Validating the file' : 'Importing the file'
  const result = await call(
    what,
    () => api.post<unknown>(`${ROSTER_ENDPOINT}/import`, form, {
      params: { dryRun: options.dryRun },
      headers: { 'Content-Type': 'multipart/form-data' },
      ...mockOptions(),
    }),
    parseImportResult,
  )
  if (result.dryRun !== options.dryRun) {
    throw new RosterError(
      `${what}: the server answered for ${result.dryRun ? 'a dry run' : 'a real import'},`
      + ' not the one requested.',
    )
  }
  return result
}

const ACTION_SEGMENT: Readonly<Record<RosterActionKind, string>> = {
  reissue: 'link/reissue',
  revoke: 'link/revoke',
  disable: 'disable',
  enable: 'enable',
}

const ACTION_LABEL: Readonly<Record<RosterActionKind, string>> = {
  reissue: 'Reissuing the link',
  revoke: 'Revoking the link',
  disable: 'Disabling the participant',
  enable: 'Enabling the participant',
}

/**
 * Runs one per-participant action: `POST /api/staff/roster/{id}/…`. `id` is the
 * participant's account id from the list response. Reissue, revoke and disable
 * end the participant's live sessions; the result reports `sessionsEnded`. The
 * result must be about the requested participant, and carries NO `link.joinUrl`
 * (see {@link withoutJoinUrl}).
 */
export function runRosterAction(
  kind: RosterActionKind,
  participantId: string,
): Promise<RosterActionResultDto> {
  const path = `${ROSTER_ENDPOINT}/${encodeURIComponent(participantId)}/${ACTION_SEGMENT[kind]}`
  return call(
    ACTION_LABEL[kind],
    () => api.post<unknown>(path, undefined, mockOptions()),
    value => {
      const result = parseActionResult(value, participantId)
      return result === undefined ? undefined : withoutJoinUrl(result)
    },
  )
}

/** `POST /staff/roster/{id}/link/reissue` — a new link; the old one stops working. */
export const reissueLink = (participantId: string) => runRosterAction('reissue', participantId)
/** `POST /staff/roster/{id}/link/revoke` — the link stops working. */
export const revokeLink = (participantId: string) => runRosterAction('revoke', participantId)
/** `POST /staff/roster/{id}/disable` — the person-level revoke (link, word and password). */
export const disableParticipant = (participantId: string) => runRosterAction('disable', participantId)
/** `POST /staff/roster/{id}/enable` — undo a disable. */
export const enableParticipant = (participantId: string) => runRosterAction('enable', participantId)
