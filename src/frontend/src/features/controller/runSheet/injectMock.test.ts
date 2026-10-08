/**
 * features/controller/runSheet/injectMock.test.ts
 * ---------------------------------------------------------------------------
 * The in-memory inject queue (the mock behind `InjectService`) behaves like story
 * 06's server (inject-queue story 07, AC "Mock parity"). The bursts run on timers,
 * so the pacing tests use FAKE timers:
 *
 *  - state machine: every allowed transition and the refusals (409 + the current item);
 *  - versions (IQ-9): every change bumps `version`; a stale edit/delete is a 409;
 *    two concurrent fires publish ONE post and the loser gets a 409;
 *  - burst pacing (IQ-4): first post at release, then increasing offsets with gaps
 *    >= 3 s; at most one child per burst per tick; nothing dumps;
 *  - pause tiers (IQ-5): INJECTS suspends bursts but manual fire works; FREEZE
 *    refuses fire/retry and suspends bursts; ENGINE has no effect;
 *  - lateness shift: after a suspension the remainder shifts, it never dumps;
 *  - held / skipped / retried bursts; reply waits; failure is visible, never a false "fired".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MIN_BURST_GAP_SECONDS, createInjectMock, planBurstOffsets } from './injectMock'
import { InjectConflictError, InjectNotFoundError, InjectValidationError } from './injectErrors'
import type { InjectItemDto, InjectItemWrite, InjectPostWrite } from './types'

const post = (text: string, extra: Partial<InjectPostWrite> = {}): InjectPostWrite => ({
  personaId: 'persona-fairhavenwater',
  text,
  ...extra,
})

const single = (title = 'Single', extra: Partial<InjectItemWrite> = {}): InjectItemWrite => ({
  kind: 'post',
  title,
  posts: [post(`${title} text`)],
  ...extra,
})

const burst = (count = 4, window = 90, extra: Partial<InjectItemWrite> = {}): InjectItemWrite => ({
  kind: 'burst',
  title: 'Burst',
  burstWindowSeconds: window,
  posts: Array.from({ length: count }, (_, i) => post(`burst ${i + 1}`)),
  ...extra,
})

function makeMock(seed: InjectItemWrite[] = []) {
  return createInjectMock({ seed })
}

const conflictOf = async (promise: Promise<unknown>): Promise<InjectConflictError> => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(InjectConflictError)
  return error as InjectConflictError
}

const item = (mock: ReturnType<typeof makeMock>, id: string): InjectItemDto => {
  const found = mock.snapshot().items.find(i => i.id === id)
  if (!found) throw new Error(`no item ${id}`)
  return found
}

describe('planBurstOffsets', () => {
  it('first post at 0, then strictly increasing with every gap >= 3 s', () => {
    for (const [count, window] of [[2, 30], [6, 90], [12, 120], [20, 600], [20, 30]] as const) {
      const offsets = planBurstOffsets(count, window, 7)
      expect(offsets).toHaveLength(count)
      expect(offsets[0]).toBe(0)
      for (let i = 1; i < offsets.length; i++) {
        const gap = (offsets[i] ?? 0) - (offsets[i - 1] ?? 0)
        expect(gap).toBeGreaterThanOrEqual(MIN_BURST_GAP_SECONDS - 1e-9)
      }
    }
  })

  it('spreads the posts across ~the window when it is wide enough, with jitter', () => {
    const offsets = planBurstOffsets(10, 90, 3)
    const last = offsets[offsets.length - 1] ?? 0
    expect(last).toBeGreaterThan(90 * 0.75)
    expect(last).toBeLessThan(90 * 1.25)
    const gaps = offsets.slice(1).map((o, i) => o - (offsets[i] ?? 0))
    expect(new Set(gaps.map(g => g.toFixed(2))).size).toBeGreaterThan(1)
  })

  it('a window too tight for the count is floored at 3 s per gap (a direct call; the write is refused)', () => {
    const offsets = planBurstOffsets(20, 30, 1)
    expect((offsets[19] ?? 0)).toBeGreaterThanOrEqual(19 * MIN_BURST_GAP_SECONDS)
  })

  it('the last post is due no later than the window; a window with no slack is exactly 3 s apart', () => {
    for (const [count, window] of [[2, 30], [6, 90], [12, 40], [20, 57], [20, 600]] as const) {
      const offsets = planBurstOffsets(count, window, 11)
      expect(offsets[offsets.length - 1] ?? 0).toBeLessThanOrEqual(window)
    }
    // 20 posts need at least 57 s: with exactly 57 there is no slack, so every gap is exactly 3 s.
    expect(planBurstOffsets(20, 57, 4)).toEqual(Array.from({ length: 20 }, (_, k) => k * 3))
  })

  it('is deterministic for a seed and a single post is just [0]', () => {
    expect(planBurstOffsets(6, 90, 5)).toEqual(planBurstOffsets(6, 90, 5))
    expect(planBurstOffsets(1, 90)).toEqual([0])
  })
})

describe('create / read / edit / delete / reorder', () => {
  it('creates at the end with version 1, resolves the assignee name, lists in order', async () => {
    const mock = makeMock()
    const a = await mock.create(single('A', { assigneeId: 'human-controller-02' }))
    const b = await mock.create(single('B'))
    expect([a.order, b.order]).toEqual([1, 2])
    expect(a.version).toBe(1)
    expect(a.status).toBe('pending')
    expect(a.assigneeName).toBe('Jordan Ames')
    expect(b.assigneeId).toBeNull()
    const queue = await mock.list()
    expect(queue.items.map(i => i.title)).toEqual(['A', 'B'])
    expect(queue.pauseTier).toBe('running')
  })

  it('rejects invalid writes with a 400 carrying field errors (same rules as the server)', async () => {
    const mock = makeMock()
    const error = await mock
      .create({ kind: 'burst', title: '', posts: [post('x')], burstWindowSeconds: 5 })
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(InjectValidationError)
    const fields = (error as InjectValidationError).fieldErrors
    expect(fields.title).toBeDefined()
    expect(fields.posts).toBeDefined()
    expect(fields.burstWindowSeconds).toBeDefined()
    await expect(
      mock.create(single('x', { assigneeId: 'not-staff-here' })),
    ).rejects.toBeInstanceOf(InjectValidationError)
  })

  it('edits a pending item at the right version and bumps the version', async () => {
    const mock = makeMock([single('A')])
    const [first] = (await mock.list()).items
    if (!first) throw new Error('seed missing')
    const updated = await mock.update(first.id, single('A2'), first.version)
    expect(updated.title).toBe('A2')
    expect(updated.version).toBe(first.version + 1)
  })

  it('a stale version is a 409 carrying the CURRENT item', async () => {
    const mock = makeMock([single('A')])
    const [first] = (await mock.list()).items
    if (!first) throw new Error('seed missing')
    await mock.update(first.id, single('Changed by peer'), first.version)
    const conflict = await conflictOf(mock.update(first.id, single('Mine'), first.version))
    expect(conflict.item?.title).toBe('Changed by peer')
    expect(conflict.item?.version).toBe(first.version + 1)
  })

  it('refuses edits to fired / firing / skipped items (409) but allows held and failed', async () => {
    const mock = makeMock([single('Fired'), single('Skipped'), single('Held'), burst(3)])
    const [fired, skipped, held, running] = mock.snapshot().items
    if (!fired || !skipped || !held || !running) throw new Error('seed missing')
    await mock.fire(fired.id)
    await mock.skip(skipped.id)
    await mock.hold(held.id)
    await mock.fire(running.id)
    for (const target of [fired, skipped, running]) {
      const fresh = item(mock, target.id)
      await conflictOf(mock.update(target.id, single('x'), fresh.version))
    }
    const freshHeld = item(mock, held.id)
    await expect(mock.update(held.id, single('Held edited'), freshHeld.version)).resolves.toBeDefined()
  })

  it('deletes pending/held/skipped, renumbers, and refuses fired/firing and stale versions', async () => {
    const mock = makeMock([single('A'), single('B'), single('C')])
    const [a, b, c] = mock.snapshot().items
    if (!a || !b || !c) throw new Error('seed missing')
    await conflictOf(mock.remove(a.id, a.version + 5))
    await mock.remove(a.id, a.version)
    expect(mock.snapshot().items.map(i => [i.title, i.order])).toEqual([['B', 1], ['C', 2]])
    await mock.fire(b.id)
    await conflictOf(mock.remove(b.id, item(mock, b.id).version))
    await expect(mock.remove('nope', 1)).rejects.toBeInstanceOf(InjectNotFoundError)
    void c
  })

  it('reorders by the full list of ids; a partial or unknown list is a 400', async () => {
    const mock = makeMock([single('A'), single('B'), single('C')])
    const [a, b, c] = mock.snapshot().items
    if (!a || !b || !c) throw new Error('seed missing')
    const queue = await mock.reorder([c.id, a.id, b.id])
    expect(queue.items.map(i => i.title)).toEqual(['C', 'A', 'B'])
    expect(queue.items.map(i => i.order)).toEqual([1, 2, 3])
    await expect(mock.reorder([a.id])).rejects.toBeInstanceOf(InjectValidationError)
    await expect(mock.reorder([a.id, b.id, 'ghost'])).rejects.toBeInstanceOf(InjectValidationError)
  })
})

describe('fire + the state machine', () => {
  it('fires a single post: fired, a post id, scenario time, wall clock, who fired it', async () => {
    const mock = makeMock([single('A')])
    const [first] = mock.snapshot().items
    if (!first) throw new Error('seed missing')
    const fired = await mock.fire(first.id)
    expect(fired.status).toBe('fired')
    expect(fired.firedCount).toBe(1)
    expect(fired.version).toBe(first.version + 1)
    expect(fired.firedByHumanId).toBe(mock.me)
    expect(fired.firedScenarioTime).toBeDefined()
    const only = fired.posts[0]
    expect(only?.status).toBe('fired')
    expect(only?.firedPostId).toMatch(/^post-mock-/)
    expect(only?.firedWallClock).toBeDefined()
    expect(only?.firedByHumanId).toBe(mock.me)
  })

  it('firing again is a 409 "Already fired" carrying the item and who fired it', async () => {
    const mock = makeMock([single('A')])
    const [first] = mock.snapshot().items
    if (!first) throw new Error('seed missing')
    await mock.as('human-controller-02').fire(first.id)
    const conflict = await conflictOf(mock.fire(first.id))
    expect(conflict.item?.status).toBe('fired')
    expect(conflict.item?.firedByHumanId).toBe('human-controller-02')
  })

  it('two controllers firing at once publish ONE post; the loser gets a 409 (IQ-9)', async () => {
    const mock = makeMock([single('A')])
    const [first] = mock.snapshot().items
    if (!first) throw new Error('seed missing')
    const results = await Promise.allSettled([
      mock.as('human-controller-01').fire(first.id),
      mock.as('human-controller-02').fire(first.id),
    ])
    const ok = results.filter(r => r.status === 'fulfilled')
    const refused = results.filter(r => r.status === 'rejected')
    expect(ok).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(InjectConflictError)
    expect(item(mock, first.id).firedCount).toBe(1)
  })

  it('hold / release / skip / unskip move through the story-06 transitions', async () => {
    const mock = makeMock([single('A')])
    const [first] = mock.snapshot().items
    if (!first) throw new Error('seed missing')
    expect((await mock.hold(first.id)).status).toBe('held')
    expect((await mock.release(first.id)).status).toBe('pending')
    expect((await mock.skip(first.id)).status).toBe('skipped')
    expect((await mock.unskip(first.id)).status).toBe('pending')
    await mock.hold(first.id)
    expect((await mock.skip(first.id)).status).toBe('skipped')
  })

  it('refuses every transition story 06 refuses, with a 409 + the current item', async () => {
    const mock = makeMock([single('Pending'), single('Fired')])
    const [pending, fired] = mock.snapshot().items
    if (!pending || !fired) throw new Error('seed missing')
    await mock.fire(fired.id)
    await conflictOf(mock.release(pending.id)) // not held
    await conflictOf(mock.unskip(pending.id)) // not skipped
    await conflictOf(mock.retry(pending.id)) // not failed
    await conflictOf(mock.hold(fired.id)) // fired is terminal
    await conflictOf(mock.skip(fired.id))
    await conflictOf(mock.fire(fired.id))
    await expect(mock.fire('ghost')).rejects.toBeInstanceOf(InjectNotFoundError)
  })

  it('fire accepts a HELD item (the server releases + fires it directly), though the UI offers Release', async () => {
    const mock = makeMock([single('A')])
    const [first] = mock.snapshot().items
    if (!first) throw new Error('seed missing')
    await mock.hold(first.id)
    const fired = await mock.fire(first.id)
    expect(fired.status).toBe('fired')
    expect(fired.firedByHumanId).toBe(mock.me)
  })

  it('every state change bumps the version', async () => {
    const mock = makeMock([single('A')])
    const [first] = mock.snapshot().items
    if (!first) throw new Error('seed missing')
    const versions = [first.version]
    versions.push((await mock.hold(first.id)).version)
    versions.push((await mock.release(first.id)).version)
    versions.push((await mock.skip(first.id)).version)
    versions.push((await mock.unskip(first.id)).version)
    versions.push((await mock.fire(first.id)).version)
    expect(versions).toEqual([...versions].sort((a, b) => a - b))
    expect(new Set(versions).size).toBe(versions.length)
  })

  it('a peer acts as another controller (assignees report their own id as `me`)', async () => {
    const mock = makeMock([single('A')])
    const peer = mock.as('human-controller-02')
    expect((await peer.assignees()).me).toBe('human-controller-02')
    expect((await mock.assignees()).me).toBe(mock.me)
  })
})

describe('failure is visible, never a false "fired"', () => {
  it('a refused publish marks the post and item failed with the message; retry re-fires it', async () => {
    const mock = makeMock([single('A')])
    const [first] = mock.snapshot().items
    if (!first) throw new Error('seed missing')
    mock.failNextPublish('Media asset not found')
    const failed = await mock.fire(first.id)
    expect(failed.status).toBe('failed')
    expect(failed.error).toBe('Media asset not found')
    expect(failed.firedCount).toBe(0)
    expect(failed.posts[0]?.status).toBe('failed')

    // Failed items are editable; retry re-fires.
    const retried = await mock.retry(first.id)
    expect(retried.status).toBe('fired')
    expect(retried.error).toBeUndefined()
  })

  it('a reply to a post in an UNFIRED other item is a 409 for a single post (Fire the parent first)', async () => {
    const mock = makeMock([single('Parent')])
    const [parent] = mock.snapshot().items
    const parentPostId = parent?.posts[0]?.id
    if (!parent || !parentPostId) throw new Error('seed missing')
    const reply = await mock.create({
      kind: 'post',
      title: 'Reply',
      posts: [post('re', { replyTo: { injectPostId: parentPostId } })],
    })
    const conflict = await conflictOf(mock.fire(reply.id))
    expect(conflict.detail).toBe('Fire the parent first')
    await mock.fire(parent.id)
    expect((await mock.fire(reply.id)).status).toBe('fired')
  })
})

describe('burst pacing (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2033-09-04T14:00:00.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** Wall-clock ms at which each child fired, in sequence order. */
  const firedAt = (mock: ReturnType<typeof makeMock>, id: string): number[] =>
    item(mock, id)
      .posts.filter(p => p.firedWallClock)
      .map(p => new Date(p.firedWallClock ?? '').getTime())

  it('publishes the first post immediately, then the rest across the window, >= 3 s apart', async () => {
    const mock = makeMock([burst(6, 90)])
    const [b] = mock.snapshot().items
    if (!b) throw new Error('seed missing')
    const response = await mock.fire(b.id)
    expect(response.status).toBe('firing')
    expect(response.firedCount).toBe(1)
    expect(response.total).toBe(6)

    // Nothing else goes out in the first couple of seconds (gaps are >= 3 s)...
    vi.advanceTimersByTime(1000)
    expect(item(mock, b.id).firedCount).toBe(1)

    // ...then it finishes within ~window + one tick of lateness per post.
    vi.advanceTimersByTime(120_000)
    const done = item(mock, b.id)
    expect(done.status).toBe('fired')
    expect(done.firedCount).toBe(6)

    const times = firedAt(mock, b.id)
    expect(times).toHaveLength(6)
    for (let i = 1; i < times.length; i++) {
      expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeGreaterThanOrEqual(3000)
    }
    // Spread over the window, not dumped at once.
    expect((times[5] ?? 0) - (times[0] ?? 0)).toBeGreaterThan(60_000)
  })

  it('"firing n/m" advances as the runner ticks (what the console shows live)', async () => {
    const mock = makeMock([burst(4, 60)])
    const [b] = mock.snapshot().items
    if (!b) throw new Error('seed missing')
    await mock.fire(b.id)
    const seen = new Set<number>([item(mock, b.id).firedCount])
    for (let t = 0; t < 100; t++) {
      vi.advanceTimersByTime(1000)
      seen.add(item(mock, b.id).firedCount)
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4])
  })

  it('exposes increasing dueOffsetSeconds from release on each child', async () => {
    const mock = makeMock([burst(5, 90)])
    const [b] = mock.snapshot().items
    if (!b) throw new Error('seed missing')
    const fired = await mock.fire(b.id)
    const offsets = fired.posts.map(p => p.dueOffsetSeconds ?? -1)
    expect(offsets[0]).toBe(0)
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i] ?? 0).toBeGreaterThanOrEqual(
        (offsets[i - 1] ?? 0) + MIN_BURST_GAP_SECONDS - 1e-9,
      )
    }
  })

  it('PAUSE INJECTS suspends the burst but manual fire still works (IQ-5)', async () => {
    const mock = makeMock([burst(4, 60), single('Manual')])
    const [b, manual] = mock.snapshot().items
    if (!b || !manual) throw new Error('seed missing')
    await mock.fire(b.id)
    mock.setPauseTier('injects')
    expect((await mock.list()).pauseTier).toBe('injects')

    vi.advanceTimersByTime(300_000)
    expect(item(mock, b.id).firedCount).toBe(1) // nothing published while paused
    expect((await mock.fire(manual.id)).status).toBe('fired') // manual fire still works
  })

  it('on resume the remainder shifts by the lateness — overdue posts never dump together', async () => {
    const mock = makeMock([burst(5, 60)])
    const [b] = mock.snapshot().items
    if (!b) throw new Error('seed missing')
    await mock.fire(b.id)
    mock.setPauseTier('injects')
    vi.advanceTimersByTime(300_000) // 5 minutes: every remaining child is hugely overdue
    mock.setPauseTier('running')

    // One tick after resume: AT MOST one child goes out, not the whole backlog.
    vi.advanceTimersByTime(1000)
    expect(item(mock, b.id).firedCount).toBeLessThanOrEqual(2)

    vi.advanceTimersByTime(200_000)
    const times = firedAt(mock, b.id)
    expect(times).toHaveLength(5)
    // After the pause, every consecutive pair is still >= 3 s apart (the original spacing).
    for (let i = 2; i < times.length; i++) {
      expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeGreaterThanOrEqual(3000)
    }
  })

  it('FREEZE refuses fire and retry (409) and suspends bursts; ENGINE PAUSED changes nothing', async () => {
    const mock = makeMock([burst(4, 60), single('A')])
    const [b, a] = mock.snapshot().items
    if (!b || !a) throw new Error('seed missing')
    mock.setPauseTier('engine')
    await mock.fire(b.id)
    vi.advanceTimersByTime(30_000)
    const during = item(mock, b.id).firedCount
    expect(during).toBeGreaterThan(1) // the engine tier has no effect on bursts

    mock.setPauseTier('freeze')
    const conflict = await conflictOf(mock.fire(a.id))
    expect(conflict.detail).toContain('The world is frozen')
    await conflictOf(mock.retry(a.id))
    vi.advanceTimersByTime(300_000)
    expect(item(mock, b.id).firedCount).toBe(during) // suspended
    expect((await mock.list()).pauseTier).toBe('freeze')
  })

  it('HOLD suspends a running burst; release resumes it paced', async () => {
    const mock = makeMock([burst(4, 60)])
    const [b] = mock.snapshot().items
    if (!b) throw new Error('seed missing')
    await mock.fire(b.id)
    expect((await mock.hold(b.id)).status).toBe('held')
    vi.advanceTimersByTime(300_000)
    expect(item(mock, b.id).firedCount).toBe(1)

    expect((await mock.release(b.id)).status).toBe('firing') // already started
    vi.advanceTimersByTime(1000)
    expect(item(mock, b.id).firedCount).toBeLessThanOrEqual(2)
    vi.advanceTimersByTime(200_000)
    expect(item(mock, b.id).status).toBe('fired')
  })

  it('skipping a part-fired burst skips the remainder; unskip puts it back as held', async () => {
    const mock = makeMock([burst(4, 60)])
    const [b] = mock.snapshot().items
    if (!b) throw new Error('seed missing')
    await mock.fire(b.id)
    await mock.hold(b.id)
    const skipped = await mock.skip(b.id)
    expect(skipped.status).toBe('skipped')
    expect(skipped.firedCount).toBe(1)
    expect(skipped.posts.map(p => p.status)).toEqual(['fired', 'skipped', 'skipped', 'skipped'])
    vi.advanceTimersByTime(300_000)
    expect(item(mock, b.id).firedCount).toBe(1)

    const back = await mock.unskip(b.id)
    expect(back.status).toBe('held')
    expect(back.posts.map(p => p.status)).toEqual(['fired', 'pending', 'pending', 'pending'])
  })

  it('a child replying to an earlier sibling (`{ sequence }`, set at CREATE) waits for its parent', async () => {
    const mock = makeMock([
      {
        ...burst(3, 60),
        posts: [
          post('parent'),
          post('child', { replyTo: { sequence: 1 } }),
          post('last'),
        ],
      },
    ])
    const [b] = mock.snapshot().items
    const first = b?.posts[0]
    if (!b || !first) throw new Error('seed missing')
    // Stored against the sibling's id, so it survives later reorders.
    expect(b.posts[1]?.replyTo).toEqual({ injectPostId: first.id })
    await mock.fire(b.id)
    vi.advanceTimersByTime(200_000)
    const done = item(mock, b.id)
    expect(done.status).toBe('fired')
    expect(done.posts.map(p => p.status)).toEqual(['fired', 'fired', 'fired'])
    // The child went out AFTER its parent.
    const [p1, p2] = done.posts.map(p => new Date(p.firedWallClock ?? '').getTime())
    expect(p2).toBeGreaterThanOrEqual(p1 ?? 0)
  })

  it('a burst child that fails fails the item at the end; retry re-fires only the failed child', async () => {
    const mock = makeMock([burst(3, 60)])
    const [b] = mock.snapshot().items
    if (!b) throw new Error('seed missing')
    await mock.fire(b.id)
    mock.failNextPublish('Post refused by the funnel')
    vi.advanceTimersByTime(200_000)
    const failed = item(mock, b.id)
    expect(failed.status).toBe('failed')
    expect(failed.error).toBe('Post refused by the funnel')
    expect(failed.firedCount).toBe(2)

    const retried = await mock.retry(b.id)
    expect(['firing', 'fired']).toContain(retried.status)
    vi.advanceTimersByTime(200_000)
    const done = item(mock, b.id)
    expect(done.status).toBe('fired')
    expect(done.firedCount).toBe(3)
  })
})

