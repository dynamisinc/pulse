/**
 * features/controller/runSheet/runSheetSchema.ts
 * ---------------------------------------------------------------------------
 * THE ONE MODULE that defines the run-sheet FILE FORMAT `pulse.runsheet.v1`
 * (demo-polish C3, story 19; implementation.md §1.9). STAFF world (controller
 * console) — pure data/validation, no UI, no React, no participant import.
 *
 * WHO READS THIS. Everything that touches a sheet's *definition* goes through
 * here, so there is exactly one set of limits and one validator:
 *   - the JSON import / export (`parseRunSheetFile`, `serializeRunSheetFile`);
 *   - the beat editor (`validateBeat` — the same zod schema, so a beat the editor
 *     accepts is a beat the importer accepts);
 *   - the browser-storage loader (`runSheetStorage.ts` re-uses `beatSchema` and
 *     `checkSheetConsistency`, so a corrupt stored sheet fails closed too);
 *   - S1's docs / the seeder's run-sheet export reference this file as the
 *     schema's source of truth (the PowerShell seeder writes what this accepts).
 *
 * WHAT THE FILE IS — AND IS NOT. A *definition* of staged posts ("beats") and
 * nothing else. Status (`pending | fired | skipped | failed`), `firedPostId`,
 * failures and the in-flight marker live in browser storage only
 * (`runSheetStorage.ts`) and are NEVER exported: an exported sheet is a script,
 * not a log. The file also carries no `exerciseId` (scope is server-side,
 * COR-001) and nothing a participant should ever see beyond what a persona
 * would post.
 *
 *   {
 *     "schema": "pulse.runsheet.v1",
 *     "name": "Water crisis demo",                  // 1..120
 *     "exportedAt": "2026-10-08T12:00:00.000Z",     // optional, informational
 *     "beats": [                                    // 0..200
 *       { "id": "b1", "order": 1, "title": "...", "scenarioMinute": 14,
 *         "persona": { "handle": "tbrandt41" }, "text": "...",
 *         "media": [{ "mediaId": "...", "alt": "..." }],       // optional, <= 4
 *         "replyTo": { "beatId": "b0" } | { "postId": "..." },   // optional
 *         "engagementBaseline": { "like": 120, "repost": 40 },   // optional
 *         "notes": "..." }                                       // optional
 *     ]
 *   }
 *
 * STRICT, FAIL-CLOSED. Every object is `strict` (an unknown key is a violation —
 * a stray `status` or `firedPostId` in a file is refused, not ignored), the
 * WHOLE file is rejected on the FIRST violation with one readable message, and
 * nothing is ever partially applied. After the shape passes, cross-beat rules run
 * (unique ids, unique orders, `replyTo.beatId` resolves to another beat, no reply
 * cycles). Content rules that need the media library (a video cannot be mixed
 * with images; do the ids exist?) are NOT file-schema rules — the library is not
 * in the file — and are handled by the editor and as non-blocking warnings.
 *
 * ROUND TRIP. `parseRunSheetFile(serializeRunSheetFile(x))` deep-equals `x` for
 * any valid definition `x` (the informational `exportedAt` is dropped on import).
 *
 * TEXT. Beat text is NOT sanitized here: nothing in this module renders HTML,
 * and a fired post is sanitized by the server's ingest (and by the mock
 * `createPost`) exactly as any other post (NFR-004). The panel renders all
 * strings as plain text.
 */

import { z } from 'zod'

/** The file's `schema` discriminator. */
export const RUN_SHEET_SCHEMA_ID = 'pulse.runsheet.v1' as const

/** Every numeric limit of the format, in one place (implementation.md §1.9). */
export const RUN_SHEET_LIMITS = {
  nameMax: 120,
  beatsMax: 200,
  idMax: 40,
  titleMax: 120,
  /** Code points (an emoji counts as one) — the default post character limit. */
  textMax: 280,
  mediaMax: 4,
  altMax: 1000,
  mediaIdMax: 100,
  postIdMax: 100,
  handleMax: 50,
  notesMax: 500,
  baselineMax: 1_000_000,
  /** Refuse to even parse a file larger than this (a run sheet is a few KB). */
  fileMaxBytes: 2 * 1024 * 1024,
} as const

