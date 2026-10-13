/**
 * features/participantAdmin/mocks/rosterMocks.ts
 * ---------------------------------------------------------------------------
 * The MOCK BACKEND for the staff roster screen (feature: easy-login, story 10).
 * It is an axios adapter that answers every `/staff/roster…` call the screen
 * makes by following the FROZEN wire contract in
 * docs/features/easy-login/implementation.md, so the whole screen runs and is
 * tested with no backend, and flips to the live API with no consumer change.
 *
 * `rosterService.ts` is the ONLY importer, and only uses it when
 * `USE_MOCK_DATA` is on (`@/core/config/mockData`). Mock data is opt-in by
 * construction (COR-001): a production build that omits `VITE_USE_MOCK_DATA`
 * calls the live endpoints.
 *
 * ## It is STATEFUL, on purpose
 * Add -> list, import -> list, reissue -> list must all show their effect, or
 * the mock would be a silent no-op that still answers 200 (the mock/live drift
 * this repo keeps shipping). State is a module-level store that
 * {@link resetRosterMocks} restores to the seed.
 *
 * ## What it reproduces (the contract, not just the happy path)
 *  - the list, with a mix of every state the screen must render: an org-persona
 *    row, auto-citizen rows, a persona-less legacy row, an active link, a
 *    `needsReissue` row, a `none`-link row, a revoked link, a disabled person,
 *    a never-signed-in person;
 *  - `POST /staff/roster`: 400 (invalid field) and 409 (key already on the
 *    roster), 201 on success;
 *  - `POST /staff/roster/import?dryRun=…`: per-row `created | updated |
 *    unchanged | failed`, idempotent re-upload on the identity key, blank cells
 *    never clearing a stored value, derived sign-in names with collision
 *    suffixes, auto personas, org-persona binding that fails identically for an
 *    unknown handle, and `dryRun=true` writing NOTHING;
 *  - the four actions (reissue, revoke, disable, enable) with `sessionsEnded`,
 *    and a 404 for an unknown id (a cross-exercise id looks exactly the same);
 *  - the 403 switch ({@link setRosterMockAccess}) and the
 *    `joinLinksAvailable: false` switch ({@link setRosterMockJoinLinksAvailable}).
 *
 * ## The derivation + matching rules live HERE too
 * They are the frozen rules the backend (story 02) implements and the screen
 * explains to staff; reproducing them keeps the mock honest. See
 * {@link deriveSignInName} and {@link deriveAutoPersonaHandle}.
 *
 * The join URLs below are FAKE (`pulse.example.test`). A real one is a bearer
 * credential and is never rendered, logged or toasted by the screen.
 *
 * World: STAFF. Pure data module — no UI. DEMO CONFIG, not product copy.
 */

import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import type {
  RosterActionKind,
  RosterActionResultDto,
  RosterEntryDto,
  RosterImportResultDto,
  RosterImportRowDto,
  RosterListDto,
  RosterPersonaDto,
  RosterRowWrite,
} from '../types'

// ---------------------------------------------------------------------------
// Public switches (dev + tests)
// ---------------------------------------------------------------------------

/** The org personas that exist in the mock exercise (the only ones a row may bind). */
export const MOCK_ORG_PERSONAS: readonly { id: string, handle: string, displayName: string }[] = [
  { id: 'mock-persona-fulcoem', handle: 'FulcoEM', displayName: 'Fulco County Emergency Management' },
  { id: 'mock-persona-fulcopio', handle: 'FulcoPIO', displayName: 'City of Fulco Public Information' },
  { id: 'mock-persona-regionhealth', handle: 'RegionalHealth', displayName: 'Regional Health Authority' },
]

/** Whether the mock answers as an allowed staff member or as a forbidden one. */
export type RosterMockAccess = 'allowed' | 'forbidden'

const MOCK_JOIN_BASE = 'https://pulse.example.test/join/'
const MAX_IMPORT_BYTES = 1024 * 1024
const MAX_IMPORT_ROWS = 5000
const SIGN_IN_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'md', 'phd'])

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