describe('child identity on PUT + sibling replies (contract amendment)', () => {
  const three = (): InjectItemWrite => ({
    kind: 'burst',
    title: 'Trio',
    burstWindowSeconds: 60,
    posts: [post('one'), post('two', { replyTo: { sequence: 1 } }), post('three')],
  })

  it('create accepts `{ sequence }` for an earlier sibling and echoes it as that sibling\'s id', async () => {
    const mock = makeMock()
    const created = await mock.create(three())
    expect(created.posts[1]?.replyTo).toEqual({ injectPostId: created.posts[0]?.id })
    expect(created.posts[0]?.replyTo).toBeUndefined()
  })

  it('refuses `{ sequence }` at or after the post itself, with the error on that post (400)', async () => {
    const mock = makeMock()
    const bad = three()
    bad.posts[0] = post('one', { replyTo: { sequence: 1 } })
    const error = await mock.create(bad).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(InjectValidationError)
    expect((error as InjectValidationError).fieldErrors['posts.0.replyTo']).toBeDefined()
  })

  it('a child echoing its id keeps its identity across an edit; no id = a new child', async () => {
    const mock = makeMock()
    const created = await mock.create(three())
    const [p1, p2, p3] = created.posts
    if (!p1 || !p2 || !p3) throw new Error('fixture')
    const updated = await mock.update(
      created.id,
      {
        ...three(),
        posts: [
          { ...post('one edited'), id: p1.id },
          { ...post('two'), id: p2.id, replyTo: { sequence: 1 } },
          { ...post('three'), id: p3.id },
          post('brand new'),
        ],
      },
      created.version,
    )
    expect(updated.posts.map(p => p.id).slice(0, 3)).toEqual([p1.id, p2.id, p3.id])
    expect(updated.posts[3]?.id).toBeDefined()
    expect([p1.id, p2.id, p3.id]).not.toContain(updated.posts[3]?.id)
    expect(updated.posts[0]?.text).toBe('one edited')
    expect(updated.posts.map(p => p.sequence)).toEqual([1, 2, 3, 4])
    expect(updated.posts[1]?.replyTo).toEqual({ injectPostId: p1.id })
  })

  it('an unfired child left out is removed; the rest are re-sequenced', async () => {
    const mock = makeMock()
    const created = await mock.create(three())
    const [p1, , p3] = created.posts
    if (!p1 || !p3) throw new Error('fixture')
    const updated = await mock.update(
      created.id,
      { ...three(), posts: [{ ...post('one'), id: p1.id }, { ...post('three'), id: p3.id }] },
      created.version,
    )
    expect(updated.posts.map(p => p.id)).toEqual([p1.id, p3.id])
    expect(updated.posts.map(p => p.sequence)).toEqual([1, 2])
    expect(updated.total).toBe(2)
  })

  it('reordering by array position keeps each child\'s identity and its reply pointer', async () => {
    const mock = makeMock()
    const created = await mock.create(three())
    const [p1, p2, p3] = created.posts
    if (!p1 || !p2 || !p3) throw new Error('fixture')
    // Move `three` to the front: [three, one, two]. `two` still replies to `one`, now #2.
    const updated = await mock.update(
      created.id,
      {
        ...three(),
        posts: [
          { ...post('three'), id: p3.id },
          { ...post('one'), id: p1.id },
          { ...post('two'), id: p2.id, replyTo: { sequence: 2 } },
        ],
      },
      created.version,
    )
    expect(updated.posts.map(p => p.id)).toEqual([p3.id, p1.id, p2.id])
    expect(updated.posts.map(p => p.sequence)).toEqual([1, 2, 3])
    expect(updated.posts[2]?.replyTo).toEqual({ injectPostId: p1.id })
  })

  it('an unknown, foreign or repeated child id is a 400 on that post — and changes nothing', async () => {
    const mock = makeMock([single('Other')])
    const created = await mock.create(three())
    const other = mock.snapshot().items.find(i => i.title === 'Other')
    const foreignId = other?.posts[0]?.id
    const p1 = created.posts[0]
    if (!p1 || !foreignId) throw new Error('fixture')
    const attempt = (posts: InjectPostWrite[]) =>
      mock.update(created.id, { ...three(), posts }, created.version).catch((e: unknown) => e)

    for (const bad of [
      [{ ...post('x'), id: 'ghost' }, post('y')],
      [{ ...post('x'), id: foreignId }, post('y')],
      [{ ...post('x'), id: p1.id }, { ...post('y'), id: p1.id }],
    ]) {
      const error = await attempt(bad)
      expect(error).toBeInstanceOf(InjectValidationError)
    }
    const unchanged = item(mock, created.id)
    expect(unchanged.version).toBe(created.version)
    expect(unchanged.posts.map(p => p.id)).toEqual(created.posts.map(p => p.id))
  })

  /** A 3-post burst released and held mid-way: `one` has fired, the rest are pending (editable). */
  async function heldMidBurst() {
    const mock = makeMock()
    const created = await mock.create(three())
    await mock.fire(created.id) // releases the burst: `one` fires immediately
    await mock.hold(created.id)
    const held = item(mock, created.id)
    expect(held.posts[0]?.status).toBe('fired')
    const [p1, p2, p3] = held.posts
    if (!p1 || !p2 || !p3) throw new Error('fixture')
    // The write that changes nothing: every child echoed with its content as stored.
    const unchanged = (): InjectItemWrite => ({
      ...three(),
      posts: [
        { ...post('one'), id: p1.id },
        { ...post('two'), id: p2.id, replyTo: { sequence: 1 } },
        { ...post('three'), id: p3.id },
      ],
    })
    return { mock, held, p1, p2, p3, unchanged }
  }

  it('a published post cannot be REMOVED by an edit: 409 carrying the current item', async () => {
    const { mock, held, p2, p3 } = await heldMidBurst()
    const conflict = await conflictOf(
      mock.update(
        held.id,
        { ...three(), posts: [{ ...post('two'), id: p2.id }, { ...post('three'), id: p3.id }] },
        held.version,
      ),
    )
    expect(conflict.detail).toBe('Post 1 was already published and cannot be removed.')
    expect(conflict.item?.version).toBe(held.version) // the item did not change
    expect(item(mock, held.id).posts).toHaveLength(3)
    mock.dispose()
  })

  it('a published post cannot be CHANGED by an edit (text, persona, media, reply, baseline): 409', async () => {
    const { mock, held, p1, unchanged } = await heldMidBurst()
    const changes: ((write: InjectItemWrite) => void)[] = [
      write => {
        write.posts[0] = { ...post('TAMPERED'), id: p1.id }
      },
      write => {
        write.posts[0] = { ...post('one'), id: p1.id, personaId: 'persona-newsline7' }
      },
      write => {
        write.posts[0] = { ...post('one'), id: p1.id, media: [{ mediaId: 'm', alt: 'a' }] }
      },
      write => {
        write.posts[0] = { ...post('one'), id: p1.id, replyTo: { postId: 'some-post' } }
      },
      write => {
        write.posts[0] = { ...post('one'), id: p1.id, engagementBaseline: { like: 5 } }
      },
    ]
    for (const change of changes) {
      const write = unchanged()
      change(write)
      const conflict = await conflictOf(mock.update(held.id, write, held.version))
      expect(conflict.detail).toBe('Post 1 was already published and cannot be changed.')
    }
    expect(item(mock, held.id).posts[0]?.text).toBe('one')
    mock.dispose()
  })

  it('echoing every published post unchanged is fine, and unpublished posts may change freely', async () => {
    const { mock, held, p1, p2, p3 } = await heldMidBurst()
    const updated = await mock.update(
      held.id,
      {
        ...three(),
        posts: [
          { ...post('one'), id: p1.id },
          { ...post('three, edited'), id: p3.id },
          { ...post('two, moved'), id: p2.id },
          post('a new one'),
        ],
      },
      held.version,
    )
    expect(updated.posts.map(p => p.text)).toEqual(['one', 'three, edited', 'two, moved', 'a new one'])
    expect(updated.posts[0]?.status).toBe('fired')
    mock.dispose()
  })

  it('the KIND cannot change once the item has fired (409); before release it can', async () => {
    const { mock, held, unchanged } = await heldMidBurst()
    const asSingle: InjectItemWrite = { ...unchanged(), kind: 'post', posts: unchanged().posts.slice(0, 1) }
    const conflict = await conflictOf(mock.update(held.id, asSingle, held.version))
    expect(conflict.detail).toBe("An item's kind cannot change once it has fired.")
    mock.dispose()

    const fresh = makeMock([single('Solo')])
    const [solo] = fresh.snapshot().items
    if (!solo) throw new Error('seed missing')
    const asBurst = await fresh.update(
      solo.id,
      { ...burst(2, 60), posts: [post('a'), post('b')] },
      solo.version,
    )
    expect(asBurst.kind).toBe('burst') // never released: the kind is still editable
  })

  it('a failed first release counts as released: its kind is fixed too (409)', async () => {
    const mock = makeMock([single('Solo')])
    const [solo] = mock.snapshot().items
    if (!solo) throw new Error('seed missing')
    mock.failNextPublish('Media asset not found')
    const failed = await mock.fire(solo.id)
    expect(failed.status).toBe('failed')
    await conflictOf(
      mock.update(failed.id, { ...burst(2, 60), posts: [post('a'), post('b')] }, failed.version),
    )
  })
})

