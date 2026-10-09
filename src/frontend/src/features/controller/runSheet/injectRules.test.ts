/**
 * features/controller/runSheet/injectRules.test.ts
 * ---------------------------------------------------------------------------
 * The pure rules of the run sheet (inject-queue story 07):
 *  - the 280 counter counts CODE POINTS (an emoji is 1, not 2);
 *  - the validation matrix mirrors story 06 (title / notes / T+N / post count /
 *    window range / persona / text / media + REQUIRED alt / reply / baseline);
 *  - Mine/All + open/fired/all, and "Fire next" = the first PENDING item in the
 *    current filter (held items are passed over);
 *  - the state-machine capabilities the UI offers;
 *  - the persisted-filter payload is validated (garbage falls back to All).
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILTERS,
  INJECT_LIMITS,
  canDelete,
  canFire,
  canHold,
  canRelease,
  canRetry,
  canSkip,
  canUnskip,
  countCodePoints,
  excerpt,
  failureReason,
  filterItems,
  firstPending,
  isEditable,
  mediaSetError,
  minimumBurstWindow,
  parseStoredFilters,
  plannedLabel,
  statusText,
  validateWrite,
} from './injectRules'
import { makeItem, makePost } from './runSheetTestHarness'
import type { InjectItemWrite, InjectStatus } from './types'

const validPost = { personaId: 'persona-fairhavenwater', text: 'Hello Fairhaven' }
const validWrite = (overrides: Partial<InjectItemWrite> = {}): InjectItemWrite => ({
  kind: 'post',
  title: 'Boil-water advisory',
  posts: [validPost],
  ...overrides,
})

describe('countCodePoints', () => {
  it('counts an emoji as one code point (not two UTF-16 units)', () => {
    expect('😀'.length).toBe(2)
    expect(countCodePoints('😀')).toBe(1)
    expect(countCodePoints('a😀b')).toBe(3)
  })

  it('counts plain ASCII by length and the empty string as 0', () => {
    expect(countCodePoints('hello')).toBe(5)
    expect(countCodePoints('')).toBe(0)
  })
})

describe('validateWrite', () => {
  it('accepts a minimal single post and a minimal burst', () => {
    expect(validateWrite(validWrite())).toEqual({})
    expect(
      validateWrite(validWrite({ kind: 'burst', posts: [validPost, validPost] })),
    ).toEqual({})
  })

  it('requires a title and caps it at 120 code points', () => {
    expect(validateWrite(validWrite({ title: '   ' })).title).toBeDefined()
    expect(validateWrite(validWrite({ title: 'x'.repeat(120) })).title).toBeUndefined()
    expect(validateWrite(validWrite({ title: 'x'.repeat(121) })).title).toBeDefined()
  })

  it('caps notes at 500 and requires T+N to be a whole number >= 0', () => {
    expect(validateWrite(validWrite({ notes: 'n'.repeat(501) })).notes).toBeDefined()
    expect(validateWrite(validWrite({ plannedMinute: -1 })).plannedMinute).toBeDefined()
    expect(validateWrite(validWrite({ plannedMinute: 1.5 })).plannedMinute).toBeDefined()
    expect(validateWrite(validWrite({ plannedMinute: Number.NaN })).plannedMinute).toBeDefined()
    expect(validateWrite(validWrite({ plannedMinute: 0 })).plannedMinute).toBeUndefined()
  })

  it('a single post needs exactly one post', () => {
    expect(validateWrite(validWrite({ posts: [] })).posts).toBeDefined()
    expect(validateWrite(validWrite({ posts: [validPost, validPost] })).posts).toBeDefined()
  })

  it('a burst needs 2..20 posts', () => {
    const burst = (n: number) =>
      validateWrite(validWrite({ kind: 'burst', posts: Array.from({ length: n }, () => validPost) }))
    expect(burst(1).posts).toBeDefined()
    expect(burst(2).posts).toBeUndefined()
    expect(burst(20).posts).toBeUndefined()
    expect(burst(21).posts).toBeDefined()
  })

  it('a burst window must be an integer in 30..600 (a post ignores the window)', () => {
    const burst = (burstWindowSeconds: number) =>
      validateWrite(
        validWrite({ kind: 'burst', posts: [validPost, validPost], burstWindowSeconds }),
      ).burstWindowSeconds
    expect(burst(29)).toBeDefined()
    expect(burst(30)).toBeUndefined()
    expect(burst(600)).toBeUndefined()
    expect(burst(601)).toBeDefined()
    expect(burst(90.5)).toBeDefined()
    expect(validateWrite(validWrite({ burstWindowSeconds: 5 })).burstWindowSeconds).toBeUndefined()
  })

  it('a burst window must hold every 3 s gap: >= 3 x (posts - 1), e.g. 20 posts need 57 s', () => {
    const burstOf = (count: number, burstWindowSeconds?: number) =>
      validateWrite(
        validWrite({
          kind: 'burst',
          posts: Array.from({ length: count }, () => validPost),
          ...(burstWindowSeconds === undefined ? {} : { burstWindowSeconds }),
        }),
      ).burstWindowSeconds
    expect(minimumBurstWindow(20)).toBe(57)
    expect(minimumBurstWindow(2)).toBe(3)
    expect(burstOf(20, 56)).toBe('A 20-post burst needs at least 57 seconds')
    expect(burstOf(20, 57)).toBeUndefined()
    expect(burstOf(12, 32)).toBe('A 12-post burst needs at least 33 seconds')
    expect(burstOf(12, 33)).toBeUndefined()
    // Below 12 posts the 30 s floor is already enough.
    expect(burstOf(11, 30)).toBeUndefined()
    // The plain range error still wins when the window is outside 30..600.
    expect(burstOf(20, 29)).toBe('Window must be 30 to 600 seconds')
    // No explicit window: the 90 s default always holds a full burst.
    expect(burstOf(20)).toBeUndefined()
  })

  it('requires a persona and text, and caps text at 280 CODE POINTS', () => {
    const textErr = (text: string) =>
      validateWrite(validWrite({ posts: [{ personaId: 'p', text }] }))['posts.0.text']
    expect(validateWrite(validWrite({ posts: [{ personaId: '', text: 'x' }] }))['posts.0.personaId'])
      .toBeDefined()
    expect(textErr('   ')).toBeDefined()
    expect(textErr('x'.repeat(280))).toBeUndefined()
    expect(textErr('x'.repeat(281))).toBeDefined()
    // 280 emoji are 560 UTF-16 units but exactly 280 code points: allowed.
    expect(textErr('😀'.repeat(280))).toBeUndefined()
    expect(textErr('😀'.repeat(281))).toBeDefined()
  })

  it('media: at most 4 entries; id and ALT are required (NFR-001)', () => {
    const media = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ mediaId: `m${i}`, alt: 'a photo' }))
    const err = (m: { mediaId: string; alt: string }[]) =>
      validateWrite(validWrite({ posts: [{ ...validPost, media: m }] }))
    expect(err(media(4))['posts.0.media']).toBeUndefined()
    expect(err(media(5))['posts.0.media']).toBeDefined()
    expect(err([{ mediaId: 'm1', alt: '  ' }])['posts.0.media.0.alt']).toBeDefined()
    expect(err([{ mediaId: ' ', alt: 'x' }])['posts.0.media.0.mediaId']).toBeDefined()
    expect(err([{ mediaId: 'm1', alt: 'a'.repeat(1001) }])['posts.0.media.0.alt']).toBeDefined()
  })

  it('replyTo { sequence } must be an EARLIER sibling: whole, >= 1 and before the post itself', () => {
    const at = (i: number, sequence: number) =>
      validateWrite(
        validWrite({
          kind: 'burst',
          posts: [validPost, validPost, { ...validPost, replyTo: { sequence } }].slice(0, 3),
        }),
      )[`posts.${i}.replyTo`]
    expect(at(2, 1)).toBeUndefined()
    expect(at(2, 2)).toBeUndefined()
    expect(at(2, 3)).toBeDefined() // itself
    expect(at(2, 4)).toBeDefined() // a later post
    expect(at(2, 0)).toBeDefined()
    expect(at(2, 1.5)).toBeDefined()
    // The first post has no earlier sibling at all.
    const first = validateWrite(
      validWrite({
        kind: 'burst',
        posts: [{ ...validPost, replyTo: { sequence: 1 } }, validPost],
      }),
    )
    expect(first['posts.0.replyTo']).toBeDefined()
  })

  it('a reply needs a target; a baseline is whole numbers in 0..1,000,000', () => {
    const post = (extra: object) =>
      validateWrite(validWrite({ posts: [{ ...validPost, ...extra }] }))
    expect(post({ replyTo: { postId: ' ' } })['posts.0.replyTo']).toBeDefined()
    expect(post({ replyTo: { injectPostId: '' } })['posts.0.replyTo']).toBeDefined()
    expect(post({ replyTo: { postId: 'post-1' } })['posts.0.replyTo']).toBeUndefined()
    expect(post({ engagementBaseline: { like: -1 } })['posts.0.engagementBaseline']).toBeDefined()
    expect(post({ engagementBaseline: { like: 1_000_001 } })['posts.0.engagementBaseline'])
      .toBeDefined()
    expect(post({ engagementBaseline: { repost: 1.5 } })['posts.0.engagementBaseline']).toBeDefined()
    expect(post({ engagementBaseline: { like: 0, repost: 1_000_000 } })['posts.0.engagementBaseline'])
      .toBeUndefined()
  })

  it('exposes the limits the story names', () => {
    expect(INJECT_LIMITS).toMatchObject({
      burstMinPosts: 2,
      burstMaxPosts: 20,
      windowMin: 30,
      windowMax: 600,
      windowDefault: 90,
      textMax: 280,
    })
  })
})

describe('mediaSetError / validateWrite: the set-level media kind rule', () => {
  const withMedia = (...ids: string[]): InjectItemWrite =>
    validWrite({
      posts: [{ ...validPost, media: ids.map(mediaId => ({ mediaId, alt: 'alt' })) }],
    })
  const kinds: Record<string, 'image' | 'video'> = { i1: 'image', i2: 'image', v1: 'video', v2: 'video' }
  const mediaKindOf = (id: string) => kinds[id]

  it('images alone, one video alone, and unknown kinds are fine', () => {
    expect(mediaSetError([])).toBeUndefined()
    expect(mediaSetError(['image', 'image', 'image', 'image'])).toBeUndefined()
    expect(mediaSetError(['video'])).toBeUndefined()
    expect(mediaSetError(['unknown', 'unknown'])).toBeUndefined()
    // An unknown id can neither prove nor disprove a mix: that is the server's call.
    expect(mediaSetError(['video', 'unknown'])).toBeUndefined()
    expect(mediaSetError(['image', 'unknown'])).toBeUndefined()
  })

  it('refuses images mixed with a video, and more than one video', () => {
    expect(mediaSetError(['image', 'video'])).toBe("A video can't be mixed with images")
    expect(mediaSetError(['video', 'image', 'image'])).toBe("A video can't be mixed with images")
    expect(mediaSetError(['video', 'video'])).toBe('A post can carry only one video')
  })

  it('validateWrite applies it per post, on the media slot, when kinds are supplied', () => {
    expect(validateWrite(withMedia('i1', 'v1'), { mediaKindOf })['posts.0.media'])
      .toBe("A video can't be mixed with images")
    expect(validateWrite(withMedia('v1', 'v2'), { mediaKindOf })['posts.0.media'])
      .toBe('A post can carry only one video')
    expect(validateWrite(withMedia('i1', 'i2'), { mediaKindOf })['posts.0.media']).toBeUndefined()
    expect(validateWrite(withMedia('v1'), { mediaKindOf })['posts.0.media']).toBeUndefined()
    expect(validateWrite(withMedia('i1', 'not-in-library'), { mediaKindOf })['posts.0.media'])
      .toBeUndefined()
  })

  it('without kinds the check is off (the server still enforces it)', () => {
    expect(validateWrite(withMedia('i1', 'v1'))['posts.0.media']).toBeUndefined()
  })

  it('the count limit still wins over the kind check', () => {
    const five = withMedia('i1', 'i2', 'x3', 'x4', 'x5')
    expect(validateWrite(five, { mediaKindOf })['posts.0.media']).toBe('At most 4 media per post')
  })
})

describe('status vocabulary + state machine', () => {
  it('every status has a text label; a burst in flight carries its n/m', () => {
    expect(statusText(makeItem({ status: 'pending' }))).toBe('Pending')
    expect(statusText(makeItem({ status: 'held' }))).toBe('Held')
    expect(statusText(makeItem({ status: 'fired' }))).toBe('Fired')
    expect(statusText(makeItem({ status: 'skipped' }))).toBe('Skipped')
    expect(statusText(makeItem({ status: 'failed' }))).toBe('Failed')
    expect(statusText(makeItem({ status: 'firing', firedCount: 3, total: 8 }))).toBe('Firing 3/8')
  })

  it('offers each action only where story 06 allows it', () => {
    const all: InjectStatus[] = ['pending', 'held', 'firing', 'fired', 'skipped', 'failed']
    const only = (fn: (s: InjectStatus) => boolean) => all.filter(fn)
    expect(only(canFire)).toEqual(['pending'])
    expect(only(canHold)).toEqual(['pending', 'firing'])
    expect(only(canRelease)).toEqual(['held'])
    expect(only(canSkip)).toEqual(['pending', 'held'])
    expect(only(canUnskip)).toEqual(['skipped'])
    expect(only(canRetry)).toEqual(['failed'])
    expect(only(canDelete)).toEqual(['pending', 'held', 'skipped'])
    expect(only(isEditable)).toEqual(['pending', 'held', 'failed'])
  })
})

describe('filters', () => {
  const items = [
    makeItem({ id: 'a', order: 3, status: 'pending', assigneeId: 'me' }),
    makeItem({ id: 'b', order: 1, status: 'held', assigneeId: 'other' }),
    makeItem({ id: 'c', order: 2, status: 'fired', assigneeId: 'me' }),
    makeItem({ id: 'd', order: 4, status: 'skipped', assigneeId: null }),
    makeItem({ id: 'e', order: 5, status: 'failed', assigneeId: 'me' }),
    makeItem({ id: 'f', order: 6, status: 'firing', assigneeId: 'other' }),
  ]
  const ids = (list: { id: string }[]) => list.map(i => i.id)

  it('All/all returns everything in server order', () => {
    expect(ids(filterItems(items, DEFAULT_FILTERS, 'me'))).toEqual(['b', 'c', 'a', 'd', 'e', 'f'])
  })

  it('Mine keeps only my items; with no known "me" nothing is mine (fail closed)', () => {
    expect(ids(filterItems(items, { scope: 'mine', status: 'all' }, 'me'))).toEqual(['c', 'a', 'e'])
    expect(filterItems(items, { scope: 'mine', status: 'all' }, undefined)).toEqual([])
  })

  it('open = pending/held/firing/failed; fired = fired; skipped only shows under all', () => {
    expect(ids(filterItems(items, { scope: 'all', status: 'open' }, 'me'))).toEqual([
      'b', 'a', 'e', 'f',
    ])
    expect(ids(filterItems(items, { scope: 'all', status: 'fired' }, 'me'))).toEqual(['c'])
  })

  it('Fire next is the first PENDING item of the filtered list; held items are passed over', () => {
    const heldFirst = [
      makeItem({ id: 'h', order: 1, status: 'held' }),
      makeItem({ id: 'p', order: 2, status: 'pending' }),
      makeItem({ id: 'q', order: 3, status: 'pending' }),
    ]
    expect(firstPending(filterItems(heldFirst, DEFAULT_FILTERS, 'me'))?.id).toBe('p')
    expect(firstPending(heldFirst.filter(i => i.status === 'held'))).toBeUndefined()
  })

  it('"Fire next" respects the CURRENT filter (Mine)', () => {
    const mixed = [
      makeItem({ id: 'theirs', order: 1, status: 'pending', assigneeId: 'other' }),
      makeItem({ id: 'mine', order: 2, status: 'pending', assigneeId: 'me' }),
    ]
    expect(firstPending(filterItems(mixed, { scope: 'mine', status: 'all' }, 'me'))?.id).toBe('mine')
    expect(firstPending(filterItems(mixed, DEFAULT_FILTERS, 'me'))?.id).toBe('theirs')
  })
})

describe('parseStoredFilters', () => {
  it('accepts a valid payload', () => {
    expect(parseStoredFilters({ scope: 'mine', status: 'open' })).toEqual({
      scope: 'mine',
      status: 'open',
    })
  })

  it('falls back to All/all for garbage, partial and unknown values', () => {
    expect(parseStoredFilters(null)).toEqual(DEFAULT_FILTERS)
    expect(parseStoredFilters('mine')).toEqual(DEFAULT_FILTERS)
    expect(parseStoredFilters({ scope: 'everyone', status: 'nope' })).toEqual(DEFAULT_FILTERS)
    expect(parseStoredFilters({ scope: 'mine' })).toEqual({ scope: 'mine', status: 'all' })
  })
})

describe('display helpers', () => {
  it('plannedLabel shows T+N or an em dash', () => {
    expect(plannedLabel(15)).toBe('T+15')
    expect(plannedLabel(0)).toBe('T+0')
    expect(plannedLabel(undefined)).toBe('T+—')
  })

  it('failureReason prefers the item error, then the first failed post error', () => {
    const post = makePost({ status: 'failed', error: 'post-level' })
    expect(failureReason(makeItem({ status: 'failed', error: 'item-level', posts: [post] })))
      .toBe('item-level')
    expect(failureReason(makeItem({ status: 'failed', posts: [post] }))).toBe('post-level')
    expect(failureReason(makeItem({ status: 'failed' }))).toBeUndefined()
  })

  it('excerpt shortens by code points', () => {
    expect(excerpt('short', 10)).toBe('short')
    expect(excerpt('abcdefghij', 5)).toBe('abcde…')
    expect(excerpt('😀😀😀😀', 2)).toBe('😀😀…')
  })
})
