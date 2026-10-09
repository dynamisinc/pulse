/**
 * features/controller/personaEdit/personaEditForm.ts
 * ---------------------------------------------------------------------------
 * The PURE form model of the persona profile edit (demo-polish story 21 /
 * PE-FE): limits, validation, and — the load-bearing part — the diff that turns
 * the dialog's draft into a JSON merge-patch body. No React, no I/O, no theme.
 *
 * ## The diff is the contract (RFC 7396)
 * `buildPersonaPatch(persona, draft)` returns ONLY what changed:
 *   - an unchanged field is OMITTED (absent = unchanged), so saving a bio edit
 *     never re-sends — and so can never clobber — a name or an avatar another
 *     controller changed meanwhile;
 *   - clearing a clearable field is `null`, NEVER `""` (the server reads `""` as
 *     "sanitize to empty", which it would also turn into a clear, but the wire
 *     contract is `null`, and `displayName` must never be cleared);
 *   - the result is an empty object when nothing changed — valid on the wire
 *     (`{}` is a 200 no-op) but the dialog refuses to send it (Save is disabled)
 *     so a no-op never reaches the audit trail as a `persona_edit` event.
 * The persona is never echoed: no `id`, `avatarUrl`, `handle`, ... can appear.
 *
 * ## Limits and refusals mirror the server (PE-BE)
 * displayName 1..100, bio <= 512, location <= 100, measured on the TRIMMED text in
 * UTF-16 code UNITS — the server's `string.Length`, so an emoji counts as 2 — and the
 * text is never truncated (see `textRules.ts`: a cut through a surrogate pair is a
 * server 400). Also refused,
 * as the server refuses them: raw text longer than 4x the bound (spaces and line
 * breaks count), a lone surrogate, C0/C1 control characters and bidi overrides in
 * any of the three fields, and a display name with no visible character. The
 * server sanitizes first (markup stripped, NFR-004) and is the authority; these
 * client checks are a courtesy so an obviously-bad edit does not cost a round trip,
 * and whatever the server still refuses is shown to the controller verbatim.
 * Look-alike names are allowed (SOC-052) and not detected.
 */

import type { StaffPersona } from '@/features/personas'
import {
  hasBidiOverride,
  hasControlCharacter,
  hasLoneSurrogate,
  hasVisibleCharacter,
  textLength,
} from './textRules'
import type {
  DraftProblems,
  PersonaEditDraft,
  PersonaEditField,
  PersonaPatch,
  ImageChoice,
} from './types'

export const DISPLAY_NAME_MAX = 100
export const BIO_MAX = 512
export const LOCATION_MAX = 100

/** The server refuses raw text longer than this many times a field's bound (before sanitizing). */
export const RAW_LENGTH_FACTOR = 4

/**
 * The bio is multi-line, so TAB / LF / CR are allowed in it even though other C0
 * controls are not (PE-BE's final contract: "line breaks and tabs are allowed").
 * The display name and the location refuse every control character.
 */
export const BIO_ALLOWS_LAYOUT_WHITESPACE = true

/** Canonical order of the editable fields (also the order of telemetry `fields`). */
export const PERSONA_EDIT_FIELD_ORDER: readonly PersonaEditField[] = [
  'displayName',
  'bio',
  'location',
  'verified',
  'avatarMediaId',
  'bannerMediaId',
]

/** The persona members the form reads. */
export type EditablePersonaView = Pick<
  StaffPersona,
  'displayName' | 'bio' | 'location' | 'verified'
>

/** A fresh draft that reproduces `persona` exactly (so the initial diff is empty). */
export function draftFromPersona(persona: EditablePersonaView): PersonaEditDraft {
  return {
    displayName: persona.displayName,
    bio: persona.bio ?? '',
    location: persona.location ?? '',
    verified: persona.verified,
    avatar: { mode: 'keep' },
    banner: { mode: 'keep' },
  }
}

interface TextRule {
  readonly label: string
  readonly max: number
  /** The display name must have a visible character; the others may be empty. */
  readonly requireVisible: boolean
  readonly allowLayoutWhitespace: boolean
}

/** The first problem with one text field's raw value, or `undefined` when it is fine. */
function textProblem(raw: string, rule: TextRule): string | undefined {
  const { label, max } = rule
  if (hasLoneSurrogate(raw)) {
    return `${label} contains a broken character (half of an emoji or symbol). Remove it to save.`
  }
  if (hasControlCharacter(raw, rule.allowLayoutWhitespace)) {
    return `${label} can't contain control characters. Remove them to save.`
  }
  if (hasBidiOverride(raw)) {
    return `${label} can't contain text-direction override characters. Remove them to save.`
  }

  const rawLength = textLength(raw)
  if (rawLength > RAW_LENGTH_FACTOR * max) {
    return `${label} must be at most ${max} characters. This text is ${rawLength} characters `
      + 'long counting spaces and line breaks.'
  }

  const trimmed = raw.trim()
  const length = textLength(trimmed)
  if (rule.requireVisible) {
    if (length === 0) return `${label} is required.`
    if (!hasVisibleCharacter(trimmed)) return `${label} needs at least one visible character.`
  }
  if (length > max) return `${label} must be at most ${max} characters (${length - max} over).`
  return undefined
}