function orgPersona(handle: string): RosterPersonaDto {
  const found = MOCK_ORG_PERSONAS.find(persona => persona.handle === handle)
  return {
    id: found?.id ?? `mock-persona-${handle.toLowerCase()}`,
    handle,
    displayName: found?.displayName ?? handle,
    kind: 'org',
    autoCreated: false,
  }
}

function autoPersona(handle: string, displayName: string): RosterPersonaDto {
  return { id: `mock-persona-${handle}`, handle, displayName, kind: 'human', autoCreated: true }
}

/**
 * The seed roster. Fixed instants so tests are deterministic; the mock exercise
 * time zone is `America/New_York` (see `exerciseContextResolver`), so
 * `2026-10-13T13:05:00.000Z` reads "Oct 13, 9:05 AM EDT".
 */
function seedEntries(): RosterEntryDto[] {
  return [
    {
      id: 'mock-acct-001',
      name: 'Dana Whitfield',
      agency: 'Fulco County EM',
      role: 'EOC Liaison',
      email: 'dana.whitfield@example.test',
      signInName: 'dwhitfield',
      exerciseRole: 'pio',
      persona: orgPersona('FulcoEM'),
      link: {
        status: 'active',
        issuedAt: '2026-10-13T12:30:00.000Z',
        lastUsedAt: '2026-10-13T13:05:00.000Z',
        useCount: 2,
        joinUrl: `${MOCK_JOIN_BASE}MOCK-TOKEN-dana-whitfield`,
      },
      access: 'enabled',
      liveSessions: 1,
      lastSignInAt: '2026-10-13T13:05:00.000Z',
      createdAt: '2026-10-13T12:30:00.000Z',
    },
    {
      id: 'mock-acct-002',
      name: 'Marcus Oyelaran',
      agency: 'Fulco County Health',
      role: 'Public Health Officer',
      signInName: 'moyelaran',
      exerciseRole: 'participant',
      persona: autoPersona('marcus_oyelaran', 'Marcus Oyelaran'),
      link: {
        status: 'active',
        issuedAt: '2026-10-13T12:30:00.000Z',
        lastUsedAt: '2026-10-13T12:58:00.000Z',
        useCount: 1,
        joinUrl: `${MOCK_JOIN_BASE}MOCK-TOKEN-marcus-oyelaran`,
      },
      access: 'enabled',
      liveSessions: 2,
      lastSignInAt: '2026-10-13T12:58:00.000Z',
      createdAt: '2026-10-13T12:30:00.000Z',
    },
    {
      // A `none`-link row: provisioned, but no link was ever issued.
      id: 'mock-acct-003',
      name: 'Priya Raman',
      agency: 'Red Cross',
      role: 'Shelter Coordinator',
      signInName: 'praman',
      exerciseRole: 'participant',
      persona: autoPersona('priya_raman', 'Priya Raman'),
      link: { status: 'none', useCount: 0 },
      access: 'enabled',
      liveSessions: 0,
      createdAt: '2026-10-13T12:30:00.000Z',
    },
    {
      // A `needsReissue` row: active, but the stored token cannot be decrypted (EL-5).
      id: 'mock-acct-004',
      name: 'Tom Becker',
      agency: 'County Transportation',
      role: 'Dispatch Supervisor',
      signInName: 'tbecker',
      exerciseRole: 'participant',
      persona: autoPersona('tom_becker', 'Tom Becker'),
      link: {
        status: 'active',
        issuedAt: '2026-10-12T20:10:00.000Z',
        useCount: 0,
        needsReissue: true,
      },
      access: 'enabled',
      liveSessions: 0,
      createdAt: '2026-10-12T20:10:00.000Z',
    },
    {
      id: 'mock-acct-005',
      name: 'Elena Vasquez',
      agency: 'City of Fulco',
      role: 'Public Information Officer',
      signInName: 'evasquez',
      exerciseRole: 'pio',
      persona: orgPersona('FulcoPIO'),
      link: {
        status: 'revoked',
        issuedAt: '2026-10-12T20:10:00.000Z',
        revokedAt: '2026-10-13T11:45:00.000Z',
        lastUsedAt: '2026-10-13T11:20:00.000Z',
        useCount: 3,
      },
      access: 'enabled',
      liveSessions: 0,
      lastSignInAt: '2026-10-13T11:20:00.000Z',
      createdAt: '2026-10-12T20:10:00.000Z',
    },
    {
      // A disabled person with a non-auto human persona (a seeded citizen).
      id: 'mock-acct-006',
      name: 'Jordan Pike',
      agency: 'Fulco Utilities',
      role: 'Operations Lead',
      signInName: 'jpike',
      exerciseRole: 'participant',
      persona: {
        id: 'mock-persona-seeded-pike',
        handle: 'jpike_utilities',
        displayName: 'Jordan Pike',
        kind: 'human',
        autoCreated: false,
      },
      link: {
        status: 'active',
        issuedAt: '2026-10-12T20:10:00.000Z',
        useCount: 1,
        joinUrl: `${MOCK_JOIN_BASE}MOCK-TOKEN-jordan-pike`,
      },
      access: 'disabled',
      liveSessions: 0,
      lastSignInAt: '2026-10-12T21:00:00.000Z',
      createdAt: '2026-10-12T20:10:00.000Z',
    },
    {
      // A legacy-import account: no agency, no role, no persona, no link.
      id: 'mock-acct-007',
      name: 'Aiko Tanaka',
      signInName: 'atanaka',
      exerciseRole: 'participant',
      link: { status: 'none', useCount: 0 },
      access: 'enabled',
      liveSessions: 0,
      createdAt: '2026-09-30T15:00:00.000Z',
    },
  ]
}

