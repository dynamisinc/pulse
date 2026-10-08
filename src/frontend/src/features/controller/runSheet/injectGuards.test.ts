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
  ])('rejects a child with %s', (_name, overrides) => {
    expect(isInjectPostDto({ ...makePost(), ...overrides })).toBe(false)
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