// ---------------------------------------------------------------------------
// Types (implementation.md §1.9 — definitions only)
// ---------------------------------------------------------------------------

/** One media attachment: a library `MediaAsset` id plus its required alt text. */
export interface RunSheetBeatMedia {
  readonly mediaId: string
  readonly alt: string
}

/** What a reply beat replies to: another beat's fired post, or an existing post id. */
export type RunSheetReplyTo = { readonly beatId: string } | { readonly postId: string }

/** The staff-only seeded starting engagement (integers 0..1,000,000). */
export interface RunSheetBaseline {
  readonly like?: number
  readonly repost?: number
  readonly reply?: number
}

/** One staged post. */
export interface RunSheetBeat {
  /** Unique in the file; 1..40 chars of `[A-Za-z0-9_-]`. */
  readonly id: string
  /** 1-based sort key, unique in the file. */
  readonly order: number
  /** Controller-facing label, 1..120. */
  readonly title: string
  /** Intended minute offset from StartEx: informational + sort hint ONLY (no scheduler). */
  readonly scenarioMinute: number
  /** The persona to post as, by handle (no '@'); resolved against the exercise's personas. */
  readonly persona: { readonly handle: string }
  /** <= 280 code points. */
  readonly text: string
  readonly media?: readonly RunSheetBeatMedia[]
  readonly replyTo?: RunSheetReplyTo
  readonly engagementBaseline?: RunSheetBaseline
  /** Controller-facing, <= 500. */
  readonly notes?: string
}

/** A sheet's definition as the app holds it (the file minus `schema` / `exportedAt`). */
export interface RunSheetDefinition {
  readonly name: string
  readonly beats: readonly RunSheetBeat[]
}

