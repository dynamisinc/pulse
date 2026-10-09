/**
 * features/controller/runSheet/runSheetBeatForm.ts
 * ---------------------------------------------------------------------------
 * The beat editor's FORM MODEL (demo-polish C3, story 19). STAFF world; pure - no
 * React. A form holds strings (what the controller typed), a beat holds typed values;
 * this module converts between them and validates.
 *
 * ONE SET OF RULES. `validateDraft` builds a candidate beat from the draft and runs it
 * through `validateBeat` (`runSheetSchema.ts`) - the SAME zod schema the importer and the
 * storage loader use - then maps each issue to the form field it belongs to, with a
 * message written for the field ("Text is 301 characters; the limit is 280"). A beat the
 * editor saves is therefore always a beat the importer would accept. The two rules the
 * file cannot express - "needs text or media" and "reply to a beat that exists and does
 * not close a loop" - are added here.
 *
 * MEDIA. A beat carries media IDS and alt text; the library supplies the rest. The kind
 * (`image` up to 4, or one `video`) is a property of the form (`mediaKind`) because the
 * file does not record it; the editor passes it to `MediaLibraryPicker`, which keeps
 * images and videos from being mixed (the server also refuses a mix).
 */

import type { MediaKind } from '@/core/media'
import { descendantIds, type BeatContent, type RunSheetData } from './runSheetModel'
import { RUN_SHEET_LIMITS, validateBeat, type RunSheetBeat } from './runSheetSchema'

/** Max media for each kind (images up to 4, or exactly one video). */
export function maxMediaFor(kind: MediaKind): number {
  return kind === 'video' ? 1 : RUN_SHEET_LIMITS.mediaMax
}

/** What a reply beat replies to, as the form edits it. */
export type ReplyMode = 'none' | 'beat' | 'post'

/** Everything the editor holds, as strings and lists. */
export interface BeatDraft {
  readonly title: string
  readonly handle: string
  /** The intended scenario minute, as typed. */
  readonly minute: string
  readonly text: string
  readonly mediaKind: MediaKind
  readonly media: readonly { readonly mediaId: string; readonly alt: string }[]
  readonly replyMode: ReplyMode
  readonly replyBeatId: string
  readonly replyPostId: string
  readonly baselineLike: string
  readonly baselineRepost: string
  readonly baselineReply: string
  readonly notes: string
}

/** A blank draft for a new beat. */
export function emptyDraft(handle = ''): BeatDraft {
  return {
    title: '',
    handle,
    minute: '0',
    text: '',
    mediaKind: 'image',
    media: [],
    replyMode: 'none',
    replyBeatId: '',
    replyPostId: '',
    baselineLike: '',
    baselineRepost: '',
    baselineReply: '',
    notes: '',
  }
}

/**
 * A draft that edits `beat`. `kinds` (library id -> kind) tells whether the beat's media
 * is a video; ids the library does not know are treated as images.
 */
export function draftFromBeat(
  beat: RunSheetBeat,
  kinds: ReadonlyMap<string, MediaKind> = new Map(),
): BeatDraft {
  const media = beat.media ?? []
  const hasVideo = media.some(item => kinds.get(item.mediaId) === 'video')
  const replyTo = beat.replyTo
  const baseline = beat.engagementBaseline
  return {
    title: beat.title,
    handle: beat.persona.handle,
    minute: String(beat.scenarioMinute),
    text: beat.text,
    mediaKind: hasVideo ? 'video' : 'image',
    media: media.map(item => ({ mediaId: item.mediaId, alt: item.alt })),
    replyMode: replyTo === undefined ? 'none' : 'beatId' in replyTo ? 'beat' : 'post',
    replyBeatId: replyTo !== undefined && 'beatId' in replyTo ? replyTo.beatId : '',
    replyPostId: replyTo !== undefined && 'postId' in replyTo ? replyTo.postId : '',
    baselineLike: baseline?.like === undefined ? '' : String(baseline.like),
    baselineRepost: baseline?.repost === undefined ? '' : String(baseline.repost),
    baselineReply: baseline?.reply === undefined ? '' : String(baseline.reply),
    notes: beat.notes ?? '',
  }
}

/**
 * A typed whole number from typed text. `undefined` for blank; `Number.NaN` for anything
 * that is not plain digits (so the schema rejects it with a readable message).
 */
function wholeNumberFrom(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN
}

/** The candidate beat (as `unknown`, because a draft may be invalid) a draft describes. */
function candidateFromDraft(draft: BeatDraft): Record<string, unknown> {
  const like = wholeNumberFrom(draft.baselineLike)
  const repost = wholeNumberFrom(draft.baselineRepost)
  const reply = wholeNumberFrom(draft.baselineReply)
  const hasBaseline = like !== undefined || repost !== undefined || reply !== undefined
  const replyTo =
    draft.replyMode === 'beat'
      ? { beatId: draft.replyBeatId }
      : draft.replyMode === 'post'
        ? { postId: draft.replyPostId.trim() }
        : undefined
  return {
    id: 'draft',
    order: 1,
    title: draft.title,
    scenarioMinute: wholeNumberFrom(draft.minute),
    persona: { handle: draft.handle },
    text: draft.text,
    ...(draft.media.length > 0
      ? { media: draft.media.map(item => ({ mediaId: item.mediaId, alt: item.alt })) }
      : {}),
    ...(replyTo !== undefined ? { replyTo } : {}),
    ...(hasBaseline
      ? {
        engagementBaseline: {
          ...(like !== undefined ? { like } : {}),
          ...(repost !== undefined ? { repost } : {}),
          ...(reply !== undefined ? { reply } : {}),
        },
      }
      : {}),
    ...(draft.notes.trim() !== '' ? { notes: draft.notes } : {}),
  }
}

