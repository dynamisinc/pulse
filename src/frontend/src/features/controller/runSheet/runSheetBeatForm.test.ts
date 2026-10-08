/**
 * features/controller/runSheet/runSheetBeatForm.test.ts
 * ---------------------------------------------------------------------------
 * The beat editor's form model (demo-polish C3): draft <-> beat conversion and the
 * field-keyed validation, which runs on the SAME zod schema as the importer.
 */
import { describe, expect, it } from 'vitest'
import {
  contentFromDraft,
  draftFromBeat,
  emptyDraft,
  maxMediaFor,
  validateDraft,
  type BeatDraft,
} from './runSheetBeatForm'
import { beatFixture, sheetFixture } from './runSheetTestKit'

const data = sheetFixture([
  beatFixture({ id: 'p', order: 1, title: 'Parent' }),
  beatFixture({ id: 'c', order: 2, title: 'Child', replyTo: { beatId: 'p' } }),
  beatFixture({ id: 'g', order: 3, title: 'Grandchild', replyTo: { beatId: 'c' } }),
])

function valid(overrides: Partial<BeatDraft> = {}): BeatDraft {
  return { ...emptyDraft('FulcoEM'), title: 'A title', text: 'Some text', ...overrides }
}

describe('validateDraft', () => {
  it('accepts a minimal draft', () => {
    expect(validateDraft(valid(), data)).toEqual({})
  })

  it('requires a title, a persona and a whole-number minute, with messages written for the field', () => {
    const errors = validateDraft(valid({ title: '', handle: '', minute: '' }), data)
    expect(errors.title).toBe('Title must not be empty')
    expect(errors.persona).toBe('Choose the persona that posts this.')
    expect(errors.minute).toBe('Intended minute is required')
    expect(validateDraft(valid({ minute: '1.5' }), data).minute).toContain('must be')
    expect(validateDraft(valid({ minute: '-3' }), data).minute).toContain('must be')
    expect(validateDraft(valid({ minute: '14' }), data)).toEqual({})
  })

  it('counts text in code points and reports how far over the limit it is', () => {
    expect(validateDraft(valid({ text: '😀'.repeat(280) }), data)).toEqual({})
    expect(validateDraft(valid({ text: 'a'.repeat(285) }), data).text).toBe(
      'Text is 285 characters; the limit is 280',
    )
  })

  it('needs text or media: there must be something to post', () => {
    expect(validateDraft(valid({ text: '' }), data).text).toContain('nothing to post')
    expect(validateDraft(valid({ text: '  ' }), data).text).toContain('nothing to post')
    const withMedia = valid({ text: '', media: [{ mediaId: 'm1', alt: 'A photo' }] })
    expect(validateDraft(withMedia, data)).toEqual({})
  })

  it('requires alt text on every media item (NFR-001) and keys the error to the item', () => {
    const errors = validateDraft(valid({
      media: [{ mediaId: 'm1', alt: 'ok' }, { mediaId: 'm2', alt: '   ' }],
    }), data)
    expect(errors['media.1.alt']).toContain('alt text is required')
    expect(errors['media.0.alt']).toBeUndefined()
  })

  it('allows at most 4 media', () => {
    const five = valid({
      media: [1, 2, 3, 4, 5].map(n => ({ mediaId: `m${n}`, alt: `photo ${n}` })),
    })
    expect(validateDraft(five, data).media).toContain('too many media items')
  })

  it('validates the baseline: whole numbers 0 to 1,000,000, blank = none', () => {
    expect(validateDraft(valid({ baselineLike: '1000000', baselineRepost: '0' }), data)).toEqual({})
    expect(validateDraft(valid({ baselineLike: '1000001' }), data)['baseline.like'])
      .toContain('between 0 and 1,000,000')
    expect(validateDraft(valid({ baselineRepost: '1.5' }), data)['baseline.repost']).toContain('must be')
    expect(validateDraft(valid({ baselineReply: 'lots' }), data)['baseline.reply']).toContain('must be')
  })

  it('enforces the notes limit', () => {
    expect(validateDraft(valid({ notes: 'n'.repeat(501) }), data).notes).toContain('at most 500')
  })

  describe('reply to', () => {
    it('needs a parent beat or a post id when a reply mode is chosen', () => {
      expect(validateDraft(valid({ replyMode: 'beat' }), data).replyTo).toBe('Choose the beat this replies to.')
      expect(validateDraft(valid({ replyMode: 'post', replyPostId: ' ' }), data).replyTo)
        .toContain('id of the existing post')
      expect(validateDraft(valid({ replyMode: 'post', replyPostId: 'post-1' }), data)).toEqual({})
    })

    it('rejects a parent that is no longer in the sheet', () => {
      expect(validateDraft(valid({ replyMode: 'beat', replyBeatId: 'gone' }), data).replyTo)
        .toContain('no longer in the sheet')
    })

    it('rejects replying to itself or to one of its own replies (a loop)', () => {
      expect(validateDraft(valid({ replyMode: 'beat', replyBeatId: 'p' }), data, 'p').replyTo)
        .toContain('itself')
      expect(validateDraft(valid({ replyMode: 'beat', replyBeatId: 'g' }), data, 'p').replyTo)
        .toContain('loop')
      expect(validateDraft(valid({ replyMode: 'beat', replyBeatId: 'p' }), data, 'g')).toEqual({})
    })
  })
})

describe('draft <-> beat', () => {
  it('round-trips a full beat', () => {
    const beat = beatFixture({
      media: [{ mediaId: 'm1', alt: 'A photo' }],
      replyTo: { postId: 'post-7' },
      engagementBaseline: { like: 5, reply: 0 },
      notes: 'Say it slowly.',
    })
    const draft = draftFromBeat(beat)
    expect(validateDraft(draft, data)).toEqual({})
    const { title, scenarioMinute, persona, text, media, replyTo, engagementBaseline, notes } = beat
    expect(contentFromDraft(draft)).toEqual({
      title, scenarioMinute, persona, text, media, replyTo, engagementBaseline, notes,
    })
  })

  it('omits empty optionals and trims a post id', () => {
    const content = contentFromDraft(valid({ replyMode: 'post', replyPostId: '  post-9  ', notes: '  ' }))
    expect(content.replyTo).toEqual({ postId: 'post-9' })
    expect(content).not.toHaveProperty('notes')
    expect(content).not.toHaveProperty('media')
    expect(content).not.toHaveProperty('engagementBaseline')
  })

  it('infers the media kind from the library: a video beat edits as a video', () => {
    const beat = beatFixture({ media: [{ mediaId: 'vid', alt: 'A clip' }] })
    expect(draftFromBeat(beat, new Map([['vid', 'video']])).mediaKind).toBe('video')
    expect(draftFromBeat(beat, new Map([['vid', 'image']])).mediaKind).toBe('image')
    expect(draftFromBeat(beat).mediaKind).toBe('image')
  })

  it('allows 4 images or one video', () => {
    expect(maxMediaFor('image')).toBe(4)
    expect(maxMediaFor('video')).toBe(1)
  })
})
