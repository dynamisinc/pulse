/**
 * features/controller/runSheet/injectGuards.test.ts
 * ---------------------------------------------------------------------------
 * The wire guards (inject-queue story 07): an item is renderable only if the item AND every
 * child carry what a row needs. A malformed child (no id / persona / text / sequence, an
 * unknown status) makes its item malformed — it must never be rendered:
 *  - a queue read DROPS a malformed item and keeps the rest, reporting the dropped ids so the panel
 *    can warn (one odd row must not blank the sheet; a silently shorter sheet must not read as
 *    "nothing scripted"); only a malformed TOP-LEVEL shape rejects the read;
 *  - a 409's `item` that is malformed is dropped (the console falls back to the polled copy).
 */
import { describe, expect, it } from 'vitest'
import {
  isInjectAssigneesDto,
  isInjectItemDto,
  isInjectPostDto,
  parseInjectQueue,
} from './injectGuards'
import { makeItem, makePost } from './runSheetTestHarness'

describe('isInjectPostDto', () => {
  it('accepts a well-formed child', () => {
    expect(isInjectPostDto(makePost())).toBe(true)
  })

  it.each([
    ['no id', { id: undefined }],
    ['an empty id', { id: '' }],
    ['no persona', { personaId: undefined }],
    ['an empty persona', { personaId: '' }],
    ['no text', { text: undefined }],
    ['a non-string text', { text: 5 }],
    ['an unknown status', { status: 'exploded' }],
    ['no status', { status: undefined }],
    ['a zero sequence', { sequence: 0 }],
    ['a fractional sequence', { sequence: 1.5 }],
    ['a string sequence', { sequence: '1' }],
    ['no sequence', { sequence: undefined }],
    // NESTED fields: each of these crashed `draftFromItem` / `postFromDto` on Edit / View.
    ['media that is a string', { media: 'not-an-array' }],
    ['media that is an object', { media: { mediaId: 'm', alt: 'a' } }],
    ['a null media entry', { media: [null] }],
    ['a media entry that is a string', { media: ['m'] }],
    ['a media entry without a mediaId', { media: [{ alt: 'a' }] }],
    ['a media entry with a numeric mediaId', { media: [{ mediaId: 5, alt: 'a' }] }],
    ['a media entry without alt', { media: [{ mediaId: 'm' }] }],
    ['a media entry with a numeric alt', { media: [{ mediaId: 'm', alt: 9 }] }],
    ['a replyTo that is a string', { replyTo: 'post-1' }],
    ['a replyTo that is a number', { replyTo: 7 }],
    ['a replyTo that is an array', { replyTo: [{ postId: 'p' }] }],
    ['a replyTo naming nothing', { replyTo: {} }],
    ['a replyTo with an unknown key only', { replyTo: { parent: 'p' } }],
    ['a replyTo.sequence that is a string', { replyTo: { sequence: '1' } }],
    ['a replyTo.sequence of 0', { replyTo: { sequence: 0 } }],
    ['a replyTo.sequence that is fractional', { replyTo: { sequence: 1.5 } }],
    ['a replyTo.injectPostId that is a number', { replyTo: { injectPostId: 5 } }],
    ['a replyTo.postId that is null', { replyTo: { postId: null } }],
    ['a replyTo with one good and one bad key', { replyTo: { sequence: 1, postId: 5 } }],
    ['a baseline that is a string', { engagementBaseline: 'lots' }],
    ['a baseline with a non-numeric like', { engagementBaseline: { like: 'many' } }],
  ])('rejects a child with %s', (_name, overrides) => {
    expect(isInjectPostDto({ ...makePost(), ...overrides })).toBe(false)
  })

  it.each([
    ['no optional members at all', {}],
    ['explicit nulls for every optional member (the server may write them)', {
      media: null,
      replyTo: null,
      engagementBaseline: null,
    }],
    ['a well-formed media list', { media: [{ mediaId: 'm1', alt: 'a glass' }] }],
    ['an empty media list', { media: [] }],
    ['a replyTo by sequence', { replyTo: { sequence: 1 } }],
    ['a replyTo by injectPostId', { replyTo: { injectPostId: 'injp-9' } }],
    ['a replyTo by postId', { replyTo: { postId: 'post-9' } }],
    ['a partial baseline', { engagementBaseline: { like: 5 } }],
  ])('accepts a child with %s', (_name, overrides) => {
    expect(isInjectPostDto({ ...makePost(), ...overrides })).toBe(true)
  })

  it('rejects non-objects', () => {
    for (const value of [null, undefined, 'x', 7, []]) expect(isInjectPostDto(value)).toBe(false)
  })
})

