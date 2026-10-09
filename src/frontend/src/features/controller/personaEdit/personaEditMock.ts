/**
 * features/controller/personaEdit/personaEditMock.ts
 * ---------------------------------------------------------------------------
 * The MOCK adapter for the persona profile edit (demo-polish story 21 / PE-FE).
 * Dev/UAT-on-mock-data and tests ONLY — `personaEditService` routes through this
 * only when `USE_MOCK_DATA` is true (the one flip point, `@/core/config/mockData`).
 *
 * It re-implements PE-BE's SHIPPED contract (`PATCH /api/staff/personas/{id}`,
 * JSON merge-patch / RFC 7396) closely enough that the console behaves in mock
 * mode exactly as it will against the real server — including the EXACT 400 texts
 * (`PersonaAdminMessages`), because the console shows the server's text to the
 * controller verbatim and a mock that worded things differently would let a UI
 * built against it look right and read wrong live.
 *
 *   absent field          unchanged
 *   null                  clears — ONLY bio, location, avatarMediaId, bannerMediaId
 *   displayName           1..100 after sanitize+trim; not null
 *   bio / location        <= 512 / <= 100 after sanitize+trim; "" after sanitize => cleared
 *   verified              boolean; not null
 *   avatarMediaId /       an IMAGE asset (mock media registry); anything else —
 *   bannerMediaId         unknown id, a video — is the one 400 text
 *   handle, kind, personaType, exerciseId, any unknown field   400 (never ignored)
 *   `{}`                  valid, 200, no change
 *   body > 16384 bytes    400
 *   unknown persona       404 with an empty body
 *   Content-Type          application/merge-patch+json or application/json, else 415
 *
 * PE-BE Gate-1 fold (5cee307; text hygiene) — lengths are UTF-16 UNITS (`.length`, the
 * server's `string.Length`: an emoji counts 2) and:
 *   - raw text longer than 4x the field's bound (displayName > 400, bio > 2048,
 *     location > 400) is refused BEFORE sanitizing, with the field's ordinary
 *     length message;
 *   - a lone UTF-16 surrogate anywhere => the "must be a JSON object ..." 400;
 *   - C0/C1 control characters and bidi overrides (U+202A-202E, U+2066-2069) in
 *     displayName, bio or location => 400 (the bio alone may carry CR / LF / TAB);
 *   - a displayName with no visible character => 400;
 *   - look-alike (homoglyph) names are ALLOWED (SOC-052);
 *   - any Content-Type other than application/json or application/merge-patch+json
 *     (charset parameter fine) => 415.
 * The texts below are the server's own (PersonaAdminMessages, after the fold). The
 * console never depends on them: it shows whatever sentence the server sends,
 * verbatim.
 *
 * Validation order mirrors the server's: body (400) -> persona (404) -> media
 * (400). A refusal writes nothing.
 *
 * ## "Mock mode edits the mock directory"
 * The mock persona DIRECTORY is `SEEDED_PERSONAS` (`features/personas`): the array
 * both mock read adapters (`resolvePersonas` / `resolveStaffPersonas`) and
 * `personaById` re-read on every request. A successful mock edit REPLACES the
 * edited element in that array (the persona objects themselves stay immutable
 * snapshots — a held reference never changes under a component), so after
 * `invalidatePersonas()` every mounted persona hook — the console picker, the
 * participant feed's author lookup — re-resolves and shows the new name, bio and
 * avatar. The array is typed `readonly` for everyone else; this module is its one
 * sanctioned writer, and {@link resetMockPersonaEdits} puts every pristine seed
 * back (tests; also useful from a dev console).
 *
 * `initials` are RE-DERIVED from the new display name on a rename, by the server's rule
 * ({@link initialsForDisplayName}: the first UTF-16 unit of each of the first two
 * space-separated words, upper-cased) — the real server derives them from the name on
 * every read, so a rename changes the monogram live. `avatarColor` is derived from the
 * HANDLE, which cannot change, so it stays as seeded.
 *
 * Sanitization (NFR-004): the real server strips markup from the three text
 * fields with `PostSanitizer`; the mock uses the client's equivalent
 * (`sanitizeText`, strip-not-encode) so `<script>` in a bio never lands in the
 * mock directory either.
 */

import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { getMockMediaAsset } from '@/core/media'
import { SEEDED_PERSONAS, type StaffPersona } from '@/features/personas'
import { BIO_ALLOWS_LAYOUT_WHITESPACE } from './personaEditForm'
import { sanitizeText } from '@/features/social/services/sanitize'
import {
  hasBidiOverride,
  hasControlCharacter,
  hasLoneSurrogate,
  hasVisibleCharacter,
  textLength,
} from './textRules'

