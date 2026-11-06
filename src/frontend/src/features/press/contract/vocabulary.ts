/**
 * features/press/contract/vocabulary.ts
 * ---------------------------------------------------------------------------
 * PC-1, the frozen press-room vocabulary (press-room story 01, #738; see
 * docs/features/press-room/implementation.md). The TS twin of
 * `Features/Press/Contracts/PressVocabulary.cs`: every list and limit here
 * equals the C# one, both pinned by `pressWireContract.json`.
 *
 * Additive-only after story 01, through the orchestrator. The guards are
 * CLOSED over these lists (fail-closed): a release state the client does not
 * know makes the whole read out of shape.
 *
 * `PARTICIPANT_PAYLOAD_KEYS` is the participant-safe projection of a release
 * payload (XC-002); `STAFF_ONLY_PAYLOAD_KEYS` never reach a participant read,
 * and `isReleaseParticipantPayload` rejects a payload that carries one.
 *
 * World: both (types only). No React, no MUI.
 */

/** The E5 release states, in lifecycle order. */
export const RELEASE_STATES = [
  'draft',
  'scheduled',
  'pending_approval',
  'returned',
  'published',
  'retracted',
] as const
export type ReleaseState = (typeof RELEASE_STATES)[number]

/** How the release body is authored: rich text, a PDF attachment, or both. */
export const INPUT_PATHS = ['rich', 'attachment', 'both'] as const
export type InputPath = (typeof INPUT_PATHS)[number]

/** The `ext.press` keys an org newsroom outlet's letterhead is read from. */
export const LETTERHEAD_EXT_KEYS = [
  'letterheadAddress',
  'letterheadContactName',
  'letterheadContactTitle',
  'letterheadContactPhone',
  'letterheadContactEmail',
] as const
export type LetterheadExtKey = (typeof LETTERHEAD_EXT_KEYS)[number]

/** The slug of the platform's default press outlet (The Wire Room). */
export const WIRE_ROOM_SLUG = 'wire-room'

/** PC-1 length caps: the single source for the server guard and the composer form. */
export const PRESS_LIMITS = {
  contactNameMaxLength: 120,
  contactTitleMaxLength: 120,
  contactPhoneMaxLength: 40,
  contactEmailMaxLength: 254,
  datelineMaxLength: 120,
  boilerplateMaxLength: 2000,
  crossPostTextMaxLength: 280,
  dekMaxLength: 160,
  letterheadAddressMaxLength: 300,
} as const

/** The keys of the participant-safe release payload (and nothing else). */
export const PARTICIPANT_PAYLOAD_KEYS = ['org', 'contact', 'dateline', 'document'] as const

/**
 * Payload keys that must never appear on a participant read (XC-002): the
 * staff-set and author-only PC-1 fields.
 */
export const STAFF_ONLY_PAYLOAD_KEYS = [
  'crossPost',
  'approval',
  'inputPath',
  'boilerplate',
  'orgPersonaId',
] as const

export function isReleaseState(value: unknown): value is ReleaseState {
  return typeof value === 'string' && (RELEASE_STATES as readonly string[]).includes(value)
}

export function isInputPath(value: unknown): value is InputPath {
  return typeof value === 'string' && (INPUT_PATHS as readonly string[]).includes(value)
}
