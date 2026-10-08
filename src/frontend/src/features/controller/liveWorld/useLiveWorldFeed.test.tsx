/**
 * features/controller/liveWorld/useLiveWorldFeed.test.tsx
 * ---------------------------------------------------------------------------
 * The data hook behind the Live world column (demo-polish C2): the baseline read
 * (with replies, no exerciseId, provenance narrowed away), arrival BATCHING (a
 * burst is one render, not N), buffer-vs-insert read at apply time, the
 * non-reactive transport mode being re-read, the polling-mode reply sweep and its
 * recovery gap-fill, error + retry, and clean teardown.
 *
 * Fake timers drive the 150ms batch, the 1s mode sync and the 5s sweep; every
 * test restores real timers.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveFeed } from '@/features/social/services/feedService'
import {
  ARRIVAL_BATCH_MS,
  COUNT_REFRESH_JITTER_MS,
  COUNT_REFRESH_MS,
  MODE_SYNC_MS,
  POLLING_SWEEP_MS,
  useLiveWorldFeed,
} from './useLiveWorldFeed'
import { at, createFakeSource, post, view, type FakeSource } from './liveWorldTestKit'

vi.mock('@/features/social/services/feedService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/social/services/feedService')>()
  return { ...actual, resolveFeed: vi.fn() }
})

const mockedResolveFeed = vi.mocked(resolveFeed)

let source: FakeSource
let reading = false

beforeEach(() => {
  vi.useFakeTimers()
  source = createFakeSource()
  reading = false
  mockedResolveFeed.mockReset()
  mockedResolveFeed.mockResolvedValue([])
})

afterEach(() => {
  vi.useRealTimers()
})

/** Mounts the hook and flushes the baseline read. */
async function mount() {
  let renders = 0
  const utils = renderHook(() => {
    renders += 1
    return useLiveWorldFeed({ source, isReading: () => reading })
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  return { ...utils, renders: () => renders }
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function ids(list: readonly { view: { id: string } }[]): string[] {
  return list.map(item => item.view.id)
}

describe('baseline read', () => {
  it('reads the feed with replies, no exerciseId, and reports loading then ready', async () => {
    let finish: (posts: ReturnType<typeof post>[]) => void = () => {}
    mockedResolveFeed.mockReturnValue(new Promise(resolve => {
      finish = resolve
    }))
    const { result } = await mount()
    expect(result.current.status).toBe('loading')
    expect(mockedResolveFeed).toHaveBeenCalledWith('all', { includeReplies: true })

    await act(async () => {
      finish([post('a', { scenarioTime: at(1) }), post('b', { scenarioTime: at(9) })])
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.status).toBe('ready')
    expect(ids(result.current.rows)).toEqual(['b', 'a'])
    expect(JSON.stringify(mockedResolveFeed.mock.calls)).not.toMatch(/exercise/i)
  })

  it('narrows every post to its participant-safe view (XC-002): no provenance survives', async () => {
    mockedResolveFeed.mockResolvedValue([
      post('a', { origin: 'inject', injectId: 'INJ-1', actingHumanId: 'secret' }),
    ])
    const { result } = await mount()
    const keys = Object.keys(result.current.rows[0]?.view ?? {})
    for (const forbidden of ['origin', 'actingHumanId', 'createdWallClock', 'injectId', 'exerciseId']) {
      expect(keys).not.toContain(forbidden)
    }
  })

  it('surfaces a failed read as an error (never an empty ready list), and Retry re-reads', async () => {
    mockedResolveFeed.mockRejectedValueOnce(new Error('down'))
    mockedResolveFeed.mockResolvedValueOnce([post('a')])
    const { result } = await mount()
    expect(result.current.status).toBe('error')
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.rows).toEqual([])

    act(() => result.current.retry())
    expect(result.current.status).toBe('loading')
    expect(result.current.error).toBeUndefined()
    await advance(0)
    expect(result.current.status).toBe('ready')
    expect(ids(result.current.rows)).toEqual(['a'])
  })
})

describe('arrivals', () => {
  it('subscribes BEFORE the baseline read and starts the shared source once', async () => {
    const { result } = await mount()
    expect(source.subscribe).toHaveBeenCalledTimes(1)
    expect(source.start).toHaveBeenCalledTimes(1)
    expect(source.subscribe.mock.invocationCallOrder[0])
      .toBeLessThan(mockedResolveFeed.mock.invocationCallOrder[0] ?? Infinity)
    expect(result.current.rows).toEqual([])
  })

  it('applies a burst of 120 arrivals as ONE render after the batch window', async () => {
    const { result, renders } = await mount()
    const before = renders()

    act(() => {
      for (let i = 0; i < 120; i += 1) source.emit(view(`b${i}`, { scenarioTime: at(0, i % 60) }))
    })
    await advance(ARRIVAL_BATCH_MS - 1)
    expect(result.current.rows).toHaveLength(0) // still queued: no render per post
    expect(renders()).toBe(before)

    await advance(1)
    expect(result.current.rows).toHaveLength(120)
    expect(renders() - before).toBe(1)
  })

  it('keeps state un-shifted while reading and holds arrivals as pending', async () => {
    mockedResolveFeed.mockResolvedValue([post('a', { scenarioTime: at(1) })])
    const { result } = await mount()
    reading = true
    act(() => source.emit(view('n1', { scenarioTime: at(30) })))
    await advance(ARRIVAL_BATCH_MS)

    expect(ids(result.current.rows)).toEqual(['a'])
    expect(ids(result.current.pending)).toEqual(['n1'])

    act(() => result.current.showPending())
    expect(ids(result.current.rows)).toEqual(['n1', 'a'])
    expect(result.current.pending).toEqual([])
  })

  it('reads "is the controller reading?" at APPLY time, not at arrival time', async () => {
    const { result } = await mount()
    reading = true
    act(() => source.emit(view('n1')))
    reading = false // the controller returned to the top before the batch landed
    await advance(ARRIVAL_BATCH_MS)
    expect(ids(result.current.rows)).toEqual(['n1'])
    expect(result.current.pending).toEqual([])
  })

  it('keeps an arrival that beat the baseline and de-duplicates the one in both', async () => {
    let finish: (posts: ReturnType<typeof post>[]) => void = () => {}
    mockedResolveFeed.mockReturnValue(new Promise(resolve => {
      finish = resolve
    }))
    const { result } = await mount()

    act(() => {
      source.emit(view('both', { scenarioTime: at(10) }))
      source.emit(view('early', { scenarioTime: at(20) }))
    })
    await advance(ARRIVAL_BATCH_MS)
    await act(async () => {
      finish([post('both', { scenarioTime: at(10) }), post('base', { scenarioTime: at(5) })])
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(ids(result.current.rows)).toEqual(['early', 'both', 'base'])
  })
})

describe('transport mode', () => {
  it('reports the source mode and re-reads it on a timer (the getter is not reactive)', async () => {
    source.mode = 'connecting'
    const { result } = await mount()
    expect(result.current.mode).toBe('connecting')

    source.mode = 'realtime'
    await advance(MODE_SYNC_MS)
    expect(result.current.mode).toBe('realtime')

    source.mode = 'polling'
    await advance(MODE_SYNC_MS)
    expect(result.current.mode).toBe('polling')
  })
})

describe('polling-mode sweep (replies would otherwise be missed)', () => {
  it('re-reads the baseline WITH replies every few seconds while polling, merging new posts', async () => {
    source.mode = 'polling'
    mockedResolveFeed.mockResolvedValue([post('a', { scenarioTime: at(1) })])
    const { result } = await mount()
    expect(mockedResolveFeed).toHaveBeenCalledTimes(1) // just the baseline: no sweep until a tick

    mockedResolveFeed.mockResolvedValue([
      post('reply', {
        scenarioTime: at(20),
        inReplyTo: { postId: 'a', authorHandle: 'FairhavenWater' },
      }),
      post('a', { scenarioTime: at(1), counts: { reply: 1, repost: 0, like: 7 } }),
    ])
    await advance(POLLING_SWEEP_MS)

    expect(mockedResolveFeed).toHaveBeenLastCalledWith('all', { includeReplies: true })
    expect(ids(result.current.rows)).toEqual(['reply', 'a'])
    expect(result.current.rows[1]?.view.counts.like).toBe(7) // counts refreshed in place
  })

  it('holds swept posts behind pending when the controller is reading', async () => {
    source.mode = 'polling'
    const { result } = await mount()
    reading = true
    mockedResolveFeed.mockResolvedValue([post('swept', { scenarioTime: at(20) })])
    await advance(POLLING_SWEEP_MS)
    expect(result.current.rows).toEqual([])
    expect(ids(result.current.pending)).toEqual(['swept'])
  })

  it('ignores a failed sweep: the badge already says POLLING, and status never flips to error', async () => {
    source.mode = 'polling'
    const { result } = await mount()
    mockedResolveFeed.mockClear()
    mockedResolveFeed.mockRejectedValue(new Error('flaky'))
    await advance(POLLING_SWEEP_MS)
    expect(mockedResolveFeed).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('ready')
    expect(result.current.error).toBeUndefined()
    await advance(POLLING_SWEEP_MS) // and the next tick retries
    expect(mockedResolveFeed).toHaveBeenCalledTimes(2)
  })

  it('never overlaps sweeps: a slow read is not re-requested on the next tick', async () => {
    source.mode = 'polling'
    await mount()
    mockedResolveFeed.mockClear()
    mockedResolveFeed.mockReturnValue(new Promise(() => {})) // never settles
    await advance(POLLING_SWEEP_MS * 3)
    expect(mockedResolveFeed).toHaveBeenCalledTimes(1)
  })

  it('does not run the 5s polling sweep while realtime, and fills the gap ONCE when polling recovers', async () => {
    source.mode = 'polling'
    const { result } = await mount()
    mockedResolveFeed.mockClear()
    mockedResolveFeed.mockResolvedValue([post('gap', { scenarioTime: at(33) })])

    source.mode = 'realtime'
    await advance(MODE_SYNC_MS)
    expect(result.current.mode).toBe('realtime')
    expect(ids(result.current.rows)).toEqual(['gap']) // the one recovery sweep

    mockedResolveFeed.mockClear()
    await advance(POLLING_SWEEP_MS * 3)
    expect(mockedResolveFeed).not.toHaveBeenCalled() // realtime: no 5s polling of our own
  })
})

describe('slow count refresh while REALTIME (L-3)', () => {
  let random: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    random = vi.spyOn(Math, 'random').mockReturnValue(0.5) // zero jitter: exactly 45s
  })

  afterEach(() => {
    random.mockRestore()
  })

  it('re-reads the baseline every ~45s so counts on listed rows keep moving, until unmount', async () => {
    mockedResolveFeed.mockResolvedValue([post('a', { scenarioTime: at(1) })])
    const { result, unmount } = await mount()
    expect(mockedResolveFeed).toHaveBeenCalledTimes(1) // the baseline

    mockedResolveFeed.mockResolvedValue([
      post('a', { scenarioTime: at(1), counts: { reply: 2, repost: 3, like: 41 } }),
    ])
    await advance(COUNT_REFRESH_MS - 1)
    expect(mockedResolveFeed).toHaveBeenCalledTimes(1)
    expect(result.current.rows[0]?.view.counts.like).toBe(0)

    await advance(1)
    expect(mockedResolveFeed).toHaveBeenCalledTimes(2)
    expect(mockedResolveFeed).toHaveBeenLastCalledWith('all', { includeReplies: true })
    expect(result.current.rows[0]?.view.counts).toMatchObject({ reply: 2, repost: 3, like: 41 })

    await advance(COUNT_REFRESH_MS) // ... and again
    expect(mockedResolveFeed).toHaveBeenCalledTimes(3)

    unmount()
    expect(vi.getTimerCount()).toBe(0) // the refresh timer is gone
    await advance(COUNT_REFRESH_MS * 3)
    expect(mockedResolveFeed).toHaveBeenCalledTimes(3)
  })

  it('jitters each delay by +/- 15s around 45s', async () => {
    mockedResolveFeed.mockResolvedValue([])
    random.mockReturnValue(0) // the shortest delay: 45s - 15s
    await mount()
    mockedResolveFeed.mockClear()
    await advance(COUNT_REFRESH_MS - COUNT_REFRESH_JITTER_MS - 1)
    expect(mockedResolveFeed).not.toHaveBeenCalled()

    random.mockReturnValue(1) // the NEXT delay is drawn when this one fires: the longest, 45s + 15s
    await advance(1)
    expect(mockedResolveFeed).toHaveBeenCalledTimes(1)

    mockedResolveFeed.mockClear()
    await advance(COUNT_REFRESH_MS + COUNT_REFRESH_JITTER_MS - 1)
    expect(mockedResolveFeed).not.toHaveBeenCalled()
    await advance(1)
    expect(mockedResolveFeed).toHaveBeenCalledTimes(1)
  })

  it('merges by id through the same buffer-or-insert path: new posts are held while reading', async () => {
    mockedResolveFeed.mockResolvedValue([post('a', { scenarioTime: at(1) })])
    const { result } = await mount()
    reading = true
    mockedResolveFeed.mockResolvedValue([
      post('new', { scenarioTime: at(30) }),
      post('a', { scenarioTime: at(1), counts: { reply: 0, repost: 0, like: 9 } }),
    ])
    await advance(COUNT_REFRESH_MS)

    expect(ids(result.current.rows)).toEqual(['a']) // the list did not shift
    expect(result.current.rows[0]?.view.counts.like).toBe(9) // but the counts moved
    expect(ids(result.current.pending)).toEqual(['new'])
  })

  it('does not run before the baseline has loaded, and a failed refresh is silent', async () => {
    mockedResolveFeed.mockReturnValue(new Promise(() => {})) // the baseline never lands
    await mount()
    mockedResolveFeed.mockClear()
    await advance(COUNT_REFRESH_MS * 2)
    expect(mockedResolveFeed).not.toHaveBeenCalled()

    mockedResolveFeed.mockResolvedValue([])
    const second = await mount()
    mockedResolveFeed.mockRejectedValue(new Error('flaky'))
    await advance(COUNT_REFRESH_MS)
    expect(second.result.current.status).toBe('ready')
    expect(second.result.current.error).toBeUndefined()
  })

  it('hands over to the 5s polling sweep when the transport degrades, and back on recovery', async () => {
    const { result } = await mount()
    source.mode = 'polling'
    await advance(MODE_SYNC_MS)
    expect(result.current.mode).toBe('polling')

    mockedResolveFeed.mockClear()
    await advance(POLLING_SWEEP_MS)
    expect(mockedResolveFeed).toHaveBeenCalledTimes(1) // the 5s polling sweep

    source.mode = 'realtime'
    await advance(MODE_SYNC_MS)
    mockedResolveFeed.mockClear()
    await advance(COUNT_REFRESH_MS)
    expect(mockedResolveFeed).toHaveBeenCalledTimes(1) // the slow refresh, not the 5s one
  })
})

describe('teardown', () => {
  it('unsubscribes, stops the source, drops queued arrivals and clears its timers on unmount', async () => {
    const { result, unmount } = await mount()
    act(() => source.emit(view('queued')))
    unmount()

    expect(source.subscriberCount()).toBe(0)
    expect(source.stop).toHaveBeenCalledTimes(1)
    await advance(ARRIVAL_BATCH_MS * 2)
    expect(result.current.rows).toEqual([]) // the queued arrival was dropped, not applied
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores a baseline response that lands after unmount', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    let finish: (posts: ReturnType<typeof post>[]) => void = () => {}
    mockedResolveFeed.mockReturnValue(new Promise(resolve => {
      finish = resolve
    }))
    const { unmount } = await mount()
    unmount()
    await act(async () => {
      finish([post('late')])
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  it('survives a source whose start() rejects: the baseline still loads', async () => {
    source.start.mockRejectedValue(new Error('hub unreachable'))
    mockedResolveFeed.mockResolvedValue([post('a')])
    const { result } = await mount()
    expect(result.current.status).toBe('ready')
    expect(ids(result.current.rows)).toEqual(['a'])
  })
})
