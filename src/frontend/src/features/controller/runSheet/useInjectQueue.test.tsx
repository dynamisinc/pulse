/**
 * features/controller/runSheet/useInjectQueue.test.tsx
 * ---------------------------------------------------------------------------
 * The run sheet's server-state hook (inject-queue story 07, AC "Live sync", IQ-6):
 *  - it POLLS `GET /api/injects` every ~3 s while visible: another controller's change
 *    (made on the mock BETWEEN polls) shows up on the next tick, and not before;
 *  - it does NOT poll while the tab is in the background;
 *  - an own mutation re-reads IMMEDIATELY (no 3 s wait): the cache is patched from the
 *    server's reply and the list is re-fetched;
 *  - a 409 patches the row from the item the server returned (no second call needed);
 *  - a double press sends ONE request (`busy`), actions never reject;
 *  - useInjectAssignees resolves `me` and names.
 *
 * Drives the REAL in-memory mock under FAKE timers (React Query's interval, the mock's
 * burst runner and Date are all faked). `act` + `advanceTimersByTimeAsync` replace
 * `waitFor`, which polls on the faked timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { INJECT_POLL_MS, useInjectQueue } from './useInjectQueue'
import { useInjectAssignees } from './useInjectAssignees'
import { InjectConflictError } from './injectErrors'
import { MOCK_ME, injectMock } from './injectMock'
import { createWrapper, makeQueryClient } from './runSheetTestHarness'
import type { InjectItemWrite } from './types'

const PEER = 'human-controller-02'

const single = (title: string): InjectItemWrite => ({
  kind: 'post',
  title,
  assigneeId: MOCK_ME,
  posts: [{ personaId: 'persona-fairhavenwater', text: `${title} text` }],
})

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/**
 * Lets the exercise scope resolve AND the first queue read land. Two passes: the provider
 * renders nothing (so the hook is not mounted and nothing is fetched) until its `act`
 * commits, and only then does the first read start.
 */
async function settle(): Promise<void> {
  await flush(10)
  await flush(10)
  await flush(10)
}

type HookRender<T> = ReturnType<typeof renderHook<T, unknown>>

/** Mounts the hook inside `act` so the exercise provider's async resolve is accounted for. */
async function mount() {
  const client = makeQueryClient()
  let rendered: HookRender<ReturnType<typeof useInjectQueue>> | undefined
  await act(async () => {
    rendered = renderHook(() => useInjectQueue(), { wrapper: createWrapper(client) })
  })
  if (!rendered) throw new Error('hook did not mount')
  return rendered
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2033-09-04T14:00:00.000Z'))
  injectMock.reset({ seed: [single('A'), single('B')] })
})