/** The server's refusal texts (`PersonaAdminMessages`) — verbatim. */
export const PERSONA_ADMIN_MESSAGES = {
  bodyNotObject:
    'The request body must be a JSON object naming the fields to change (JSON merge-patch).',
  bodyTooLarge: 'The request body must be at most 16384 bytes.',
  displayNameNull: 'displayName cannot be null.',
  displayNameNotString: 'displayName must be a string.',
  displayNameLength: 'displayName must be 1 to 100 characters.',
  displayNameInvisible: 'displayName must contain at least one visible character.',
  displayNameControlOrBidi:
    'displayName must not contain control characters or bidirectional override characters.',
  bioControlOrBidi:
    'bio must not contain control characters (line breaks and tabs are allowed) or '
    + 'bidirectional override characters.',
  locationControlOrBidi:
    'location must not contain control characters or bidirectional override characters.',
  unsupportedContentType:
    'Content-Type must be application/json or application/merge-patch+json.',
  bioNotString: 'bio must be a string or null.',
  bioTooLong: 'bio must be at most 512 characters.',
  locationNotString: 'location must be a string or null.',
  locationTooLong: 'location must be at most 100 characters.',
  verifiedNull: 'verified cannot be null.',
  verifiedNotBoolean: 'verified must be true or false.',
  avatarNotImage: 'avatarMediaId must name an image in this exercise, or be null to clear it.',
  bannerNotImage: 'bannerMediaId must name an image in this exercise, or be null to clear it.',
  /** `handle cannot be changed.` / `kind ...` / `personaType ...` / `exerciseId ...`. */
  immutable: (field: string) => `${field} cannot be changed.`,
  unknownField: (field: string) =>
    `Unknown field '${field}'. Editable fields: displayName, bio, location, verified, ` +
    'avatarMediaId, bannerMediaId.',
} as const

const MAX_BODY_BYTES = 16384
/** Raw text longer than this many times a field's bound is refused before sanitizing. */
const RAW_LENGTH_FACTOR = 4
const IMMUTABLE_FIELDS: readonly string[] = ['handle', 'kind', 'personaType', 'exerciseId']
const EDITABLE_FIELDS: readonly string[] = [
  'displayName',
  'bio',
  'location',
  'verified',
  'avatarMediaId',
  'bannerMediaId',
]

// ---------------------------------------------------------------------------
// The mock persona directory
// ---------------------------------------------------------------------------

/** First-write snapshots of the seeds, so {@link resetMockPersonaEdits} can undo edits. */
const pristineSeeds = new Map<string, StaffPersona>()

/** `SEEDED_PERSONAS` as the writable array it really is at runtime (see the header). */
function directory(): StaffPersona[] {
  return SEEDED_PERSONAS as StaffPersona[]
}

/** Replaces the directory entry with the same id; returns false when there is none. */
function replaceInDirectory(next: StaffPersona): boolean {
  const entries = directory()
  const index = entries.findIndex(entry => entry.id === next.id)
  const current = entries[index]
  if (current === undefined) return false
  if (!pristineSeeds.has(current.id)) pristineSeeds.set(current.id, current)
  entries[index] = next
  return true
}

/** Test/dev: restores every edited persona to its seeded state. */
export function resetMockPersonaEdits(): void {
  const entries = directory()
  for (const [id, pristine] of pristineSeeds) {
    const index = entries.findIndex(entry => entry.id === id)
    if (index >= 0) entries[index] = pristine
  }
  pristineSeeds.clear()
}

// ---------------------------------------------------------------------------
// Validation (server order: body -> persona -> media)
// ---------------------------------------------------------------------------

type MockPatchFailure = { readonly ok: false; readonly message: string }

/** A validated, sanitized patch: only the members the body actually named. */
interface ParsedPatch {
  readonly displayName?: string
  readonly bio?: string | null
  readonly location?: string | null
  readonly verified?: boolean
  readonly avatarMediaId?: string | null
  readonly bannerMediaId?: string | null
}

function fail(message: string): MockPatchFailure {
  return { ok: false, message }
}

/** Sanitizes and trims; empty after sanitizing means "cleared". */
function cleanedText(value: string): string | null {
  const cleaned = sanitizeText(value).trim()
  return cleaned === '' ? null : cleaned
}

/** The order the server checks a text value in; `undefined` = the value passes. */
function textHygieneFailure(
  value: string,
  max: number,
  messages: { readonly tooLong: string; readonly controlOrBidi: string },
  allowLayoutWhitespace: boolean,
): MockPatchFailure | undefined {
  if (hasLoneSurrogate(value)) return fail(PERSONA_ADMIN_MESSAGES.bodyNotObject)
  if (textLength(value) > RAW_LENGTH_FACTOR * max) return fail(messages.tooLong)
  if (hasControlCharacter(value, allowLayoutWhitespace) || hasBidiOverride(value)) {
    return fail(messages.controlOrBidi)
  }
  return undefined
}