/** The exported / imported file. */
export interface RunSheetFileV1 {
  readonly schema: typeof RUN_SHEET_SCHEMA_ID
  readonly name: string
  readonly exportedAt?: string
  readonly beats: readonly RunSheetBeat[]
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** Number of code points in `text` (an emoji or astral character counts once). */
export function codePointLength(text: string): number {
  return [...text].length
}

/** Zod issue messages here are fragments ("must be ..."); the path is prefixed on display. */
function typeMessage(expected: string) {
  return (issue: { input?: unknown }) =>
    issue.input === undefined ? 'is required' : `must be ${expected}`
}

function str(expected = 'a string') {
  return z.string({ error: typeMessage(expected) })
}

/** An object that refuses unknown keys, with readable messages for both failure modes. */
function strict<T extends z.ZodRawShape>(shape: T) {
  return z.strictObject(shape, {
    error: issue => {
      if (issue.code === 'unrecognized_keys') {
        const keys = issue.keys.map(key => `"${key}"`).join(', ')
        return `has ${issue.keys.length === 1 ? 'a field' : 'fields'} this format does not allow: ${keys}`
      }
      return typeMessage('an object')(issue)
    },
  })
}

const ID_PATTERN = /^[A-Za-z0-9_-]+$/

const idSchema = str('a string')
  .min(1, { error: 'must not be empty' })
  .max(RUN_SHEET_LIMITS.idMax, { error: `must be at most ${RUN_SHEET_LIMITS.idMax} characters` })
  .regex(ID_PATTERN, { error: 'may only contain letters, digits, "_" and "-"' })

const handleSchema = str('a string')
  .min(1, { error: 'must not be empty' })
  .max(RUN_SHEET_LIMITS.handleMax, {
    error: `must be at most ${RUN_SHEET_LIMITS.handleMax} characters`,
  })
  .regex(/^[^@\s]+$/, { error: 'must be a handle without "@" or spaces (e.g. "FulcoEM")' })

const wholeNumber = (min: number, max: number | undefined, what: string) => {
  const range = max === undefined ? `at least ${min}` : `between ${min} and ${max.toLocaleString('en-US')}`
  const base = z
    .number({ error: typeMessage('a number') })
    .int({ error: `must be a whole number (${what})` })
    .min(min, { error: `must be ${range}` })
  return max === undefined ? base : base.max(max, { error: `must be ${range}` })
}

const baselineValue = wholeNumber(0, RUN_SHEET_LIMITS.baselineMax, 'engagement count')

const baselineSchema = strict({
  like: baselineValue.optional(),
  repost: baselineValue.optional(),
  reply: baselineValue.optional(),
})

const mediaSchema = strict({
  mediaId: str()
    .min(1, { error: 'must not be empty' })
    .max(RUN_SHEET_LIMITS.mediaIdMax, {
      error: `must be at most ${RUN_SHEET_LIMITS.mediaIdMax} characters`,
    }),
  alt: str()
    .max(RUN_SHEET_LIMITS.altMax, {
      error: `must be at most ${RUN_SHEET_LIMITS.altMax} characters`,
    })
    .refine(alt => alt.trim().length > 0, {
      error: 'alt text is required for every media item (accessibility)',
    }),
})

const replyToSchema = z.union(
  [
    strict({ beatId: idSchema }),
    strict({
      postId: str()
        .min(1, { error: 'must not be empty' })
        .max(RUN_SHEET_LIMITS.postIdMax, {
          error: `must be at most ${RUN_SHEET_LIMITS.postIdMax} characters`,
        }),
    }),
  ],
  {
    error: issue =>
      issue.input === undefined
        ? 'is required'
        : 'must be exactly one of { "beatId": "<beat id>" } or { "postId": "<existing post id>" }',
  },
)

/** One beat. Exported so the editor and the storage loader validate with the same rules. */
export const beatSchema = strict({
  id: idSchema,
  order: wholeNumber(1, undefined, 'position in the sheet'),
  title: str()
    .min(1, { error: 'must not be empty' })
    .max(RUN_SHEET_LIMITS.titleMax, {
      error: `must be at most ${RUN_SHEET_LIMITS.titleMax} characters`,
    })
    .refine(title => title.trim().length > 0, { error: 'must not be blank' }),
  scenarioMinute: wholeNumber(0, undefined, 'minutes after StartEx'),
  persona: strict({ handle: handleSchema }),
  text: str().refine(text => codePointLength(text) <= RUN_SHEET_LIMITS.textMax, {
    error: issue =>
      `is ${codePointLength(String(issue.input))} characters; the limit is ${RUN_SHEET_LIMITS.textMax}`,
  }),
  media: z
    .array(mediaSchema, { error: typeMessage('a list') })
    .max(RUN_SHEET_LIMITS.mediaMax, {
      error: `has too many media items (at most ${RUN_SHEET_LIMITS.mediaMax} images or 1 video)`,
    })
    .optional(),
  replyTo: replyToSchema.optional(),
  engagementBaseline: baselineSchema.optional(),
  notes: str()
    .max(RUN_SHEET_LIMITS.notesMax, {
      error: `must be at most ${RUN_SHEET_LIMITS.notesMax} characters`,
    })
    .optional(),
}).superRefine((beat, ctx) => {
  const seen = new Set<string>()
  beat.media?.forEach((item, index) => {
    if (seen.has(item.mediaId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['media', index, 'mediaId'],
        message: `is attached twice ("${item.mediaId}")`,
      })
    }
    seen.add(item.mediaId)
  })
}) satisfies z.ZodType<RunSheetBeat>

/** The sheet name rule, shared by the file and the in-panel rename. */
export const sheetNameSchema = str()
  .min(1, { error: 'must not be empty' })
  .max(RUN_SHEET_LIMITS.nameMax, {
    error: `must be at most ${RUN_SHEET_LIMITS.nameMax} characters`,
  })
  .refine(name => name.trim().length > 0, { error: 'must not be blank' })

/** The beats array rule, shared by the file and the storage loader. */
export const beatsSchema = z
  .array(beatSchema, { error: typeMessage('a list') })
  .max(RUN_SHEET_LIMITS.beatsMax, {
    error: `has too many beats (at most ${RUN_SHEET_LIMITS.beatsMax})`,
  })