interface MockState {
  entries: RosterEntryDto[]
  joinLinksAvailable: boolean
  access: RosterMockAccess
  sequence: number
}

function freshState(): MockState {
  return { entries: seedEntries(), joinLinksAvailable: true, access: 'allowed', sequence: 100 }
}

let state: MockState = freshState()

/** Restores the mock store, the 403 switch and the join-links switch to the seed. DEV/TEST ONLY. */
export function resetRosterMocks(): void {
  state = freshState()
}

/** The 403 switch: while `'forbidden'`, every call answers 403 (an evaluator or org admin). */
export function setRosterMockAccess(access: RosterMockAccess): void {
  state.access = access
}

/** The `joinLinksAvailable` switch. While false no row carries a `joinUrl` (EL-6). */
export function setRosterMockJoinLinksAvailable(available: boolean): void {
  state.joinLinksAvailable = available
  if (!available) {
    state.entries = state.entries.map(stripJoinUrl)
  }
}

/** A copy of the mock's current rows, for tests asserting that a dry run wrote nothing. */
export function getRosterMockEntries(): RosterEntryDto[] {
  return state.entries.map(entry => ({ ...entry, link: { ...entry.link } }))
}

function stripJoinUrl(entry: RosterEntryDto): RosterEntryDto {
  if (entry.link.joinUrl === undefined) return entry
  const link = { ...entry.link }
  delete link.joinUrl
  return { ...entry, link }
}

// ---------------------------------------------------------------------------
// The frozen derivation rules
// ---------------------------------------------------------------------------