/** Validates one clearable text field (`bio`, `location`). */
function parseClearableText(
  value: unknown,
  max: number,
  messages: { notString: string; tooLong: string; controlOrBidi: string },
  allowLayoutWhitespace: boolean,
): { readonly ok: true; readonly value: string | null } | MockPatchFailure {
  if (value === null) return { ok: true, value: null }
  if (typeof value !== 'string') return fail(messages.notString)
  const refused = textHygieneFailure(value, max, messages, allowLayoutWhitespace)
  if (refused !== undefined) return refused
  const cleaned = cleanedText(value)
  if (cleaned !== null && textLength(cleaned) > max) return fail(messages.tooLong)
  return { ok: true, value: cleaned }
}

/**
 * Validates the body against the contract, WITHOUT the media-existence check
 * (that needs the persona's exercise and so comes after the 404 check).
 */
function parseBody(
  raw: unknown,
): { readonly ok: true; readonly patch: ParsedPatch } | MockPatchFailure {
  const text = typeof raw === 'string' ? raw : ''
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return fail(PERSONA_ADMIN_MESSAGES.bodyTooLarge)
  }

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return fail(PERSONA_ADMIN_MESSAGES.bodyNotObject)
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail(PERSONA_ADMIN_MESSAGES.bodyNotObject)
  }
  const record = body as Record<string, unknown>

  for (const key of Object.keys(record)) {
    if (IMMUTABLE_FIELDS.includes(key)) return fail(PERSONA_ADMIN_MESSAGES.immutable(key))
    if (!EDITABLE_FIELDS.includes(key)) return fail(PERSONA_ADMIN_MESSAGES.unknownField(key))
  }

  const patch: { -readonly [K in keyof ParsedPatch]: ParsedPatch[K] } = {}

  if ('displayName' in record) {
    const value = record.displayName
    if (value === null) return fail(PERSONA_ADMIN_MESSAGES.displayNameNull)
    if (typeof value !== 'string') return fail(PERSONA_ADMIN_MESSAGES.displayNameNotString)
    const refused = textHygieneFailure(
      value,
      100,
      {
        tooLong: PERSONA_ADMIN_MESSAGES.displayNameLength,
        controlOrBidi: PERSONA_ADMIN_MESSAGES.displayNameControlOrBidi,
      },
      false,
    )
    if (refused !== undefined) return refused
    const cleaned = cleanedText(value)
    if (cleaned === null || textLength(cleaned) > 100) {
      return fail(PERSONA_ADMIN_MESSAGES.displayNameLength)
    }
    if (!hasVisibleCharacter(cleaned)) return fail(PERSONA_ADMIN_MESSAGES.displayNameInvisible)
    patch.displayName = cleaned
  }
  if ('bio' in record) {
    const parsed = parseClearableText(
      record.bio,
      512,
      {
        notString: PERSONA_ADMIN_MESSAGES.bioNotString,
        tooLong: PERSONA_ADMIN_MESSAGES.bioTooLong,
        controlOrBidi: PERSONA_ADMIN_MESSAGES.bioControlOrBidi,
      },
      BIO_ALLOWS_LAYOUT_WHITESPACE,
    )
    if (!parsed.ok) return parsed
    patch.bio = parsed.value
  }
  if ('location' in record) {
    const parsed = parseClearableText(
      record.location,
      100,
      {
        notString: PERSONA_ADMIN_MESSAGES.locationNotString,
        tooLong: PERSONA_ADMIN_MESSAGES.locationTooLong,
        controlOrBidi: PERSONA_ADMIN_MESSAGES.locationControlOrBidi,
      },
      false,
    )
    if (!parsed.ok) return parsed
    patch.location = parsed.value
  }
  if ('verified' in record) {
    const value = record.verified
    if (value === null) return fail(PERSONA_ADMIN_MESSAGES.verifiedNull)
    if (typeof value !== 'boolean') return fail(PERSONA_ADMIN_MESSAGES.verifiedNotBoolean)
    patch.verified = value
  }
  // Media members: shape only here (string or null); existence/kind after the 404 check.
  for (const field of ['avatarMediaId', 'bannerMediaId'] as const) {
    if (!(field in record)) continue
    const value = record[field]
    if (value !== null && typeof value !== 'string') {
      return fail(
        field === 'avatarMediaId'
          ? PERSONA_ADMIN_MESSAGES.avatarNotImage
          : PERSONA_ADMIN_MESSAGES.bannerNotImage,
      )
    }
    patch[field] = value
  }

  return { ok: true, patch }
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