const fileSchema = strict({
  schema: z.literal(RUN_SHEET_SCHEMA_ID, {
    error: issue =>
      issue.input === undefined
        ? `is required (must be "${RUN_SHEET_SCHEMA_ID}")`
        : `must be "${RUN_SHEET_SCHEMA_ID}" - this is not a Pulse run sheet (found ${JSON.stringify(issue.input)})`,
  }),
  name: sheetNameSchema,
  exportedAt: z.iso.datetime({ offset: true, error: 'must be an ISO 8601 date-time' }).optional(),
  beats: beatsSchema,
})

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** `["beats", 2, "text"]` -> `beats[2].text`. An empty path is the file itself. */
function formatPath(path: readonly PropertyKey[]): string {
  let out = ''
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`
    else out += out === '' ? String(segment) : `.${String(segment)}`
  }
  return out
}

/** The id of `beats[index]` in a raw (possibly invalid) value, to name the beat in a message. */
function beatIdAt(raw: unknown, index: number): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const beats: unknown = (raw as { beats?: unknown }).beats
  if (!Array.isArray(beats)) return undefined
  const beat: unknown = beats[index]
  if (typeof beat !== 'object' || beat === null) return undefined
  const id: unknown = (beat as { id?: unknown }).id
  return typeof id === 'string' && id.length > 0 && id.length <= 80 ? id : undefined
}

/** One human-readable line for a zod issue: `beats[2].text: is 281 characters; ... [beat "b3"]`. */
function describeIssue(
  path: readonly PropertyKey[],
  message: string,
  raw: unknown,
): string {
  const where = formatPath(path)
  const index = path[0] === 'beats' && typeof path[1] === 'number' ? path[1] : undefined
  const beatId = index === undefined ? undefined : beatIdAt(raw, index)
  const suffix = beatId === undefined ? '' : ` [beat "${beatId}"]`
  return where === '' ? `The file ${message}${suffix}` : `${where} ${message}${suffix}`
}

// ---------------------------------------------------------------------------
// Cross-beat consistency
// ---------------------------------------------------------------------------

/**
 * The first cross-beat violation of an already shape-valid beat list, or
 * `undefined`: duplicate ids, duplicate orders, a `replyTo.beatId` that is the beat
 * itself / names no beat / closes a reply cycle (a cycle could never be fired).
 */
export function checkSheetConsistency(beats: readonly RunSheetBeat[]): string | undefined {
  const idIndex = new Map<string, number>()
  const orderIndex = new Map<number, number>()
  for (const [index, beat] of beats.entries()) {
    const sameId = idIndex.get(beat.id)
    if (sameId !== undefined) {
      return `beats[${index}].id is a duplicate: "${beat.id}" is already used by beats[${sameId}]`
    }
    idIndex.set(beat.id, index)
    const sameOrder = orderIndex.get(beat.order)
    if (sameOrder !== undefined) {
      return `beats[${index}].order is a duplicate: ${beat.order} is already used by beats[${sameOrder}] [beat "${beat.id}"]`
    }
    orderIndex.set(beat.order, index)
  }

  const parentOf = new Map<string, string>()
  for (const [index, beat] of beats.entries()) {
    const replyTo = beat.replyTo
    if (replyTo === undefined || !('beatId' in replyTo)) continue
    if (replyTo.beatId === beat.id) {
      return `beats[${index}].replyTo cannot point at the beat itself [beat "${beat.id}"]`
    }
    if (!idIndex.has(replyTo.beatId)) {
      return `beats[${index}].replyTo names a beat that is not in this file: "${replyTo.beatId}" [beat "${beat.id}"]`
    }
    parentOf.set(beat.id, replyTo.beatId)
  }

  for (const [index, beat] of beats.entries()) {
    const visited = new Set<string>([beat.id])
    let cursor = parentOf.get(beat.id)
    while (cursor !== undefined) {
      if (visited.has(cursor)) {
        return `beats[${index}].replyTo is part of a reply loop (a beat would wait for itself) [beat "${beat.id}"]`
      }
      visited.add(cursor)
      cursor = parentOf.get(cursor)
    }
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** A successful or failed validation; a failure carries ONE readable message. */
export type RunSheetParseResult =
  | {
    readonly ok: true
    readonly sheet: RunSheetDefinition
    /** The file's informational export instant, if any. Never stored or shown in the fiction. */
    readonly exportedAt?: string
  }
  | { readonly ok: false; readonly message: string }

/**
 * Validates an already-parsed JSON value as a `pulse.runsheet.v1` file. Rejects the
 * WHOLE file on the first violation. On success the beats come back sorted by `order`.
 */
export function parseRunSheetValue(raw: unknown): RunSheetParseResult {
  const parsed = fileSchema.safeParse(raw)
  if (!parsed.success) {
    const [first, ...rest] = parsed.error.issues
    if (first === undefined) return { ok: false, message: 'The file is not a valid run sheet.' }
    const more = rest.length > 0 ? ` (${rest.length} more problem${rest.length === 1 ? '' : 's'} not shown)` : ''
    return { ok: false, message: `${describeIssue(first.path, first.message, raw)}${more}` }
  }
  const file = parsed.data
  const beats = [...file.beats].sort((a, b) => a.order - b.order)
  const inconsistent = checkSheetConsistency(file.beats)
  if (inconsistent !== undefined) return { ok: false, message: inconsistent }
  return {
    ok: true,
    sheet: { name: file.name, beats: beats.map(normalizeBeat) },
    ...(file.exportedAt !== undefined ? { exportedAt: file.exportedAt } : {}),
  }
}

/** Parses + validates the TEXT of a file. Malformed JSON and oversized files are refused too. */
export function parseRunSheetFile(text: string): RunSheetParseResult {
  if (text.length > RUN_SHEET_LIMITS.fileMaxBytes) {
    return { ok: false, message: 'That file is too large to be a run sheet (over 2 MB).' }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, message: 'That file is not valid JSON, so it cannot be a run sheet.' }
  }
  return parseRunSheetValue(raw)
}

/** A beat with its keys in canonical order and no `undefined` members (stored and exported). */
export function normalizeBeat(beat: RunSheetBeat): RunSheetBeat {
  const replyTo = beat.replyTo
  const baseline = beat.engagementBaseline
  return {
    id: beat.id,
    order: beat.order,
    title: beat.title,
    scenarioMinute: beat.scenarioMinute,
    persona: { handle: beat.persona.handle },
    text: beat.text,
    ...(beat.media !== undefined
      ? { media: beat.media.map(item => ({ mediaId: item.mediaId, alt: item.alt })) }
      : {}),
    ...(replyTo !== undefined
      ? { replyTo: 'beatId' in replyTo ? { beatId: replyTo.beatId } : { postId: replyTo.postId } }
      : {}),
    ...(baseline !== undefined
      ? {
        engagementBaseline: {
          ...(baseline.like !== undefined ? { like: baseline.like } : {}),
          ...(baseline.repost !== undefined ? { repost: baseline.repost } : {}),
          ...(baseline.reply !== undefined ? { reply: baseline.reply } : {}),
        },
      }
      : {}),
    ...(beat.notes !== undefined ? { notes: beat.notes } : {}),
  }
}

/** Builds the file object for a definition (definitions only — never any status). */
export function buildRunSheetFile(sheet: RunSheetDefinition, exportedAt?: string): RunSheetFileV1 {
  return {
    schema: RUN_SHEET_SCHEMA_ID,
    name: sheet.name,
    ...(exportedAt !== undefined ? { exportedAt } : {}),
    beats: [...sheet.beats].sort((a, b) => a.order - b.order).map(normalizeBeat),
  }
}

/** The exact text a download contains: pretty-printed JSON plus a trailing newline. */
export function serializeRunSheetFile(sheet: RunSheetDefinition, exportedAt?: string): string {
  return `${JSON.stringify(buildRunSheetFile(sheet, exportedAt), null, 2)}\n`
}

/** One problem with one beat, keyed by the path inside the beat (`['media', 0, 'alt']`). */
export interface BeatIssue {
  readonly path: readonly (string | number)[]
  readonly message: string
}

/** Validates ONE candidate beat with the file's own rules (the editor's save gate). */
export function validateBeat(candidate: unknown): BeatIssue[] {
  const parsed = beatSchema.safeParse(candidate)
  if (parsed.success) return []
  return parsed.error.issues.map(issue => ({
    path: issue.path.filter((segment): segment is string | number => typeof segment !== 'symbol'),
    message: issue.message,
  }))
}

/** "T+14m": the intended scenario minute, informational only (no scheduler). */
export function formatScenarioMinute(minute: number): string {
  return `T+${minute}m`
}