describe('status codes mirror story 06 (400 = invalid write, 409 = the item refuses it)', () => {
  const body = (): InjectItemWrite => single('Item')
  const inject = (id: string): InjectPostWrite => post('reply', { replyTo: { injectPostId: id } })

  it('checks in the server order: invalid write 400 before stale version 409 before not-editable 409', async () => {
    const mock = makeMock([single('A')])
    const [first] = mock.snapshot().items
    if (!first) throw new Error('seed missing')
    // Invalid AND stale: the server validates first, so it is a 400.
    const invalid = await mock
      .update(first.id, { ...body(), title: '' }, first.version + 9)
      .catch((e: unknown) => e)
    expect(invalid).toBeInstanceOf(InjectValidationError)
    // Stale AND not editable (fired): the version is checked first, so the stale message wins.
    await mock.fire(first.id)
    const stale = await conflictOf(mock.update(first.id, body(), 1))
    expect(stale.detail).toMatch(/Changed by someone else/)
    // Current version but fired: read-only.
    const readOnly = await conflictOf(mock.update(first.id, body(), item(mock, first.id).version))
    expect(readOnly.detail).toBe('This item is fired and is read-only.')
  })

  it('a stale delete is a 409; delete is refused for fired/firing and ALLOWED for failed (as on the server)', async () => {
    const mock = makeMock([single('Fired'), single('Failed'), single('Pending')])
    const [fired, failed, pending] = mock.snapshot().items
    if (!fired || !failed || !pending) throw new Error('seed missing')
    await mock.fire(fired.id)
    mock.failNextPublish('boom')
    await mock.fire(failed.id)
    const stale = await conflictOf(mock.remove(pending.id, pending.version + 3))
    expect(stale.detail).toMatch(/Changed by someone else/)
    const refused = await conflictOf(mock.remove(fired.id, item(mock, fired.id).version))
    expect(refused.detail).toBe('This item is fired and cannot be deleted.')
    await expect(mock.remove(failed.id, item(mock, failed.id).version)).resolves.toBeUndefined()
  })

  it('bad references are 400 (not 409): a foreign child id, an unknown assignee, a dangling or later reply', async () => {
    const mock = makeMock([single('Other')])
    const created = await mock.create(burst(3, 60))
    const [p1, p2] = created.posts
    if (!p1 || !p2) throw new Error('fixture')
    const attempts: Record<string, InjectItemWrite> = {
      assignee: { ...body(), assigneeId: 'not-staff' },
      dangling: { ...burst(2, 60), posts: [post('a'), inject('ghost')] },
      // A sibling named by id must come EARLIER in the new order.
      later: {
        ...burst(2, 60),
        posts: [{ ...inject(p2.id), id: p1.id }, { ...post('b'), id: p2.id }],
      },
    }
    for (const [name, write] of Object.entries(attempts)) {
      const error = await mock.update(created.id, write, created.version).catch((e: unknown) => e)
      expect(error, name).toBeInstanceOf(InjectValidationError)
    }
    // On CREATE there are no children yet, so any id is refused.
    await expect(mock.create({ ...body(), posts: [{ ...post('x'), id: 'whatever' }] }))
      .rejects.toBeInstanceOf(InjectValidationError)
    // A reply to a post of ANOTHER item is fine; to a child this edit removes is not.
    const other = mock.snapshot().items.find(i => i.title === 'Other')
    const otherPost = other?.posts[0]?.id
    if (!otherPost) throw new Error('fixture')
    await expect(
      mock.update(created.id, { ...burst(2, 60), posts: [post('a'), inject(otherPost)] }, created.version),
    ).resolves.toBeDefined()
    const removed = await mock
      .update(
        created.id,
        { ...burst(2, 60), posts: [post('a'), inject(p1.id)] },
        item(mock, created.id).version,
      )
      .catch((e: unknown) => e)
    expect(removed).toBeInstanceOf(InjectValidationError)
  })

  it('an unknown item is 404; a bad reorder is 400', async () => {
    const mock = makeMock([single('A')])
    await expect(mock.update('ghost', body(), 1)).rejects.toBeInstanceOf(InjectNotFoundError)
    await expect(mock.remove('ghost', 1)).rejects.toBeInstanceOf(InjectNotFoundError)
    await expect(mock.reorder([])).rejects.toBeInstanceOf(InjectValidationError)
  })
})