afterEach(() => {
  injectMock.dispose()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('useInjectQueue — reading', () => {
  it('loads the queue and the pause tier', async () => {
    const { result } = await mount()
    expect(result.current?.isLoading).toBe(true)
    await settle()
    expect(result.current.isLoading).toBe(false)
    expect(result.current.items.map(i => i.title)).toEqual(['A', 'B'])
    expect(result.current.pauseTier).toBe('running')
  })

  it('polls every ~3 s: another controller\'s change shows on the next tick, not before', async () => {
    expect(INJECT_POLL_MS).toBe(3000)
    const { result } = await mount()
    await settle()
    const first = result.current.items[0]
    if (!first) throw new Error('no items')
    expect(first.status).toBe('pending')

    // Another controller fires item A (a mutation BETWEEN our polls).
    await act(async () => {
      await injectMock.as(PEER).fire(first.id)
    })
    await flush(1000)
    expect(result.current.items[0]?.status).toBe('pending') // not polled yet

    await flush(2600) // past the 3 s mark
    const after = result.current.items[0]
    expect(after?.status).toBe('fired')
    expect(after?.firedByHumanId).toBe(PEER)
  })

  it('picks up another controller\'s hold, skip, edit and a brand-new item', async () => {
    const { result } = await mount()
    await settle()
    const [a, b] = result.current.items
    if (!a || !b) throw new Error('no items')

    await act(async () => {
      const peer = injectMock.as(PEER)
      await peer.hold(a.id)
      await peer.skip(b.id)
      await peer.create(single('C'))
    })
    await flush(3100)
    const byTitle = Object.fromEntries(result.current.items.map(i => [i.title, i.status]))
    expect(byTitle).toEqual({ A: 'held', B: 'skipped', C: 'pending' })
  })

  it('polls only while visible: nothing is fetched in a background tab', async () => {
    const list = vi.spyOn(injectMock, 'list')
    const { result } = await mount()
    await settle()
    expect(result.current.items).toHaveLength(2)
    const baseline = list.mock.calls.length

    const visibility = vi.spyOn(document, 'visibilityState', 'get')
    visibility.mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await flush(15_000)
    expect(list.mock.calls.length).toBe(baseline)

    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await flush(3100)
    expect(list.mock.calls.length).toBeGreaterThan(baseline)
  })
})

describe('useInjectQueue — mutations', () => {
  it('an own mutation shows immediately and re-reads at once (no 3 s wait)', async () => {
    const list = vi.spyOn(injectMock, 'list')
    const { result } = await mount()
    await settle()
    const first = result.current.items[0]
    if (!first) throw new Error('no items')
    const before = list.mock.calls.length

    let outcome: Awaited<ReturnType<typeof result.current.hold>> | undefined
    await act(async () => {
      outcome = await result.current.hold(first.id)
    })
    expect(outcome?.status).toBe('ok')
    // Patched from the reply, with NO timers advanced beyond the act...
    expect(result.current.items[0]?.status).toBe('held')
    // ...and the list was re-fetched immediately by the invalidation.
    await flush(10)
    expect(list.mock.calls.length).toBeGreaterThan(before)
  })

  it('exposes fire / hold / release / skip / unskip / retry / remove / create / update / reorder', async () => {
    const { result } = await mount()
    await settle()
    const [a, b] = result.current.items
    if (!a || !b) throw new Error('no items')

    await act(async () => {
      expect((await result.current.hold(a.id)).status).toBe('ok')
      expect((await result.current.release(a.id)).status).toBe('ok')
      expect((await result.current.skip(a.id)).status).toBe('ok')
      expect((await result.current.unskip(a.id)).status).toBe('ok')
    })
    await act(async () => {
      expect((await result.current.fire(a.id)).status).toBe('ok')
    })
    expect(result.current.items.find(i => i.id === a.id)?.status).toBe('fired')

    let createdId = ''
    await act(async () => {
      const created = await result.current.create(single('C'))
      expect(created.status).toBe('ok')
      if (created.status === 'ok') createdId = created.value.id
    })
    expect(result.current.items.map(i => i.title)).toEqual(['A', 'B', 'C'])

    await act(async () => {
      const current = result.current.items.find(i => i.id === createdId)
      if (!current) throw new Error('created item missing')
      const updated = await result.current.update(createdId, single('C2'), current.version)
      expect(updated.status).toBe('ok')
    })
    expect(result.current.items.find(i => i.id === createdId)?.title).toBe('C2')

    await act(async () => {
      const ids = result.current.items.map(i => i.id).reverse()
      expect((await result.current.reorder(ids)).status).toBe('ok')
    })
    expect(result.current.items.map(i => i.title)).toEqual(['C2', 'B', 'A'])

    await act(async () => {
      const current = result.current.items.find(i => i.id === b.id)
      if (!current) throw new Error('b missing')
      expect((await result.current.remove(b.id, current.version)).status).toBe('ok')
    })
    expect(result.current.items.map(i => i.title)).toEqual(['C2', 'A'])
  })

  it('a double press sends ONE request: the second resolves `busy`, nothing else is sent', async () => {
    const fire = vi.spyOn(injectMock, 'fire')
    const { result } = await mount()
    await settle()
    const first = result.current.items[0]
    if (!first) throw new Error('no items')

    let outcomes: string[] = []
    await act(async () => {
      const [one, two] = await Promise.all([
        result.current.fire(first.id),
        result.current.fire(first.id),
      ])
      outcomes = [one.status, two.status]
    })
    expect(outcomes).toEqual(['ok', 'busy'])
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('the lock is per row: a different row is not blocked', async () => {
    const fire = vi.spyOn(injectMock, 'fire')
    const { result } = await mount()
    await settle()
    const [a, b] = result.current.items
    if (!a || !b) throw new Error('no items')
    await act(async () => {
      const [one, two] = await Promise.all([result.current.fire(a.id), result.current.fire(b.id)])
      expect([one.status, two.status]).toEqual(['ok', 'ok'])
    })
    expect(fire).toHaveBeenCalledTimes(2)
  })

  it('a row is released after the action, so a later press works (and a failed one too)', async () => {
    const { result } = await mount()
    await settle()
    const first = result.current.items[0]
    if (!first) throw new Error('no items')
    await act(async () => {
      await result.current.hold(first.id)
    })
    expect(result.current.busyIds.size).toBe(0)
    await act(async () => {
      expect((await result.current.release(first.id)).status).toBe('ok')
    })
  })

  it('a 409 patches the row from the item the server returned and the outcome carries the error', async () => {
    const { result } = await mount()
    await settle()
    const first = result.current.items[0]
    if (!first) throw new Error('no items')

    // Another controller fires it; our cache still says pending (no poll yet).
    await act(async () => {
      await injectMock.as(PEER).fire(first.id)
    })
    expect(result.current.items[0]?.status).toBe('pending')

    let outcome: Awaited<ReturnType<typeof result.current.fire>> | undefined
    await act(async () => {
      outcome = await result.current.fire(first.id)
    })
    expect(outcome?.status).toBe('error')
    if (outcome?.status === 'error') expect(outcome.error).toBeInstanceOf(InjectConflictError)
    // Refreshed from `error.item` — no waiting for the next poll.
    expect(result.current.items[0]?.status).toBe('fired')
    expect(result.current.items[0]?.firedByHumanId).toBe(PEER)
  })

  it('actions never reject: a refused write resolves to an error outcome', async () => {
    const { result } = await mount()
    await settle()
    const first = result.current.items[0]
    if (!first) throw new Error('no items')
    await act(async () => {
      const outcome = await result.current.release(first.id) // not held -> 409
      expect(outcome.status).toBe('error')
    })
  })

  it('never sends or stores an exerciseId in a request (the id is a cache key only)', async () => {
    const create = vi.spyOn(injectMock, 'create')
    const { result } = await mount()
    await settle()
    await act(async () => {
      await result.current.create(single('C'))
    })
    expect(JSON.stringify(create.mock.calls)).not.toMatch(/exerciseId/i)
  })
})

describe('useInjectAssignees', () => {
  it('resolves me and names (the source of "Mine" and "Already fired by {name}")', async () => {
    const client = makeQueryClient()
    let rendered: HookRender<ReturnType<typeof useInjectAssignees>> | undefined
    await act(async () => {
      rendered = renderHook(() => useInjectAssignees(), { wrapper: createWrapper(client) })
    })
    const result = rendered?.result
    if (!result) throw new Error('hook did not mount')
    expect(result.current?.me).toBeUndefined() // nothing is "mine" until it resolves
    await settle()
    expect(result.current.me).toBe(MOCK_ME)
    expect(result.current.nameOf(PEER)).toBe('Jordan Ames')
    expect(result.current.nameOf('someone-unlisted')).toBeUndefined()
    expect(result.current.nameOf(undefined)).toBeUndefined()
    expect(result.current.assignees.length).toBeGreaterThan(1)
  })
})
