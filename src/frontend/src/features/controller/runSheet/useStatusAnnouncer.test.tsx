/**
 * features/controller/runSheet/useStatusAnnouncer.test.tsx
 * ---------------------------------------------------------------------------
 * The polite live-region text (inject-queue story 07, AC "Keyboard (NFR-001)"):
 *  - the first load is SILENT; only later changes speak;
 *  - a status change reads "{title}: {Status}" (a burst reads "Firing n/m");
 *  - a burst ticking forward INSIDE `firing` is NOT announced (that would thrash a screen reader);
 *  - added / removed items are announced; several changes join into one sentence, capped at three.
 */
import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { describeChanges, useStatusAnnouncer } from './useStatusAnnouncer'
import { makeItem, makePost } from './runSheetTestHarness'
import type { InjectItemDto } from './types'

const snapshot = (items: InjectItemDto[]) =>
  new Map(items.map(i => [i.id, { title: i.title, status: i.status }]))

/** The item after a REAL fire: its post went out, so it carries a published post id ("Fired"). */
const fired = (item: InjectItemDto): InjectItemDto => ({
  ...item,
  status: 'fired',
  posts: [makePost({ status: 'fired', firedPostId: `post-${item.id}` })],
})

describe('describeChanges', () => {
  it('reports a status change as "{title}: {Status}"', () => {
    const before = [makeItem({ id: 'a', title: 'Alpha', status: 'pending' })]
    const published = makePost({ status: 'fired', firedPostId: 'post-1' })
    const after = [makeItem({ id: 'a', title: 'Alpha', status: 'fired', posts: [published] })]
    expect(describeChanges(snapshot(before), after)).toEqual(['Alpha: Fired'])
  })

  it('DF-36: an item marked fired without posting is announced "Marked fired", like its chip', () => {
    const before = [makeItem({ id: 'a', title: 'Alpha', status: 'pending' })]
    const marked = makePost({ status: 'skipped' })
    const after = [makeItem({ id: 'a', title: 'Alpha', status: 'fired', posts: [marked] })]
    expect(describeChanges(snapshot(before), after)).toEqual(['Alpha: Marked fired'])
  })

  it('a burst that starts firing carries its n/m; progress inside firing is silent', () => {
    const pending = makeItem({ id: 'b', title: 'Pile-on', status: 'pending', total: 6 })
    const first = makeItem({ id: 'b', title: 'Pile-on', status: 'firing', firedCount: 1, total: 6 })
    const second = makeItem({ id: 'b', title: 'Pile-on', status: 'firing', firedCount: 2, total: 6 })
    expect(describeChanges(snapshot([pending]), [first])).toEqual(['Pile-on: Firing 1/6'])
    expect(describeChanges(snapshot([first]), [second])).toEqual([])
  })

  it('reports added and removed items', () => {
    const a = makeItem({ id: 'a', title: 'Alpha' })
    const b = makeItem({ id: 'b', title: 'Bravo' })
    expect(describeChanges(snapshot([a]), [a, b])).toEqual(['Added: Bravo'])
    expect(describeChanges(snapshot([a, b]), [a])).toEqual(['Removed: Bravo'])
  })

  it('reports nothing when nothing changed', () => {
    const a = makeItem({ id: 'a' })
    expect(describeChanges(snapshot([a]), [a])).toEqual([])
  })
})

describe('useStatusAnnouncer', () => {
  const a = makeItem({ id: 'a', title: 'Alpha', status: 'pending' })
  const b = makeItem({ id: 'b', title: 'Bravo', status: 'pending' })

  it('is silent while not ready and for the first load', () => {
    const { result, rerender } = renderHook(
      ({ items, ready }: { items: InjectItemDto[]; ready: boolean }) =>
        useStatusAnnouncer(items, ready),
      { initialProps: { items: [] as InjectItemDto[], ready: false } },
    )
    expect(result.current.text).toBe('')
    rerender({ items: [a, b], ready: true })
    expect(result.current.text).toBe('')
  })

  it('announces a later status change', () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: InjectItemDto[] }) => useStatusAnnouncer(items, true),
      { initialProps: { items: [a, b] } },
    )
    rerender({ items: [{ ...a, status: 'held' }, b] })
    expect(result.current.text).toBe('Alpha: Held')
  })

  it('DF-36: announces an item marked fired as "Marked fired" (the chip word), not "Fired"', () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: InjectItemDto[] }) => useStatusAnnouncer(items, true),
      { initialProps: { items: [a, b] } },
    )
    const markedA: InjectItemDto = { ...a, status: 'fired', posts: [makePost({ status: 'skipped' })] }
    rerender({ items: [markedA, b] })
    expect(result.current.text).toBe('Alpha: Marked fired')
    rerender({ items: [markedA, fired(b)] })
    expect(result.current.text).toBe('Bravo: Fired')
  })

  it('two DIFFERENT items with the SAME title are two separate events (the words repeat, the id does not)', () => {
    const one = makeItem({ id: 'one', title: 'Advisory', status: 'pending' })
    const two = makeItem({ id: 'two', title: 'Advisory', status: 'pending' })
    const { result, rerender } = renderHook(
      ({ items }: { items: InjectItemDto[] }) => useStatusAnnouncer(items, true),
      { initialProps: { items: [one, two] } },
    )
    expect(result.current.id).toBe(0)

    rerender({ items: [fired(one), two] })
    const first = result.current
    expect(first.text).toBe('Advisory: Fired')

    rerender({ items: [fired(one), fired(two)] })
    const second = result.current
    expect(second.text).toBe('Advisory: Fired') // identical words...
    expect(second.id).toBeGreaterThan(first.id) // ...but a distinct event: the region speaks again
  })

  it('joins several changes into one sentence, capped at three', () => {
    const many = ['1', '2', '3', '4', '5'].map(n => makeItem({ id: n, title: `Item ${n}` }))
    const { result, rerender } = renderHook(
      ({ items }: { items: InjectItemDto[] }) => useStatusAnnouncer(items, true),
      { initialProps: { items: many } },
    )
    rerender({ items: many.map(fired) })
    expect(result.current.text).toBe(
      'Item 1: Fired. Item 2: Fired. Item 3: Fired. And 2 more changes',
    )
  })
})