const DISPLAY_NAME_RULE: TextRule = {
  label: 'Display name',
  max: DISPLAY_NAME_MAX,
  requireVisible: true,
  allowLayoutWhitespace: false,
}
const BIO_RULE: TextRule = {
  label: 'Bio',
  max: BIO_MAX,
  requireVisible: false,
  allowLayoutWhitespace: BIO_ALLOWS_LAYOUT_WHITESPACE,
}
const LOCATION_RULE: TextRule = {
  label: 'Location',
  max: LOCATION_MAX,
  requireVisible: false,
  allowLayoutWhitespace: false,
}

/**
 * Field-level problems in `draft`. Empty object = the draft is valid. Counted on
 * the trimmed text in UTF-16 units, like the server; the text is never cut.
 */
export function validateDraft(draft: PersonaEditDraft): DraftProblems {
  const displayName = textProblem(draft.displayName, DISPLAY_NAME_RULE)
  const bio = textProblem(draft.bio, BIO_RULE)
  const location = textProblem(draft.location, LOCATION_RULE)
  return {
    ...(displayName !== undefined ? { displayName } : {}),
    ...(bio !== undefined ? { bio } : {}),
    ...(location !== undefined ? { location } : {}),
  }
}

/** The length the counters show: the trimmed text, in UTF-16 units (the server's measure). */
export function countedLength(text: string): number {
  return textLength(text.trim())
}

/** True when {@link validateDraft} found nothing wrong. */
export function isDraftValid(draft: PersonaEditDraft): boolean {
  return Object.keys(validateDraft(draft)).length === 0
}

/**
 * The merge-patch value of an image choice, or `undefined` for "leave alone".
 * `clear` is ALWAYS `null` — never decided from `avatarUrl` / `bannerUrl`: the staff
 * DTO carries only the signed read URL (no media id, no has-image flag), and the URL
 * is absent when the persona has no image OR when signing it failed. A controller who
 * explicitly chose Remove gets the `null` (idempotent on the server if nothing is set).
 */
function imagePatchValue(choice: ImageChoice): string | null | undefined {
  switch (choice.mode) {
    case 'set':
      return choice.mediaId
    case 'clear':
      return null
    case 'keep':
      return undefined
  }
}

/** Diff of one clearable text field: absent / `null` (clear) / the trimmed value. */
function textPatchValue(
  draftText: string,
  personaText: string | undefined,
): string | null | undefined {
  const next = draftText.trim()
  const previous = (personaText ?? '').trim()
  if (next === previous) return undefined
  return next === '' ? null : next
}

/**
 * The JSON merge-patch body for turning `persona` into `draft`: only changed
 * fields, `null` to clear, never `""`, never the whole persona. See the module
 * header.
 */
export function buildPersonaPatch(
  persona: EditablePersonaView,
  draft: PersonaEditDraft,
): PersonaPatch {
  const displayName = draft.displayName.trim()
  const bio = textPatchValue(draft.bio, persona.bio)
  const location = textPatchValue(draft.location, persona.location)
  const avatarMediaId = imagePatchValue(draft.avatar)
  const bannerMediaId = imagePatchValue(draft.banner)

  return {
    ...(displayName !== persona.displayName ? { displayName } : {}),
    ...(bio !== undefined ? { bio } : {}),
    ...(location !== undefined ? { location } : {}),
    ...(draft.verified !== persona.verified ? { verified: draft.verified } : {}),
    ...(avatarMediaId !== undefined ? { avatarMediaId } : {}),
    ...(bannerMediaId !== undefined ? { bannerMediaId } : {}),
  }
}

/**
 * The NAMES of the fields a patch changes, in canonical order — the `fields`
 * member of the `persona_edit` telemetry payload. Names only: never a value
 * (implementation.md §1.8), so a bio or a new name can never leak into the
 * event stream.
 */
export function patchFieldNames(patch: PersonaPatch): PersonaEditField[] {
  return PERSONA_EDIT_FIELD_ORDER.filter(field => Object.hasOwn(patch, field))
}

/** True when the patch changes nothing. */
export function isPatchEmpty(patch: PersonaPatch): boolean {
  return patchFieldNames(patch).length === 0
}