/** Strips diacritics and lower-cases (`José Álvarez` -> `jose alvarez`). */
function asciiFold(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/**
 * The derived sign-in name (frozen rules): ASCII-fold, lower-case, drop the
 * suffixes `jr sr ii iii iv md phd`, then the first initial of the first word
 * plus the last word, letters and digits only, at most 32 characters. A derived
 * name under 3 characters gets `1` appended. On a collision the smallest free
 * integer from 2 is appended.
 *
 * `Jane Smith` -> `jsmith`; `Mary-Ann O'Neil` -> `moneil`; `José Álvarez` ->
 * `jalvarez`; `Madonna` -> `madonna`; `Ng` -> `ng1`.
 */
export function deriveSignInName(name: string, taken: ReadonlySet<string>): string {
  const words = asciiFold(name)
    .split(/\s+/)
    .map(word => word.replace(/[^a-z0-9]/g, ''))
    .filter(word => word.length > 0 && !NAME_SUFFIXES.has(word))

  const first = words[0] ?? ''
  const last = words[words.length - 1] ?? ''
  let base = words.length <= 1 ? last : `${first.charAt(0)}${last}`
  base = base.slice(0, 32)
  if (base.length < 3) base = `${base}1`

  if (!taken.has(base)) return base
  for (let n = 2; ; n += 1) {
    const suffix = String(n)
    const candidate = `${base.slice(0, 32 - suffix.length)}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * The auto citizen persona's handle (frozen rules): the full name as a slug,
 * `[a-z0-9_]` only, at most 30 characters; `_2`, `_3`… on a collision
 * (case-insensitive) with any persona in the exercise or an earlier row.
 */
export function deriveAutoPersonaHandle(name: string, taken: ReadonlySet<string>): string {
  const slug = asciiFold(name).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30)
  const base = slug.length > 0 ? slug : 'participant'
  if (!taken.has(base)) return base
  for (let n = 2; ; n += 1) {
    const suffix = `_${n}`
    const candidate = `${base.slice(0, 30 - suffix.length)}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

// ---------------------------------------------------------------------------
// Row processing (shared by add + import)
// ---------------------------------------------------------------------------

function squash(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ')
}

function normalizeKey(value: string | undefined): string {
  return squash(value).toLowerCase()
}

/** The mock's stand-in for the server's markup stripping (NFR-004). */
function stripMarkup(value: string): string {
  return squash(value.replace(/<[^>]*>/g, ''))
}

function normalizeHandle(value: string | undefined): string {
  return squash(value).replace(/^@+/, '')
}

/** One parsed row, before it meets the roster. */
interface RowInput {
  name: string
  agency: string
  role: string
  email: string
  personaHandle: string
  signInName: string
}

function toRowInput(write: RosterRowWrite): RowInput {
  return {
    name: stripMarkup(write.name ?? ''),
    agency: stripMarkup(write.agency ?? ''),
    role: stripMarkup(write.role ?? ''),
    email: squash(write.email),
    personaHandle: normalizeHandle(write.personaHandle),
    signInName: squash(write.signInName).toLowerCase(),
  }
}

/** The reason a row is invalid, or `undefined` when it is acceptable. */
function validateRow(row: RowInput): string | undefined {
  if (row.name.length === 0) return 'name is required.'
  if (row.name.length > 256) return 'name must be 256 characters or fewer.'
  if (row.agency.length > 128) return 'agency must be 128 characters or fewer.'
  if (row.role.length > 128) return 'role must be 128 characters or fewer.'
  if (row.email.length > 0 && (row.email.length > 254 || !EMAIL_PATTERN.test(row.email))) {
    return 'email is not a valid address.'
  }
  if (row.signInName.length > 0 && !SIGN_IN_NAME_PATTERN.test(row.signInName)) {
    return 'signInName must be 3 to 32 characters: a-z, 0-9, ".", "_" or "-".'
  }
  return undefined
}

/** The identity key (idempotency): signInName > email > name + agency. */
function findMatch(entries: readonly RosterEntryDto[], row: RowInput): {
  entry: RosterEntryDto
  by: 'signInName' | 'email' | 'nameAgency'
} | undefined {
  if (row.signInName.length > 0) {
    const entry = entries.find(e => normalizeKey(e.signInName) === row.signInName)
    return entry ? { entry, by: 'signInName' } : undefined
  }
  if (row.email.length > 0) {
    const key = normalizeKey(row.email)
    const entry = entries.find(e => normalizeKey(e.email) === key)
    return entry ? { entry, by: 'email' } : undefined
  }
  const nameKey = normalizeKey(row.name)
  const agencyKey = normalizeKey(row.agency)
  const entry = entries.find(
    e => normalizeKey(e.name) === nameKey && normalizeKey(e.agency) === agencyKey,
  )
  return entry ? { entry, by: 'nameAgency' } : undefined
}

/** The within-file duplicate key for a row (same precedence as the match key). */
function fileKey(row: RowInput): string {
  if (row.signInName.length > 0) return `s:${row.signInName}`
  if (row.email.length > 0) return `e:${normalizeKey(row.email)}`
  return `n:${normalizeKey(row.name)}|${normalizeKey(row.agency)}`
}

function findOrgPersona(handle: string): RosterPersonaDto | undefined {
  const lower = handle.toLowerCase()
  const found = MOCK_ORG_PERSONAS.find(persona => persona.handle.toLowerCase() === lower)
  return found ? orgPersona(found.handle) : undefined
}

const UNKNOWN_PERSONA_MESSAGE =
  'personaHandle must name an organization persona in this exercise.'

function newLink(): RosterEntryDto['link'] {
  const token = `MOCK-TOKEN-${(state.sequence += 1)}`
  return {
    status: 'active',
    issuedAt: new Date().toISOString(),
    useCount: 0,
    ...(state.joinLinksAvailable ? { joinUrl: `${MOCK_JOIN_BASE}${token}` } : {}),
  }
}

type RowOutcome =
  | { kind: 'failed', message: string }
  | { kind: 'created', entry: RosterEntryDto }
  | { kind: 'updated', entry: RosterEntryDto, message: string }
  | { kind: 'unchanged', entry: RosterEntryDto }

/**
 * Applies ONE row to `working` (a private copy) and reports what happened. The
 * caller commits `working` only for a real, non-dry-run import.
 */
function applyRow(
  working: RosterEntryDto[],
  row: RowInput,
  takenSignInNames: Set<string>,
  takenHandles: Set<string>,
): RowOutcome {
  const invalid = validateRow(row)
  if (invalid !== undefined) return { kind: 'failed', message: invalid }

  let org: RosterPersonaDto | undefined
  if (row.personaHandle.length > 0) {
    org = findOrgPersona(row.personaHandle)
    // An unknown handle, another exercise's handle and a non-org persona all
    // fail with the SAME message (no oracle).
    if (org === undefined) return { kind: 'failed', message: UNKNOWN_PERSONA_MESSAGE }
  }

  const match = findMatch(working, row)
  if (match) {
    const existing = match.entry
    const changes: string[] = []
    let next: RosterEntryDto = existing

    // A blank cell never clears a stored value.
    if (row.agency.length > 0 && row.agency !== (existing.agency ?? '')) {
      next = { ...next, agency: row.agency }
      changes.push('agency')
    }
    if (row.role.length > 0 && row.role !== (existing.role ?? '')) {
      next = { ...next, role: row.role }
      changes.push('role')
    }
    if (row.email.length > 0 && row.email !== (existing.email ?? '')) {
      next = { ...next, email: row.email }
      changes.push('email')
    }
    // The display name is only corrected when matched by sign-in name or email.
    if (match.by !== 'nameAgency' && row.name !== existing.name) {
      next = { ...next, name: row.name }
      changes.push('name')
    }
    if (org !== undefined && existing.persona?.handle !== org.handle) {
      next = { ...next, persona: org, exerciseRole: 'pio' }
      changes.push(`persona bound to @${org.handle}`)
    }

    if (changes.length === 0) return { kind: 'unchanged', entry: existing }
    const index = working.findIndex(e => e.id === existing.id)
    if (index >= 0) working[index] = next
    return { kind: 'updated', entry: next, message: `${changes.join(', ')} changed.` }
  }

  // A new participant.
  let signInName = row.signInName
  if (signInName.length > 0) {
    if (takenSignInNames.has(signInName)) {
      return { kind: 'failed', message: `signInName "${signInName}" is already taken.` }
    }
  } else {
    signInName = deriveSignInName(row.name, takenSignInNames)
  }
  takenSignInNames.add(signInName)

  let persona: RosterPersonaDto
  if (org !== undefined) {
    persona = org
  } else {
    const handle = deriveAutoPersonaHandle(row.name, takenHandles)
    takenHandles.add(handle)
    persona = autoPersona(handle, row.name)
  }

  state.sequence += 1
  const entry: RosterEntryDto = {
    id: `mock-acct-${state.sequence}`,
    name: row.name,
    ...(row.agency.length > 0 ? { agency: row.agency } : {}),
    ...(row.role.length > 0 ? { role: row.role } : {}),
    ...(row.email.length > 0 ? { email: row.email } : {}),
    signInName,
    exerciseRole: org !== undefined ? 'pio' : 'participant',
    persona,
    link: newLink(),
    access: 'enabled',
    liveSessions: 0,
    createdAt: new Date().toISOString(),
  }
  working.push(entry)
  return { kind: 'created', entry }
}

function takenNamesOf(entries: readonly RosterEntryDto[]): Set<string> {
  return new Set(entries.map(entry => entry.signInName.toLowerCase()))
}

function takenHandlesOf(entries: readonly RosterEntryDto[]): Set<string> {
  const handles = new Set<string>(MOCK_ORG_PERSONAS.map(persona => persona.handle.toLowerCase()))
  for (const entry of entries) {
    if (entry.persona) handles.add(entry.persona.handle.toLowerCase())
  }
  return handles
}

// ---------------------------------------------------------------------------
// CSV (mock only — the live server parses uploads; the screen ships no parser)
// ---------------------------------------------------------------------------

/** A small RFC-4180-ish reader: BOM tolerated, quotes, doubled quotes, blank lines skipped. */
function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  const endCell = () => {
    row.push(cell)
    cell = ''
  }
  const endRow = () => {
    endCell()
    if (row.some(value => value.trim().length > 0)) rows.push(row)
    row = []
  }

  for (let i = 0; i < source.length; i += 1) {
    const ch = source.charAt(i)
    if (quoted) {
      if (ch === '"' && source.charAt(i + 1) === '"') {
        cell += '"'
        i += 1
      } else if (ch === '"') {
        quoted = false
      } else {
        cell += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      endCell()
    } else if (ch === '\n') {
      endRow()
    } else if (ch !== '\r') {
      cell += ch
    }
  }
  endRow()
  return rows
}

const HEADER_ALIASES: Readonly<Record<string, keyof RowInput>> = {
  name: 'name',
  displayname: 'name',
  agency: 'agency',
  role: 'role',
  email: 'email',
  personahandle: 'personaHandle',
  persona: 'personaHandle',
  signinname: 'signInName',
  username: 'signInName',
}

async function readFileText(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsText(file)
  })
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function respond<T>(config: InternalAxiosRequestConfig, data: T, status = 200) {
  return Promise.resolve({
    data,
    status,
    statusText: status === 201 ? 'Created' : 'OK',
    headers: {},
    config,
  })
}

function reject(config: InternalAxiosRequestConfig, status: number, detail: string) {
  const statusText = status === 403 ? 'Forbidden' : status === 404 ? 'Not Found'
    : status === 409 ? 'Conflict' : 'Bad Request'
  return Promise.reject(
    new AxiosError(
      detail,
      undefined,
      config,
      undefined,
      { status, statusText, data: { title: statusText, status, detail }, headers: {}, config },
    ),
  )
}

const ROSTER_PATH = '/staff/roster'
const ACTION_PATH = /^\/staff\/roster\/([^/]+)\/(link\/reissue|link\/revoke|disable|enable)$/

const ACTION_BY_SEGMENT: Readonly<Record<string, RosterActionKind>> = {
  'link/reissue': 'reissue',
  'link/revoke': 'revoke',
  disable: 'disable',
  enable: 'enable',
}

function listBody(): RosterListDto {
  return {
    participants: state.entries.map(entry => ({ ...entry, link: { ...entry.link } })),
    joinLinksAvailable: state.joinLinksAvailable,
    capabilities: { emailLinks: false },
  }
}

function parseJsonBody(data: unknown): unknown {
  if (typeof data !== 'string') return data
  try {
    return JSON.parse(data)
  } catch {
    return undefined
  }
}

function asRowWrite(body: unknown): RosterRowWrite {
  const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
  const text = (key: string): string | undefined => {
    const value = record[key]
    return typeof value === 'string' ? value : undefined
  }
  return {
    name: text('name') ?? '',
    ...(text('agency') !== undefined ? { agency: text('agency') } : {}),
    ...(text('role') !== undefined ? { role: text('role') } : {}),
    ...(text('email') !== undefined ? { email: text('email') } : {}),
    ...(text('personaHandle') !== undefined ? { personaHandle: text('personaHandle') } : {}),
    ...(text('signInName') !== undefined ? { signInName: text('signInName') } : {}),
  }
}

function addParticipant(config: InternalAxiosRequestConfig) {
  const row = toRowInput(asRowWrite(parseJsonBody(config.data)))
  const working = [...state.entries]
  const outcome = applyRow(working, row, takenNamesOf(working), takenHandlesOf(working))

  if (outcome.kind === 'failed') return reject(config, 400, outcome.message)
  if (outcome.kind !== 'created') {
    return reject(config, 409, 'That person is already on the roster.')
  }
  state.entries = working
  return respond(config, { ...outcome.entry, link: { ...outcome.entry.link } }, 201)
}

async function importRoster(config: InternalAxiosRequestConfig) {
  const params = (config.params ?? {}) as Record<string, unknown>
  const dryRun = String(params.dryRun) === 'true'

  const form = config.data
  const file = form instanceof FormData ? form.get('file') : null
  if (!(file instanceof Blob) || file.size === 0) {
    return reject(config, 400, 'A non-empty CSV file (multipart/form-data field \'file\') is required.')
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return reject(config, 400, `the CSV file exceeds the maximum size of ${MAX_IMPORT_BYTES} bytes.`)
  }
  const fileName = file instanceof File ? file.name.toLowerCase() : ''
  if (!fileName.endsWith('.csv') && file.type !== 'text/csv') {
    return reject(config, 400, 'the uploaded file must be a CSV (text/csv or a .csv file).')
  }

  const table = parseCsv(await readFileText(file))
  const header = table[0]
  if (header === undefined) return reject(config, 400, 'the CSV has no header row.')

  const columns = header.map(cell => HEADER_ALIASES[cell.trim().toLowerCase()])
  if (!columns.includes('name')) {
    return reject(config, 400, 'the CSV header must include a "name" column.')
  }
  const dataRows = table.slice(1)
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return reject(config, 400, `the CSV exceeds the maximum of ${MAX_IMPORT_ROWS} data rows.`)
  }

  const working = state.entries.map(entry => ({ ...entry, link: { ...entry.link } }))
  const takenNames = takenNamesOf(working)
  const takenHandles = takenHandlesOf(working)
  const seen = new Map<string, number>()
  const rows: RosterImportRowDto[] = []

  dataRows.forEach((cells, index) => {
    const rowNumber = index + 1
    const write: Record<string, string> = {}
    columns.forEach((column, position) => {
      if (column !== undefined) write[column] = cells[position] ?? ''
    })
    const row = toRowInput({
      name: write.name ?? '',
      agency: write.agency,
      role: write.role,
      email: write.email,
      personaHandle: write.personaHandle,
      signInName: write.signInName,
    })

    const key = fileKey(row)
    const earlier = seen.get(key)
    if (earlier !== undefined && row.name.length > 0) {
      rows.push({
        rowNumber,
        name: row.name,
        status: 'failed',
        personaCreated: false,
        message: `duplicate of row ${earlier}; give a signInName to tell them apart`,
      })
      return
    }
    seen.set(key, rowNumber)

    const outcome = applyRow(working, row, takenNames, takenHandles)
    if (outcome.kind === 'failed') {
      rows.push({
        rowNumber,
        name: row.name,
        ...(row.signInName.length > 0 ? { signInName: row.signInName } : {}),
        status: 'failed',
        personaCreated: false,
        message: outcome.message,
      })
      return
    }
    rows.push({
      rowNumber,
      name: outcome.entry.name,
      signInName: outcome.entry.signInName,
      status: outcome.kind,
      ...(outcome.entry.persona ? { personaHandle: outcome.entry.persona.handle } : {}),
      personaCreated: outcome.kind === 'created' && outcome.entry.persona?.autoCreated === true,
      ...(outcome.kind === 'updated' ? { message: outcome.message } : {}),
    })
  })

  // A dry run reports the SAME thing and writes nothing.
  if (!dryRun) state.entries = working

  const count = (status: RosterImportRowDto['status']) =>
    rows.filter(row => row.status === status).length
  const result: RosterImportResultDto = {
    dryRun,
    totalRows: rows.length,
    createdCount: count('created'),
    updatedCount: count('updated'),
    unchangedCount: count('unchanged'),
    failedCount: count('failed'),
    rows,
  }
  return respond(config, result)
}

function runAction(config: InternalAxiosRequestConfig, id: string, kind: RosterActionKind) {
  const index = state.entries.findIndex(entry => entry.id === id)
  const current = state.entries[index]
  if (current === undefined) return reject(config, 404, 'No such participant on this roster.')

  // Reissue, revoke and disable all end the participant's live sessions (EL-8).
  const endsSessions = kind !== 'enable'
  const sessionsEnded = endsSessions ? current.liveSessions : 0
  let next: RosterEntryDto = endsSessions ? { ...current, liveSessions: 0 } : current

  if (kind === 'reissue') {
    next = { ...next, link: newLink() }
  } else if (kind === 'revoke') {
    const link = { ...next.link, status: 'revoked' as const, revokedAt: new Date().toISOString() }
    delete link.joinUrl
    delete link.needsReissue
    next = { ...next, link }
  } else if (kind === 'disable') {
    next = { ...next, access: 'disabled' }
  } else {
    next = { ...next, access: 'enabled' }
  }

  state.entries = state.entries.map((entry, i) => (i === index ? next : entry))
  const body: RosterActionResultDto = {
    participantId: next.id,
    link: { ...next.link },
    access: next.access,
    sessionsEnded,
  }
  return respond(config, body)
}

/**
 * The mock adapter: routes `(method, url)` to the contract's behaviour. Pass it
 * as `adapter` on a request through the shared axios client so the request shape
 * (method, URL, params, multipart body) is exactly the live call's.
 */
export const rosterMockAdapter: AxiosAdapter = config => {
  if (state.access === 'forbidden') {
    return reject(config, 403, 'You do not have access to the roster.')
  }

  const method = (config.method ?? 'get').toLowerCase()
  const url = config.url ?? ''

  if (method === 'get' && url === ROSTER_PATH) return respond(config, listBody())
  if (method === 'post' && url === ROSTER_PATH) return addParticipant(config)
  if (method === 'post' && url === `${ROSTER_PATH}/import`) return importRoster(config)

  const action = method === 'post' ? ACTION_PATH.exec(url) : null
  const id = action?.[1]
  const kind = ACTION_BY_SEGMENT[action?.[2] ?? '']
  if (id !== undefined && kind !== undefined) {
    return runAction(config, decodeURIComponent(id), kind)
  }

  return reject(config, 404, `The mock roster has no route for ${method.toUpperCase()} ${url}.`)
}
