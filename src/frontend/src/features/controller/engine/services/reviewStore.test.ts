/**
 * features/controller/engine/services/reviewStore.test.ts
 * ---------------------------------------------------------------------------
 * Covers the mock review store (engine-review-cockpit/01; COR-001, XC-002),
 * mirroring `postStore.test.ts`:
 *  - seeded with mock Fairhaven bursts, all stamped with the mock exercise id;
 *  - `getItems()` is a referentially-stable snapshot between mutations, a new
 *    identity after one;
 *  - `updateDisposition` / `replaceItem` update the addressed item immutably;
 *  - `subscribe` notifies on mutation and the unsubscribe stops it;
 *  - `resetForTests` restores the baseline and clears listeners.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { DraftDisposition } from '../models/reviewContracts'
import { reviewStore } from './reviewStore'

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:00Z') })
  reviewStore.resetForTests()
})

afterEach(() => {
  resetExerciseClock()
})

describe('reviewStore — seeding & isolation', () => {
  it('seeds mock bursts all stamped with the mock exercise id (COR-001)', () => {
    const items = reviewStore.getItems()
    expect(items.length).toBeGreaterThan(0)
    expect(items.every(i => i.exerciseId === 'ex-mock-0001')).toBe(true)
  })

  it('seeds every review state (counting-down, queued, held)', () => {
    const dispositions = new Set(reviewStore.getItems().map(i => i.disposition))
    expect(dispositions.has(DraftDisposition.CountingDown)).toBe(true)
    expect(dispositions.has(DraftDisposition.Queued)).toBe(true)
    expect(dispositions.has(DraftDisposition.Held)).toBe(true)
  })
})

describe('reviewStore — snapshot identity & mutation', () => {
  it('returns a stable reference between mutations and a new one after', () => {
    const before = reviewStore.getItems()
    expect(reviewStore.getItems()).toBe(before)

    reviewStore.updateDisposition('draft-fulco-reassure', DraftDisposition.Published)
    expect(reviewStore.getItems()).not.toBe(before)
    expect(reviewStore.getItems().find(i => i.draftId === 'draft-fulco-reassure')?.disposition).toBe(
      DraftDisposition.Published,
    )
  })

  it('replaceItem applies an immutable update to the addressed item', () => {
    reviewStore.replaceItem('draft-scoop-amplify', item =>
      item.withDisposition(DraftDisposition.Vetoed),
    )
    expect(reviewStore.getItems().find(i => i.draftId === 'draft-scoop-amplify')?.disposition).toBe(
      DraftDisposition.Vetoed,
    )
  })

  it('is a no-op for an unknown draft id', () => {
    const before = reviewStore.getItems()
    reviewStore.updateDisposition('draft-nope', DraftDisposition.Published)
    expect(reviewStore.getItems()).toBe(before)
  })
})

describe('reviewStore — subscription & reset', () => {
  it('notifies subscribers on mutation and stops after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = reviewStore.subscribe(listener)

    reviewStore.updateDisposition('draft-fulco-reassure', DraftDisposition.Published)
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    reviewStore.updateDisposition('draft-scoop-amplify', DraftDisposition.Vetoed)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('resetForTests restores the baseline and clears listeners', () => {
    const listener = vi.fn()
    reviewStore.subscribe(listener)
    reviewStore.updateDisposition('draft-fulco-reassure', DraftDisposition.Published)

    reviewStore.resetForTests()

    expect(reviewStore.getItems().find(i => i.draftId === 'draft-fulco-reassure')?.disposition).toBe(
      DraftDisposition.CountingDown,
    )
    reviewStore.updateDisposition('draft-fulco-reassure', DraftDisposition.Published)
    expect(listener).toHaveBeenCalledTimes(1) // the pre-reset listener was cleared
  })
})
