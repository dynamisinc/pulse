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
 * ## The derivation + matching rules live HERE too, and MIRROR THE SERVER
 * They are the frozen rules the backend (story 02) implements and the screen
 * explains to staff (implementation.md, "Derivation and matching rules", with every
 * amendment through the Gate-2 same-file guards (1)-(4) and the persona-less rule).
 * The server is the authority: this mock is a line-for-line port, so a file gives the
 * same answer here and there. Where each rule comes from:
 *
 *  - `RosterWorkspace.cs` (src/Pulse.WebApi/Features/Identity/Roster/), in
 *    {@link applyCore} / {@link updateParticipant} / {@link createParticipant} /
 *    {@link applyFileRow}: the CASCADING identity key (signInName, email, name + agency)
 *    against the people from BEFORE the request, a key matching MORE than one person
 *    failing the row, a later key conflicting only when NONE of its matches is the matched
 *    person, the signInName/different-email guard, `updated` vs `unchanged`, the org
 *    rebind (persona differs OR role is not `pio`), a persona-less matched person getting
 *    an auto persona ("persona created" / "persona re-created", role `participant`),
 *    the "signInName X ignored" note (also on `unchanged`), the message format
 *    ("agency, role changed; persona bound to @X."), and the same-file guards:
 *    (1) "duplicate of row N (same person)", (2) "same name and agency as row N" (a
 *    pre-scan over ALL rows), (3) a person counts as reached the moment a row resolves
 *    them even if that row then fails (and the people a conflicting key names count too),
 *    (4) "email also on row N", checked BEFORE the first-key "duplicate of row N". Rows
 *    are VALIDATED first and record their file key only after the guards pass.
 *  - `RosterRowRules.cs`: normalising (markup stripped, whitespace squashed), the
 *    validation order and its exact messages (including the separate markup-only name
 *    message), and the email shape (no `<` or `>`).
 *  - `RosterCsvParser.cs` over `AccountCsvParser.cs`: lines split first, so a newline
 *    inside a quoted cell is NOT supported; first column wins; the no-header and
 *    no-name-column messages.
 *  - `SignInNameDeriver.cs` and `PersonaHandleDeriver.cs`: {@link deriveSignInName},
 *    {@link deriveAutoPersonaHandle}, and the ASCII fold (every non-spacing mark, Mn).
 *  - `RosterService.cs`: the single add (400 / 409 / "already on the roster") and the
 *    per-row report shape.
 *
 * The same examples are pinned on both sides: `rosterMocks.test.ts` ports the cases of
 * `RosterWorkspaceTests.cs`. Change a rule in one place and the other test goes red.
 *
 * Two states the seed does not carry are staged on demand, because the default seed's
 * seven rows are counted by the roster screen's own tests:
 * {@link addRosterMockEntry} and {@link addRosterMockUnresolvedPersonaPerson}.
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
  /**
   * Ids of people whose STORED persona id resolves to nothing in this exercise (dangling, or
   * another exercise's persona hidden by the central filter). On the wire such a person is
   * just persona-less (the list omits `persona`, like Aiko); only a row that matches them can
   * tell the difference, by reporting "persona re-created" instead of "persona created". It is
   * mock-internal: `RosterEntryDto` has no field for it, as the server's list has none.
   */
  unresolvedPersonaIds: Set<string>
  joinLinksAvailable: boolean
  access: RosterMockAccess
  sequence: number
}

