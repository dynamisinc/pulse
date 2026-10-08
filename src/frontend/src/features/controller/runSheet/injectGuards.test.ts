/**
 * features/controller/runSheet/injectGuards.test.ts
 * ---------------------------------------------------------------------------
 * The wire guards (inject-queue story 07): an item is renderable only if the item AND every
 * child carry what a row needs. A malformed child (no id / persona / text / sequence, an
 * unknown status) makes its item malformed — it must never be rendered:
 *  - a queue read with ANY malformed item is rejected as a whole (the panel then says it cannot
 *    load / lost contact, rather than silently showing a sheet with a scripted item missing);
 *  - a 409's `item` that is malformed is dropped (the console falls back to the polled copy).
 */
import { describe, expect, it } from 'vitest'
import { isInjectAssigneesDto, isInjectItemDto, isInjectPostDto, isInjectQueueDto } from './injectGuards'
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

describe('isInjectQueueDto', () => {
  it('accepts a queue of good items', () => {
    expect(isInjectQueueDto({ items: [makeItem({ id: 'a' }), makeItem({ id: 'b' })], pauseTier: 'running' }))
      .toBe(true)
  })

  it('rejects the WHOLE queue when one item has a malformed child (never a half-rendered sheet)', () => {
    const bad = makeItem({ id: 'bad', posts: [makePost({ status: 'weird' as never })] })
    expect(isInjectQueueDto({ items: [makeItem({ id: 'ok' }), bad], pauseTier: 'running' })).toBe(false)
  })

  it('rejects an unknown pause tier', () => {
    expect(isInjectQueueDto({ items: [], pauseTier: 'melted' })).toBe(false)
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