/**
 * Field name -> message. Keys: title, persona, minute, text, media, media.N.alt, replyTo,
 * baseline.like, ...
 */
export type DraftErrors = Readonly<Record<string, string>>

function fieldFor(path: readonly (string | number)[]): string {
  const [head, second, third] = path
  switch (head) {
    case 'scenarioMinute':
      return 'minute'
    case 'persona':
      return 'persona'
    case 'media':
      return typeof second === 'number' ? `media.${second}.${third === 'alt' ? 'alt' : 'id'}` : 'media'
    case 'engagementBaseline':
      return `baseline.${String(second)}`
    case 'replyTo':
      return 'replyTo'
    case 'title':
    case 'text':
    case 'notes':
      return head
    default:
      return String(head)
  }
}

const FIELD_LABEL: Readonly<Record<string, string>> = {
  title: 'Title',
  persona: 'Persona',
  minute: 'Intended minute',
  text: 'Text',
  notes: 'Notes',
  media: 'Media',
  'baseline.like': 'Likes',
  'baseline.repost': 'Reposts',
  'baseline.reply': 'Replies',
}

function messageFor(field: string, message: string): string {
  if (field.startsWith('media.') && field.endsWith('.alt')) {
    return 'Describe this media for people who cannot see it (alt text is required).'
  }
  if (field === 'replyTo') return `Post id ${message}`
  if (field.startsWith('media.')) return `This media item ${message}`
  const label = FIELD_LABEL[field]
  return label === undefined ? message : `${label} ${message}`
}

/**
 * Validates a draft. `data` is the sheet being edited and `selfId` the beat being edited
 * (undefined for a new beat), so a reply cannot target itself, a missing beat, or one of
 * its own replies. An empty result means the draft can be saved.
 */
export function validateDraft(
  draft: BeatDraft,
  data: RunSheetData,
  selfId?: string,
): DraftErrors {
  const errors: Record<string, string> = {}
  for (const issue of validateBeat(candidateFromDraft(draft))) {
    const field = fieldFor(issue.path)
    if (errors[field] === undefined) errors[field] = messageFor(field, issue.message)
  }

  if (draft.handle.trim() === '') errors.persona = 'Choose the persona that posts this.'

  if (draft.text.trim() === '' && draft.media.length === 0 && errors.text === undefined) {
    errors.text = 'Add some text or attach media: there is nothing to post.'
  }

  if (draft.replyMode === 'beat') {
    if (draft.replyBeatId === '') {
      errors.replyTo = 'Choose the beat this replies to.'
    } else if (!data.beats.some(beat => beat.id === draft.replyBeatId)) {
      errors.replyTo = 'That beat is no longer in the sheet.'
    } else if (selfId !== undefined) {
      if (draft.replyBeatId === selfId) {
        errors.replyTo = 'A beat cannot reply to itself.'
      } else if (descendantIds(data, selfId).has(draft.replyBeatId)) {
        errors.replyTo = 'That beat already replies to this one, so this would be a loop.'
      }
    }
  } else if (draft.replyMode === 'post' && draft.replyPostId.trim() === '') {
    errors.replyTo = 'Enter the id of the existing post this replies to.'
  }

  return errors
}

/**
 * The beat content a VALID draft describes. Call only when {@link validateDraft} returned
 * no errors (a blank/odd number would otherwise become NaN).
 */
export function contentFromDraft(draft: BeatDraft): BeatContent {
  const minute = wholeNumberFrom(draft.minute) ?? 0
  const like = wholeNumberFrom(draft.baselineLike)
  const repost = wholeNumberFrom(draft.baselineRepost)
  const reply = wholeNumberFrom(draft.baselineReply)
  return {
    title: draft.title,
    scenarioMinute: minute,
    persona: { handle: draft.handle },
    text: draft.text,
    ...(draft.media.length > 0
      ? { media: draft.media.map(item => ({ mediaId: item.mediaId, alt: item.alt })) }
      : {}),
    ...(draft.replyMode !== 'none'
      ? {
        replyTo:
          draft.replyMode === 'beat'
            ? { beatId: draft.replyBeatId }
            : { postId: draft.replyPostId.trim() },
      }
      : {}),
    ...(like !== undefined || repost !== undefined || reply !== undefined
      ? {
        engagementBaseline: {
          ...(like !== undefined ? { like } : {}),
          ...(repost !== undefined ? { repost } : {}),
          ...(reply !== undefined ? { reply } : {}),
        },
      }
      : {}),
    ...(draft.notes.trim() !== '' ? { notes: draft.notes } : {}),
  }
}