function freshState(): MockState {
  return {
    entries: seedEntries(),
    unresolvedPersonaIds: new Set(),
    joinLinksAvailable: true,
    access: 'allowed',
    sequence: 100,
  }
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

/** The id of the person {@link addRosterMockUnresolvedPersonaPerson} adds. */
export const MOCK_UNRESOLVED_PERSONA_PERSON_ID = 'mock-acct-008'

/**
 * DEV/TEST ONLY. Puts one more person on the mock roster, as if the server already held
 * them: the way to stage a state the seed does not carry (two legacy people with one name,
 * an org-persona person whose role is not `pio`, a persona-less `pio`). With
 * `unresolvedPersona` the person's stored persona resolves to nothing (see
 * `MockState.unresolvedPersonaIds`), so the persona is dropped and the next row that matches
 * them reports "persona re-created". A later reset restores the seed.
 */
export function addRosterMockEntry(
  entry: RosterEntryDto,
  options: { readonly unresolvedPersona?: boolean } = {},
): void {
  let stored = copyEntry(entry)
  if (options.unresolvedPersona === true) {
    delete stored.persona
    state.unresolvedPersonaIds.add(stored.id)
  }
  if (!state.joinLinksAvailable) stored = stripJoinUrl(stored)
  state.entries = [...state.entries, stored]
}

/**
 * DEV/TEST ONLY. Adds Lena Okafor (`mock-acct-008`), a person whose stored persona cannot be
 * found: the case that makes a matching row say "persona re-created @lena_okafor: the previous
 * one was not found". It is OPT-IN, not part of the default seed: the default seed's seven
 * rows are what the roster screen's own tests count, and an eighth would change them all.
 */
export function addRosterMockUnresolvedPersonaPerson(): void {
  if (state.entries.some(entry => entry.id === MOCK_UNRESOLVED_PERSONA_PERSON_ID)) return
  addRosterMockEntry(
    {
      id: MOCK_UNRESOLVED_PERSONA_PERSON_ID,
      name: 'Lena Okafor',
      agency: 'Fulco Public Works',
      role: 'Road Crew Lead',
      signInName: 'lokafor',
      exerciseRole: 'participant',
      link: { status: 'none', useCount: 0 },
      access: 'enabled',
      liveSessions: 0,
      createdAt: '2026-09-30T15:00:00.000Z',
    },
    { unresolvedPersona: true },
  )
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

/**
 * Strips diacritics and lower-cases (`José Álvarez` -> `jose alvarez`).
 *
 * MIRRORS `SignInNameDeriver.AsciiFold`: NFD, drop the NON-SPACING marks, lower-case.
 * "Non-spacing mark" is Unicode category Mn (`\p{Mn}`), which is exactly what the server
 * tests (`UnicodeCategory.NonSpacingMark`). That is every combining diacritic NFD produces
 * for a Latin name, and it reaches past the U+0300..U+036F block the mock used to strip
 * (U+1AB0.., U+1DC0.., U+20D0.., U+FE20..). The wider `\p{M}` would also strip the SPACING
 * (Mc) and ENCLOSING (Me) marks, which the server keeps; matching the server means keeping
 * them too, so they act as a separator in a handle slug, exactly as there.
 */
function asciiFold(value: string): string {
  return value.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase()
}

/**
 * The derived sign-in name (frozen rules; `SignInNameDeriver.cs`): ASCII-fold, lower-case,
 * drop the suffixes `jr sr ii iii iv md phd`, then the first initial of the first word
 * plus the last word, letters and digits only, at most 32 characters. A derived
 * name under 3 characters gets `1` appended. On a collision the smallest free
 * integer from 2 is appended. `taken` is every name to step around: existing
 * accounts (roster or not), earlier rows in the file, AND every persona handle in
 * the exercise (amended contract, story 10 Gate-1 W5).
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
 * The auto citizen persona's handle (frozen rules; `PersonaHandleDeriver.cs`): the full
 * name as a slug, `[a-z0-9_]` only, at most 30 characters; `_2`, `_3`… on a collision
 * (case-insensitive) with any persona in the exercise, an earlier row, OR any
 * sign-in name in the exercise INCLUDING the row's own: the public handle is never a
 * sign-in name (EL-1), so `Madonna` signs in as `madonna` and posts as `@madonna_2`.
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
// Row normalising + validation (RosterRowRules.cs)
// ---------------------------------------------------------------------------

/** `RosterRowRules.Squash`: trim, and collapse every run of whitespace to one space. */
function squash(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ')
}

/** `RosterRowRules.NormalizeKey`: the comparison key of a value. */
function normalizeKey(value: string | undefined): string {
  return squash(value).toLowerCase()
}

/**
 * The mock's stand-in for `PostSanitizer.Sanitize` (NFR-004): STRIP, never encode. A
 * `<script>`/`<style>` block goes with its contents; any other COMPLETE tag (`<`, an
 * optional `/`, an ASCII letter, anything but `>`, then `>`) goes and its surrounding text
 * stays. A stray `<` or `>` is the author's literal character. Re-run until stable because
 * removing a tag can rebuild another (`<<b>img src=x>`); capped, since this is a mock.
 */
function sanitizeMarkup(value: string): string {
  let text = value
  for (let pass = 0; pass < 8; pass += 1) {
    const stripped = text
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<\/?[a-z][^>]*>/gi, '')
    if (stripped === text) break
    text = stripped
  }
  return text
}

/** `RosterRowRules.SanitizeText`: markup stripped, then squashed. */
function sanitizeText(value: string | undefined): string {
  return value === undefined || value.trim().length === 0 ? '' : squash(sanitizeMarkup(value))
}

const UNUSABLE_HANDLE_MESSAGE = 'personaHandle is not a usable persona handle.'
const MAX_PERSONA_HANDLE_LENGTH = 256

/**
 * The persona-handle cell, as `RosterRowRules.Normalize` + `OpsPersonaResolver.TryNormalizeHandle`
 * read it: sanitized, ONE leading `@` dropped (then any further ones, as the roster
 * tolerates), squashed. A cell that is nothing but `@`/markup, or over 256 characters, is
 * an error rather than "no handle".
 */
function normalizeHandle(raw: string | undefined): { value: string, error?: string } {
  const trimmed = (raw ?? '').trim()
  if (trimmed.length === 0) return { value: '' }

  let text = sanitizeMarkup(trimmed).trim()
  if (text.startsWith('@')) text = text.slice(1).trim()
  if (text.length === 0) return { value: '', error: UNUSABLE_HANDLE_MESSAGE }
  if (text.length > MAX_PERSONA_HANDLE_LENGTH) {
    return {
      value: '',
      error: `personaHandle must be at most ${MAX_PERSONA_HANDLE_LENGTH} characters.`,
    }
  }
  const value = squash(text.replace(/^@+/, ''))
  return value.length === 0 ? { value: '', error: UNUSABLE_HANDLE_MESSAGE } : { value }
}

/** One parsed row, before it meets the roster (`RosterRowInput`). */
interface RowInput {
  name: string
  /** The raw name was not blank but was nothing except markup. */
  nameWasOnlyMarkup: boolean
  agency: string
  role: string
  email: string
  personaHandle: string
  personaHandleError?: string
  signInName: string
}

/** `RosterRowRules.Normalize`. */
function toRowInput(write: RosterRowWrite): RowInput {
  const name = sanitizeText(write.name)
  const handle = normalizeHandle(write.personaHandle)
  return {
    name,
    nameWasOnlyMarkup: name.length === 0 && squash(write.name).length > 0,
    agency: sanitizeText(write.agency),
    role: sanitizeText(write.role),
    email: squash(write.email),
    personaHandle: handle.value,
    ...(handle.error !== undefined ? { personaHandleError: handle.error } : {}),
    signInName: squash(write.signInName).toLowerCase(),
  }
}

const NAME_REQUIRED_MESSAGE = 'name is required.'
const NAME_ONLY_MARKUP_MESSAGE =
  'name is required (it contained only markup, which is stripped on ingest).'

/**
 * `RosterRowRules.EmailPattern`: something, `@`, something, a dot, something; no
 * whitespace, no second `@`, and no angle bracket.
 */
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

/** `RosterRowRules.Validate`: the reason a row is invalid, or `undefined`. Order matters. */
function validateRow(row: RowInput): string | undefined {
  if (row.name.length === 0) {
    return row.nameWasOnlyMarkup ? NAME_ONLY_MARKUP_MESSAGE : NAME_REQUIRED_MESSAGE
  }
  if (row.name.length > 256) return 'name must be 256 characters or fewer.'
  if (row.agency.length > 128) return 'agency must be 128 characters or fewer.'
  if (row.role.length > 128) return 'role must be 128 characters or fewer.'
  if (row.email.length > 0 && (row.email.length > 254 || !EMAIL_PATTERN.test(row.email))) {
    return 'email is not a valid address.'
  }
  if (row.signInName.length > 0 && !SIGN_IN_NAME_PATTERN.test(row.signInName)) {
    return 'signInName must be 3 to 32 characters: a-z, 0-9, ".", "_" or "-".'
  }
  return row.personaHandleError
}

// ---------------------------------------------------------------------------
// The roster as ONE request sees it (RosterWorkspace.cs)
// ---------------------------------------------------------------------------

/** Which key of a row matched existing participants. */
type MatchBy = 'signInName' | 'email' | 'nameAgency'

const MATCH_LABEL: Readonly<Record<MatchBy, string>> = {
  signInName: 'signInName',
  email: 'email',
  nameAgency: 'name and agency',
}

/** What ONE key of a row matched: a LIST, because a key can name more than one person. */
interface KeyMatches {
  readonly by: MatchBy
  readonly people: readonly RosterEntryDto[]
}

function findOrgPersona(handle: string): RosterPersonaDto | undefined {
  const lower = handle.toLowerCase()
  const found = MOCK_ORG_PERSONAS.find(persona => persona.handle.toLowerCase() === lower)
  return found ? orgPersona(found.handle) : undefined
}

const UNKNOWN_PERSONA_MESSAGE =
  'personaHandle must name an organization persona in this exercise.'
const DIFFERENT_EMAIL_MESSAGE = 'signInName belongs to someone with a different email.'
const ALREADY_ON_ROSTER_MESSAGE = 'That person is already on the roster.'

function newLink(): RosterEntryDto['link'] {
  const token = `MOCK-TOKEN-${(state.sequence += 1)}`
  return {
    status: 'active',
    issuedAt: new Date().toISOString(),
    useCount: 0,
    ...(state.joinLinksAvailable ? { joinUrl: `${MOCK_JOIN_BASE}${token}` } : {}),
  }
}

/** Why a row failed: a bad value (400 when adding one) or a conflict (409). */
type FailureCode = 'invalid' | 'conflict'

type RowOutcome =
  | { kind: 'failed', code: FailureCode, message: string }
  | { kind: 'created', entry: RosterEntryDto, personaCreated: boolean }
  | { kind: 'updated', entry: RosterEntryDto, message: string, personaCreated: boolean }
  | { kind: 'unchanged', entry: RosterEntryDto, note?: string }

/**
 * Accounts that exist in the exercise but are NOT on the roster (a staff or legacy
 * account). Their sign-in names are taken: a derived name steps around them and an
 * explicit one that equals one fails the row. `plee` is what `Pat Lee` would derive.
 */
export const MOCK_NON_ROSTER_SIGN_IN_NAMES: readonly string[] = ['admin', 'legacybot', 'plee']

/**
 * What one request judges its rows against (`RosterWorkspace`'s fields). Built once per
 * request from the store, then mutated as rows claim names, so a later row sees what an
 * earlier one took. Nothing here is the store: a dry run simply drops it.
 */
interface RowContext {
  /** The participants BEFORE this request, by identity key. Never mutated: rows match them. */
  readonly bySignInName: ReadonlyMap<string, readonly RosterEntryDto[]>
  readonly byEmail: ReadonlyMap<string, readonly RosterEntryDto[]>
  readonly byNameAgency: ReadonlyMap<string, readonly RosterEntryDto[]>
  /** The working copy that updates and creations are applied to. */
  readonly working: RosterEntryDto[]
  /** People whose stored persona resolves to nothing (mock-internal; see `MockState`). */
  readonly unresolvedPersonaIds: Set<string>
  /** Every sign-in name in use (lower-case): roster, non-roster accounts, this request. */
  readonly signInNames: Set<string>
  /** Sign-in names claimed by rows earlier in THIS file. */
  readonly claimedInFile: Set<string>
  /** Every persona handle in the exercise (lower-case, no '@'): org, roster, this request. */
  readonly handles: Set<string>
  // Same-file bookkeeping (ApplyFile only): the file-wide guards (1), (3), (4) and the dup key.
  /** First identity key of each row so far -> its row number (the "duplicate of row N" check). */
  readonly fileKeys: Map<string, number>
  /** Existing person id -> the first row that RESOLVED them (guards 1 and 3). */
  readonly matchedInFile: Map<string, number>
  /** Normalised email -> the first row that carried it (guard 4). */
  readonly emailsInFile: Map<string, number>
}

/** `RosterWorkspace.NameAgencyKey`. */
function nameAgencyKey(name: string, agency: string | undefined): string {
  return `${normalizeKey(name)}|${normalizeKey(agency)}`
}

/** `RosterWorkspace.HandleKey`: trimmed, no leading '@', lower-case. */
function handleKey(handle: string): string {
  return handle.trim().replace(/^@+/, '').toLowerCase()
}

/** `RosterWorkspace.Index`: a blank key (and a bare `|`) is never indexed. */
function indexBy(
  entries: readonly RosterEntryDto[],
  keyOf: (entry: RosterEntryDto) => string,
): Map<string, RosterEntryDto[]> {
  const index = new Map<string, RosterEntryDto[]>()
  for (const entry of entries) {
    const key = keyOf(entry)
    if (key.length === 0 || key === '|') continue
    const list = index.get(key)
    if (list === undefined) index.set(key, [entry])
    else list.push(entry)
  }
  return index
}

function copyEntry(entry: RosterEntryDto): RosterEntryDto {
  return { ...entry, link: { ...entry.link } }
}

function makeContext(): RowContext {
  const before = state.entries.map(copyEntry)
  const signInNames = new Set(before.map(entry => normalizeKey(entry.signInName)))
  for (const name of MOCK_NON_ROSTER_SIGN_IN_NAMES) signInNames.add(name)
  const handles = new Set(MOCK_ORG_PERSONAS.map(persona => handleKey(persona.handle)))
  for (const entry of before) {
    if (entry.persona) handles.add(handleKey(entry.persona.handle))
  }
  return {
    bySignInName: indexBy(before, entry => normalizeKey(entry.signInName)),
    byEmail: indexBy(before, entry => normalizeKey(entry.email)),
    byNameAgency: indexBy(before, entry => nameAgencyKey(entry.name, entry.agency)),
    working: [...before],
    unresolvedPersonaIds: new Set(state.unresolvedPersonaIds),
    signInNames,
    claimedInFile: new Set(),
    handles,
    fileKeys: new Map(),
    matchedInFile: new Map(),
    emailsInFile: new Map(),
  }
}

function fail(code: FailureCode, message: string): RowOutcome {
  return { kind: 'failed', code, message }
}

/** Guard (3): `people` count as reached by `rowNumber` (the FIRST row to reach them stays). */
function reach(context: RowContext, people: readonly RosterEntryDto[], rowNumber: number): void {
  for (const person of people) {
    if (!context.matchedInFile.has(person.id)) context.matchedInFile.set(person.id, rowNumber)
  }
}

/** `RosterWorkspace.Apply`: judges ONE row (the single add): validate, then the shared rules. */
function applyRow(context: RowContext, row: RowInput): RowOutcome {
  const invalid = validateRow(row)
  return invalid !== undefined ? fail('invalid', invalid) : applyCore(context, row, undefined)
}

/**
 * `RosterWorkspace.ApplyCore`: the rules a single add (`rowNumber` undefined) and a file row
 * share, for a VALID row. In order (frozen rules, implementation.md "Derivation and matching
 * rules"):
 *
 *  1. an unknown org persona fails the row (one message for unknown / non-org / other
 *     exercise: no oracle);
 *  2. an EXPLICIT `signInName` is never altered. If it is not an existing participant's, it
 *     fails when it equals a persona handle in the exercise or is taken (an earlier row in
 *     this file, or an account the roster does not list);
 *  3. the identity key cascades `signInName` > `email` > `name + agency` against the
 *     participants from BEFORE the request; the first key that matches is the match. A key
 *     matching MORE than one person fails the row (never guesses); a later key that matches
 *     only OTHER people fails it; a signInName match whose stored email differs fails it;
 *  4. a match is `updated` / `unchanged`, never duplicated (see {@link updateParticipant});
 *  5. otherwise a new participant (see {@link createParticipant}).
 *
 * In a file (`rowNumber` set), the person a row resolves counts as REACHED as soon as it
 * resolves them (guards 1 and 3): a later row reaching the same existing person through any
 * key fails as "same person", even if the earlier row then failed.
 */
function applyCore(context: RowContext, row: RowInput, rowNumber: number | undefined): RowOutcome {
  let org: RosterPersonaDto | undefined
  if (row.personaHandle.length > 0) {
    org = findOrgPersona(row.personaHandle)
    // An unknown handle, another exercise's handle and a non-org persona all
    // fail with the SAME message (no oracle).
    if (org === undefined) return fail('invalid', UNKNOWN_PERSONA_MESSAGE)
  }

  // An explicit sign-in name that is a participant's means THAT participant (below).
  const namesAParticipant = row.signInName.length > 0 && context.bySignInName.has(row.signInName)
  if (row.signInName.length > 0 && !namesAParticipant) {
    if (context.handles.has(row.signInName)) {
      return fail('invalid', `signInName "${row.signInName}" is the same as a persona handle.`)
    }
    if (context.claimedInFile.has(row.signInName)) {
      return fail(
        'conflict',
        `signInName "${row.signInName}" is already claimed by an earlier row in this file.`,
      )
    }
    if (context.signInNames.has(row.signInName)) {
      return fail('conflict', `signInName "${row.signInName}" is already taken by another account.`)
    }
  }

  const keys = findMatches(context, row)
  const primaryIndex = keys.findIndex(key => key.people.length > 0)
  const primary = keys[primaryIndex]
  if (primary === undefined) return createParticipant(context, row, org)
  const matches = primary.people

  // Same-file guards (1) and (3): the person this row resolves counts as reached by it NOW,
  // before any check below can fail the row. Only the PRIMARY match is recorded (every
  // candidate when it is ambiguous): recording every key's matches would make two same-name
  // people told apart by signInName "the same person".
  if (rowNumber !== undefined) {
    const earlierRow = matches
      .map(person => context.matchedInFile.get(person.id))
      .find(reachedBy => reachedBy !== undefined)
    reach(context, matches, rowNumber)
    if (matches.length === 1 && earlierRow !== undefined) {
      return fail('conflict', `duplicate of row ${earlierRow} (same person)`)
    }
  }

  // A key that names MORE than one person (two legacy "Pat Lee" rows, no agency) fails the
  // row instead of silently picking one. The server's exact words.
  if (matches.length > 1) {
    return fail(
      'conflict',
      `${MATCH_LABEL[primary.by]} matches more than one person on the roster;`
      + ' give a signInName to tell them apart.',
    )
  }

  const matched = matches[0]
  // Unreachable: the primary key has at least one match. Kept so the type narrows.
  if (matched === undefined) return createParticipant(context, row, org)

  // A later key conflicts ONLY when NONE of the people it matches is the matched person. (Without
  // that, re-uploading two same-name people told apart by signInName would fail one of them.)
  for (const later of keys.slice(primaryIndex + 1)) {
    const other = later.people[0]
    if (other !== undefined && !later.people.some(person => person.id === matched.id)) {
      // The people the conflicting key names were resolved by this row too (guard 3).
      if (rowNumber !== undefined) reach(context, later.people, rowNumber)
      return fail(
        'conflict',
        `${MATCH_LABEL[primary.by]} matches ${matched.name}`
        + ` but ${MATCH_LABEL[later.by]} matches ${other.name}.`,
      )
    }
  }

  if (
    primary.by === 'signInName'
    && row.email.length > 0
    && (matched.email ?? '').trim().length > 0
    && normalizeKey(row.email) !== normalizeKey(matched.email)
  ) {
    return fail('conflict', DIFFERENT_EMAIL_MESSAGE)
  }

  return updateParticipant(context, row, org, matched, primary.by)
}

/**
 * The identity key CASCADES (frozen rules): one entry per key the row carries, in order
 * `signInName`, `email`, `name + agency`, each with the LIST of existing participants it
 * names (empty when none). The first non-empty entry is THE match. Matching is only ever
 * against the participants from BEFORE the request.
 */
function findMatches(context: RowContext, row: RowInput): KeyMatches[] {
  const keys: KeyMatches[] = []
  if (row.signInName.length > 0) {
    keys.push({ by: 'signInName', people: context.bySignInName.get(row.signInName) ?? [] })
  }
  if (row.email.length > 0) {
    keys.push({ by: 'email', people: context.byEmail.get(normalizeKey(row.email)) ?? [] })
  }
  keys.push({
    by: 'nameAgency',
    people: context.byNameAgency.get(nameAgencyKey(row.name, row.agency)) ?? [],
  })
  return keys
}

/**
 * `RosterWorkspace.Update`: a matched participant becomes `updated` (agency, role, email, the
 * display name when matched by sign-in name or email, or the org-persona binding changed) or
 * `unchanged`. A blank cell never clears a stored value.
 */
function updateParticipant(
  context: RowContext,
  row: RowInput,
  org: RosterPersonaDto | undefined,
  matched: RosterEntryDto,
  by: MatchBy,
): RowOutcome {
  const index = context.working.findIndex(entry => entry.id === matched.id)
  const current = context.working[index] ?? matched
  let next: RosterEntryDto = current
  const changed: string[] = []

  if (row.agency.length > 0 && row.agency !== (current.agency ?? '')) {
    next = { ...next, agency: row.agency }
    changed.push('agency')
  }
  if (row.role.length > 0 && row.role !== (current.role ?? '')) {
    next = { ...next, role: row.role }
    changed.push('role')
  }
  // Emails compare case-insensitively (as the key does): a re-cased address is no change.
  if (row.email.length > 0 && normalizeKey(row.email) !== normalizeKey(current.email)) {
    next = { ...next, email: row.email }
    changed.push('email')
  }
  // The display name is only corrected when matched by sign-in name or email.
  if (by !== 'nameAgency' && row.name !== current.name) {
    next = { ...next, name: row.name }
    changed.push('name')
  }

  let bound: string | undefined
  let personaCreated = false
  if (org !== undefined && (current.persona?.id !== org.id || current.exerciseRole !== 'pio')) {
    // Bound to an org persona means pio. Rebind when the persona differs OR the role is not
    // pio (an inconsistent row is repaired). The old (auto) persona is left as it is.
    next = { ...next, persona: org, exerciseRole: 'pio' }
    bound = `persona bound to @${org.handle}`
    context.unresolvedPersonaIds.delete(next.id)
  } else if (org === undefined && current.persona === undefined) {
    // A matched participant with NO persona at all (a legacy import) gets the auto citizen
    // persona every roster participant has, so they can post. Its handle steps around every
    // handle and every sign-in name, their own included (a legacy "madonna" posts as
    // @madonna_2). The role is `participant`. No link is issued here.
    const handle = deriveAutoPersonaHandle(
      next.name,
      new Set([...context.handles, ...context.signInNames]),
    )
    context.handles.add(handle)
    next = { ...next, persona: autoPersona(handle, next.name), exerciseRole: 'participant' }
    personaCreated = true
    // A stored persona that resolves to nothing (dangling, or another exercise's) is reported
    // with ONE message: the two cases must be indistinguishable.
    bound = context.unresolvedPersonaIds.has(next.id)
      ? `persona re-created @${handle}: the previous one was not found`
      : `persona created @${handle}`
    context.unresolvedPersonaIds.delete(next.id)
  }

  // An explicit signInName that matched nobody is not applied to the matched person.
  const note = by !== 'signInName' && row.signInName.length > 0
    ? `signInName ${row.signInName} ignored: this person signs in as ${current.signInName}.`
    : undefined

  if (changed.length === 0 && bound === undefined) {
    return { kind: 'unchanged', entry: current, ...(note !== undefined ? { note } : {}) }
  }

  if (index >= 0) context.working[index] = next
  const parts: string[] = []
  if (changed.length > 0) parts.push(`${changed.join(', ')} changed`)
  if (bound !== undefined) parts.push(bound)
  const message = `${parts.join('; ')}.${note !== undefined ? ` ${note}` : ''}`
  return { kind: 'updated', entry: next, message, personaCreated }
}

/**
 * `RosterWorkspace.Create`: a new participant. The derived sign-in name steps around every
 * taken name AND every persona handle; the auto handle steps around every handle AND every
 * sign-in name, including this row's own (`Madonna` -> `madonna_2`).
 */
function createParticipant(
  context: RowContext,
  row: RowInput,
  org: RosterPersonaDto | undefined,
): RowOutcome {
  const signInName = row.signInName.length > 0
    ? row.signInName
    : deriveSignInName(row.name, new Set([...context.signInNames, ...context.handles]))
  context.signInNames.add(signInName)
  context.claimedInFile.add(signInName)

  let persona: RosterPersonaDto
  if (org !== undefined) {
    persona = org
  } else {
    // The handle steps around every handle AND every sign-in name (this row's own
    // included, just added above): a public handle never exposes a sign-in name.
    const handle = deriveAutoPersonaHandle(
      row.name,
      new Set([...context.handles, ...context.signInNames]),
    )
    context.handles.add(handle)
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
  context.working.push(entry)
  return { kind: 'created', entry, personaCreated: org === undefined }
}

// ---------------------------------------------------------------------------
// The same-file guards (RosterWorkspace.ApplyFile / ApplyFileRow)
// ---------------------------------------------------------------------------

/** A normalised row with its 1-based data-row number. */
interface FileRow {
  readonly rowNumber: number
  readonly row: RowInput
}

/** `RosterWorkspace.FileKey`: the first identity key a row carries, as the duplicate key. */
function fileKey(row: RowInput): string {
  if (row.signInName.length > 0) return `s:${row.signInName}`
  if (row.email.length > 0) return `e:${normalizeKey(row.email)}`
  return `n:${nameAgencyKey(row.name, row.agency)}`
}

/**
 * The pre-scan guard (2) needs: every name + agency that SOME row of the file ties to a
 * signInName or email, with the first such row. It reads ALL rows, earlier and later, valid
 * or not, as the server does.
 */
function keyedNameAgencyOf(rows: readonly FileRow[]): Map<string, number> {
  const keyed = new Map<string, number>()
  for (const { rowNumber, row } of rows) {
    if (row.name.length > 0 && (row.signInName.length > 0 || row.email.length > 0)) {
      const key = nameAgencyKey(row.name, row.agency)
      if (!keyed.has(key)) keyed.set(key, rowNumber)
    }
  }
  return keyed
}

/**
 * `RosterWorkspace.ApplyFileRow`: the same-file guards on top of {@link applyCore}, in the
 * server's order. VALIDATE FIRST: an invalid row reports its field error before any guard,
 * and it records nothing (no file key, no email), so it can never make a later valid row look
 * like its duplicate.
 *
 *  - guard (2): a row keyed by name + agency ALONE fails when ANY other row of the file
 *    (earlier or later) has that name + agency and a signInName or email, so the file gives
 *    the same answer on its first upload and on every re-upload;
 *  - guard (4): a row whose email an earlier row carried fails ("email also on row N"). It runs
 *    BEFORE the first-key duplicate check;
 *  - the first-key duplicate ("duplicate of row N; …"). The file key is recorded only after the
 *    guards above pass;
 *  - then the shared rules, where guards (1) and (3) live.
 */
function applyFileRow(
  context: RowContext,
  row: RowInput,
  rowNumber: number,
  keyedNameAgency: ReadonlyMap<string, number>,
): RowOutcome {
  const invalid = validateRow(row)
  if (invalid !== undefined) return fail('invalid', invalid)

  const keyedRow = keyedNameAgency.get(nameAgencyKey(row.name, row.agency))
  if (
    row.name.length > 0
    && row.signInName.length === 0
    && row.email.length === 0
    && keyedRow !== undefined
  ) {
    return fail(
      'conflict',
      `same name and agency as row ${keyedRow}: add a signInName or email to tell them apart`,
    )
  }

  if (row.email.length > 0) {
    const emailKey = normalizeKey(row.email)
    const emailRow = context.emailsInFile.get(emailKey)
    if (emailRow !== undefined) return fail('conflict', `email also on row ${emailRow}`)
    context.emailsInFile.set(emailKey, rowNumber)
  }

  const key = fileKey(row)
  const earlier = context.fileKeys.get(key)
  if (row.name.length > 0 && earlier !== undefined) {
    return fail('conflict', `duplicate of row ${earlier}; give a signInName to tell them apart`)
  }
  context.fileKeys.set(key, rowNumber)

  return applyCore(context, row, rowNumber)
}

// ---------------------------------------------------------------------------
// CSV (mock only — the live server parses uploads; the screen ships no parser)
// ---------------------------------------------------------------------------

/**
 * Mirrors `RosterCsvParser.Parse` over `AccountCsvParser.SplitLines` / `ParseLine`, so the mock
 * reads a file the way the server does: lines are split first (`\n`, `\r\n` or a lone `\r`)
 * and each line is parsed ON ITS OWN, so a quote never carries over a line break. A newline
 * inside a quoted cell is therefore NOT supported: it splits the row in two, exactly as on
 * the server (the roster screen tells staff to save the file as plain CSV).
 */
function splitLines(content: string): string[] {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

/** `AccountCsvParser.ParseLine`: commas, optional double-quote wrapping, `""` is a quote. */
function parseLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < line.length; i += 1) {
    const ch = line.charAt(i)
    if (quoted) {
      if (ch === '"' && line.charAt(i + 1) === '"') {
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
      cells.push(cell)
      cell = ''
    } else {
      cell += ch
    }
  }
  cells.push(cell)
  return cells
}

type RosterColumn = 'name' | 'agency' | 'role' | 'email' | 'personaHandle' | 'signInName'

const HEADER_ALIASES: Readonly<Record<string, RosterColumn>> = {
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

const NO_HEADER_ERROR = 'the CSV has no header row.'
const NO_NAME_COLUMN_ERROR =
  'the CSV header must include a "name" column (or its alias "displayName").'

interface ParsedRosterCsv {
  /** Set when the whole file is refused (the endpoint answers 400 and writes nothing). */
  readonly error?: string
  /** The data rows, in order (blank lines and the header are not counted). */
  readonly rows: readonly RosterRowWrite[]
}

/**
 * `RosterCsvParser.Parse`: a leading BOM is tolerated, unknown columns are ignored, blank
 * lines (and a line of nothing but commas) are skipped and not counted, header names match
 * case-insensitively and WHEN A COLUMN APPEARS TWICE THE FIRST ONE WINS. Fails closed on no
 * header, no `name` column, or more than 5000 data rows.
 */
function parseRosterCsv(text: string): ParsedRosterCsv {
  let columns: Map<RosterColumn, number> | undefined
  const rows: RosterRowWrite[] = []

  for (const line of splitLines(text.replace(/^\uFEFF+/, ''))) {
    if (line.trim().length === 0) continue
    const cells = parseLine(line)
    if (cells.every(cell => cell.trim().length === 0)) continue

    if (columns === undefined) {
      const header = new Map<RosterColumn, number>()
      cells.forEach((cell, position) => {
        const column = HEADER_ALIASES[cell.trim().replace(/^\uFEFF+/, '').trim().toLowerCase()]
        if (column !== undefined && !header.has(column)) header.set(column, position)
      })
      if (!header.has('name')) return { error: NO_NAME_COLUMN_ERROR, rows: [] }
      columns = header
      continue
    }

    if (rows.length === MAX_IMPORT_ROWS) {
      return { error: `the CSV exceeds the maximum of ${MAX_IMPORT_ROWS} data rows.`, rows: [] }
    }
    const cellFor = (column: RosterColumn): string => {
      const position = columns?.get(column)
      return position === undefined ? '' : cells[position] ?? ''
    }
    rows.push({
      name: cellFor('name'),
      agency: cellFor('agency'),
      role: cellFor('role'),
      email: cellFor('email'),
      personaHandle: cellFor('personaHandle'),
      signInName: cellFor('signInName'),
    })
  }

  return columns === undefined ? { error: NO_HEADER_ERROR, rows: [] } : { rows }
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

/**
 * `POST /staff/roster` (`RosterService.AddAsync`): ONE row through `RosterWorkspace.Apply`.
 * 400 for an invalid value, 409 for a clash or for anyone already on the roster; a single add
 * never commits an update, only a creation.
 */
function addParticipant(config: InternalAxiosRequestConfig) {
  const row = toRowInput(asRowWrite(parseJsonBody(config.data)))
  const context = makeContext()
  const outcome = applyRow(context, row)

  if (outcome.kind === 'failed') {
    return reject(config, outcome.code === 'invalid' ? 400 : 409, outcome.message)
  }
  if (outcome.kind !== 'created') {
    return reject(config, 409, ALREADY_ON_ROSTER_MESSAGE)
  }
  state.entries = context.working
  state.unresolvedPersonaIds = context.unresolvedPersonaIds
  return respond(config, { ...outcome.entry, link: { ...outcome.entry.link } }, 201)
}

/** `RosterService.ToReportRow`: one outcome as the wire's per-row report. */
function toReportRow(rowNumber: number, row: RowInput, outcome: RowOutcome): RosterImportRowDto {
  if (outcome.kind === 'failed') {
    return {
      rowNumber,
      name: row.name,
      ...(row.signInName.length > 0 ? { signInName: row.signInName } : {}),
      status: 'failed',
      personaCreated: false,
      message: outcome.message,
    }
  }
  // An `unchanged` row carries a message only when it has a note (an ignored signInName).
  const message = outcome.kind === 'updated'
    ? outcome.message
    : outcome.kind === 'unchanged' ? outcome.note : undefined
  return {
    rowNumber,
    name: outcome.entry.name,
    signInName: outcome.entry.signInName,
    status: outcome.kind,
    ...(outcome.entry.persona ? { personaHandle: outcome.entry.persona.handle } : {}),
    personaCreated: outcome.kind === 'created' || outcome.kind === 'updated'
      ? outcome.personaCreated
      : false,
    ...(message !== undefined ? { message } : {}),
  }
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

  const parsed = parseRosterCsv(await readFileText(file))
  if (parsed.error !== undefined) return reject(config, 400, parsed.error)

  const inputs: FileRow[] = parsed.rows.map((write, index) => ({
    rowNumber: index + 1,
    row: toRowInput(write),
  }))
  const context = makeContext()
  const keyedNameAgency = keyedNameAgencyOf(inputs)
  const rows = inputs.map(({ rowNumber, row }) =>
    toReportRow(rowNumber, row, applyFileRow(context, row, rowNumber, keyedNameAgency)))

  // A dry run reports the SAME thing and writes nothing.
  if (!dryRun) {
    state.entries = context.working
    state.unresolvedPersonaIds = context.unresolvedPersonaIds
  }

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