describe('isInjectItemDto', () => {
  it('accepts a well-formed item with well-formed children', () => {
    expect(isInjectItemDto(makeItem())).toBe(true)
  })

  it('rejects an item with ANY malformed child', () => {
    const bad = makeItem({
      kind: 'burst',
      posts: [makePost({ id: 'a', sequence: 1 }), makePost({ id: 'b', sequence: 2, personaId: '' })],
    })
    expect(isInjectItemDto(bad)).toBe(false)
  })

  it('rejects an item whose posts is not an array, or whose own fields are wrong', () => {
    expect(isInjectItemDto({ ...makeItem(), posts: 'nope' })).toBe(false)
    expect(isInjectItemDto({ ...makeItem(), status: 'exploded' })).toBe(false)
    expect(isInjectItemDto({ ...makeItem(), version: '1' })).toBe(false)
  })
})

describe('parseInjectQueue', () => {
  it('keeps a queue of good items, in order, with no dropped ids', () => {
    const parsed = parseInjectQueue({
      items: [makeItem({ id: 'a' }), makeItem({ id: 'b' })],
      pauseTier: 'running',
    })
    expect(parsed?.items.map(i => i.id)).toEqual(['a', 'b'])
    expect(parsed?.pauseTier).toBe('running')
    expect(parsed).not.toHaveProperty('droppedItemIds')
  })

  it('DROPS a malformed item and keeps every other one (one odd row must not blank the sheet)', () => {
    const bad = makeItem({ id: 'bad', posts: [makePost({ status: 'weird' as never })] })
    const parsed = parseInjectQueue({
      items: [makeItem({ id: 'first' }), bad, makeItem({ id: 'last' })],
      pauseTier: 'injects',
    })
    expect(parsed?.items.map(i => i.id)).toEqual(['first', 'last'])
    expect(parsed?.droppedItemIds).toEqual(['bad'])
    expect(parsed?.pauseTier).toBe('injects')
  })

  it('reports every dropped id; an element with no usable id is reported as "(no id)"', () => {
    const parsed = parseInjectQueue({
      items: [{ id: 'x', status: 'exploded' }, null, 'junk', { title: 'no id at all' }, makeItem({ id: 'ok' })],
      pauseTier: 'running',
    })
    expect(parsed?.items.map(i => i.id)).toEqual(['ok'])
    expect(parsed?.droppedItemIds).toEqual(['x', '(no id)', '(no id)', '(no id)'])
  })

  it('a queue where EVERY item is malformed is an empty list plus the dropped ids (not an error)', () => {
    const parsed = parseInjectQueue({ items: [{ id: 'a' }, { id: 'b' }], pauseTier: 'running' })
    expect(parsed?.items).toEqual([])
    expect(parsed?.droppedItemIds).toEqual(['a', 'b'])
  })

  it('a malformed TOP-LEVEL shape is still an error (undefined): not an object, no items array, bad tier', () => {
    expect(parseInjectQueue('<html>SPA fallback</html>')).toBeUndefined()
    expect(parseInjectQueue(null)).toBeUndefined()
    expect(parseInjectQueue({ pauseTier: 'running' })).toBeUndefined()
    expect(parseInjectQueue({ items: 'nope', pauseTier: 'running' })).toBeUndefined()
    expect(parseInjectQueue({ items: [], pauseTier: 'melted' })).toBeUndefined()
    expect(parseInjectQueue({ items: [] })).toBeUndefined()
  })
})

describe('isInjectAssigneesDto', () => {
  it('needs me and well-formed assignees', () => {
    expect(isInjectAssigneesDto({ me: 'a', assignees: [{ id: 'a', displayName: 'A', role: 'controller' }] }))
      .toBe(true)
    expect(isInjectAssigneesDto({ me: 'a', assignees: [{ id: 'a' }] })).toBe(false)
    expect(isInjectAssigneesDto({ assignees: [] })).toBe(false)
  })
})