describe('the burst window must hold every 3 s gap (story 06: window >= 3 x (posts - 1))', () => {
  const n = (count: number, window?: number): InjectItemWrite => ({
    kind: 'burst',
    title: 'B',
    ...(window === undefined ? {} : { burstWindowSeconds: window }),
    posts: Array.from({ length: count }, (_, i) => post(`p${i}`)),
  })

  it('20 posts need at least 57 s: 56 is a 400 with a clear message, 57 is accepted', async () => {
    const mock = makeMock()
    const error = (await mock.create(n(20, 56)).catch((e: unknown) => e)) as InjectValidationError
    expect(error).toBeInstanceOf(InjectValidationError)
    expect(error.fieldErrors.burstWindowSeconds).toBe('A 20-post burst needs at least 57 seconds')
    await expect(mock.create(n(20, 57))).resolves.toBeDefined()
  })

  it('binds only above the 30 s floor: 11 posts fit in 30 s, 12 need 33', async () => {
    const mock = makeMock()
    await expect(mock.create(n(11, 30))).resolves.toBeDefined()
    await expect(mock.create(n(12, 32))).rejects.toBeInstanceOf(InjectValidationError)
    await expect(mock.create(n(12, 33))).resolves.toBeDefined()
  })

  it('the default window (90 s) always holds a full burst', async () => {
    const mock = makeMock()
    await expect(mock.create(n(20))).resolves.toBeDefined()
  })

  it('is enforced on edit as well', async () => {
    const mock = makeMock()
    const created = await mock.create(n(20, 60))
    await expect(mock.update(created.id, n(20, 40), created.version))
      .rejects.toBeInstanceOf(InjectValidationError)
  })
})