function refuse(
  config: InternalAxiosRequestConfig,
  status: number,
  statusText: string,
  data: unknown,
): Promise<never> {
  return Promise.reject(
    new AxiosError(
      `Request failed with status code ${status}`,
      status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
      config,
      null,
      { data, status, statusText, headers: {}, config },
    ),
  )
}

/** The persona id of `/staff/personas/{id}` (the last path segment), decoded. */
function personaIdOf(url: string | undefined): string {
  const segment = (url ?? '').split('?')[0]?.split('/').pop() ?? ''
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * The server's `PersonaDerivedPresentation.InitialsForDisplayName`: split on spaces
 * (trimming entries, dropping empty ones), take up to the first TWO words, and for
 * each its first UTF-16 unit (`w[0]`) upper-cased invariantly. No grapheme handling,
 * exactly like the server — so a word that starts with an emoji yields a lone
 * high surrogate (a tracked backend issue; the browser draws it as a replacement mark).
 */
export function initialsForDisplayName(displayName: string): string {
  const words = displayName
    .split(' ')
    .map(word => word.trim())
    .filter(word => word.length > 0)
  let initials = ''
  for (let index = 0; index < words.length && index < 2; index += 1) {
    const first = (words[index] ?? '').charAt(0)
    // .NET's char.ToUpperInvariant maps one unit to one unit; JS may expand ('ß' -> 'SS').
    const upper = first.toUpperCase()
    initials += upper.length === 1 ? upper : first
  }
  return initials
}

/**
 * Applies a validated patch to `current`. `null` removes the optional member (the
 * server's response omits absent members — never `null`).
 */
function applyPatch(
  current: StaffPersona,
  patch: ParsedPatch,
  urls: { readonly avatarUrl?: string; readonly bannerUrl?: string },
): StaffPersona {
  const { bio, location, avatarUrl, bannerUrl, ...rest } = current
  const nextBio = patch.bio === undefined ? bio : (patch.bio ?? undefined)
  const nextLocation = patch.location === undefined ? location : (patch.location ?? undefined)
  const nextAvatarUrl = patch.avatarMediaId === undefined ? avatarUrl : urls.avatarUrl
  const nextBannerUrl = patch.bannerMediaId === undefined ? bannerUrl : urls.bannerUrl
  return {
    ...rest,
    displayName: patch.displayName ?? current.displayName,
    initials:
      patch.displayName !== undefined
        ? initialsForDisplayName(patch.displayName)
        : current.initials,
    verified: patch.verified ?? current.verified,
    ...(nextBio !== undefined ? { bio: nextBio } : {}),
    ...(nextLocation !== undefined ? { location: nextLocation } : {}),
    ...(nextAvatarUrl !== undefined ? { avatarUrl: nextAvatarUrl } : {}),
    ...(nextBannerUrl !== undefined ? { bannerUrl: nextBannerUrl } : {}),
  }
}

/**
 * `PATCH /staff/personas/{id}` against the mock directory. See the module header.
 */
export const personaPatchMockAdapter: AxiosAdapter = async config => {
  // The server accepts only these two media types for the body (415 otherwise).
  const contentType = String(config.headers?.get('Content-Type') ?? '').toLowerCase()
  if (
    !contentType.startsWith('application/merge-patch+json')
    && !contentType.startsWith('application/json')
  ) {
    return refuse(
      config,
      415,
      'Unsupported Media Type',
      PERSONA_ADMIN_MESSAGES.unsupportedContentType,
    )
  }

  const parsed = parseBody(config.data)
  if (!parsed.ok) return refuse(config, 400, 'Bad Request', parsed.message)

  const personaId = personaIdOf(config.url)
  const current = directory().find(entry => entry.id === personaId)
  if (current === undefined) return refuse(config, 404, 'Not Found', '')

  // Media: an image asset, or null to clear. Same text for unknown and non-image.
  const urls: { avatarUrl?: string; bannerUrl?: string } = {}
  for (const [field, message, target] of [
    ['avatarMediaId', PERSONA_ADMIN_MESSAGES.avatarNotImage, 'avatarUrl'],
    ['bannerMediaId', PERSONA_ADMIN_MESSAGES.bannerNotImage, 'bannerUrl'],
  ] as const) {
    const id = parsed.patch[field]
    if (id === undefined || id === null) continue
    const asset = getMockMediaAsset(id)
    if (asset === undefined || asset.kind !== 'image') return refuse(config, 400, 'Bad Request', message)
    urls[target] = asset.url
  }

  const updated = applyPatch(current, parsed.patch, urls)
  replaceInDirectory(updated)
  return { data: updated, status: 200, statusText: 'OK', headers: {}, config }
}
