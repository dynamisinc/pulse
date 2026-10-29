/**
 * Tests for `useChannelStream` (channels-foundation story 09, #705): the typed
 * channel subscription on the shared realtime connection - filtering,
 * unsubscribe, no replay, reconnect resync, the coalesced live region, and the
 * per-animation-frame burst batching (NFR-002).
 */

import { act, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HubConnectionState } from '@/core/realtime/connection'
import type {
  RealtimeConnection,
  RealtimeEventHandler,
  RealtimeStateListener,
} from '@/core/realtime/connection'
import type {
  ChannelContentSummaryDto,
  ContentRetractedDto,
  ContentRevisedDto,
} from '../contract'
import {
  CHANNEL_STREAM_ANNOUNCE_WINDOW_MS,
  createAnnouncementCoalescer,
  permalinkOutletSlug,
  useChannelStream,
  type FrameScheduler,
  type UseChannelStreamOptions,
} from './useChannelStream'

const tokenState = vi.hoisted(() => ({ token: null as string | null }))

vi.mock('@/core/auth/tokenStore', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth/tokenStore')>()),
  getAccessToken: () => tokenState.token,
}))

class FakeConnection implements RealtimeConnection {
  state: HubConnectionState = HubConnectionState.Disconnected
  startCalls = 0
  startImpl: () => Promise<void> = () => Promise.resolve()
  private readonly handlers = new Map<string, Set<RealtimeEventHandler>>()
  private readonly listeners = new Set<RealtimeStateListener>()

  subscribe(eventName: string, handler: RealtimeEventHandler): () => void {
    const set = this.handlers.get(eventName) ?? new Set<RealtimeEventHandler>()
    set.add(handler)
    this.handlers.set(eventName, set)
    return () => {
      set.delete(handler)
    }
  }

  onStateChange(listener: RealtimeStateListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  start(): Promise<void> {
    this.startCalls += 1
    return this.startImpl()
  }

  stop(): Promise<void> {
    return Promise.resolve()
  }

  emit(eventName: string, payload: unknown): void {
    for (const handler of this.handlers.get(eventName) ?? []) handler(payload)
  }

  setState(state: HubConnectionState, reason?: 'stopped'): void {
    this.state = state
    for (const listener of this.listeners) listener(state, reason)
  }

  handlerCount(): number {
    let count = 0
    for (const set of this.handlers.values()) count += set.size
    return count
  }
}

/** A manual animation-frame scheduler: `tick()` runs the frame. */
interface ManualFrames {
  scheduleFrame: FrameScheduler
  tick: () => void
  pending: () => number
}

function manualFrames(): ManualFrames {
  let callbacks: (() => void)[] = []
  return {
    scheduleFrame: callback => {
      callbacks.push(callback)
      return () => {
        callbacks = callbacks.filter(c => c !== callback)
      }
    },
    tick: () => {
      const run = callbacks
      callbacks = []
      for (const callback of run) callback()
    },
    pending: () => callbacks.length,
  }
}

let seq = 0

function published(overrides: Partial<ChannelContentSummaryDto> = {}): ChannelContentSummaryDto {
  seq += 1
  const channelId = overrides.channelId ?? 'news'
  const outletSlug = overrides.outlet?.slug ?? 'newsline-7'
  return {
    id: `item-${seq}`,
    channelId,
    kind: 'article',
    outlet: { id: 'o-1', channelId, slug: outletSlug, name: 'Newsline 7', skinKey: 'newsline7' },
    slug: `story-${seq}`,
    permalink: `/${channelId}/${outletSlug}/story-${seq}`,
    state: 'published',
    headline: `Headline ${seq}`,
    dek: null,
    kicker: null,
    category: null,
    hero: null,
    publishedScenarioTime: '2026-12-02T14:05:00Z',
    updatedScenarioTime: null,
    featured: false,
    ...overrides,
  }
}

function revised(id: string, permalink = '/news/newsline-7/story'): ContentRevisedDto {
  return {
    id,
    channelId: 'news',
    permalink,
    updatedScenarioTime: '2026-12-02T15:20:00Z',
    revisions: [],
    headline: 'Rewritten headline',
    dek: null,
  }
}

function retracted(id: string, permalink = '/news/newsline-7/story'): ContentRetractedDto {
  return { id, channelId: 'news', permalink, retractedScenarioTime: '2026-12-02T16:00:00Z' }
}

function setup(overrides: Partial<UseChannelStreamOptions> = {}) {
  const connection = new FakeConnection()
  const frames = manualFrames()
  const onPublished = vi.fn()
  const onRevised = vi.fn()
  const onRetracted = vi.fn()
  const onResync = vi.fn()
  const announce = vi.fn()
  const hook = renderHook((props: Partial<UseChannelStreamOptions>) =>
    useChannelStream({
      channelId: 'news',
      onPublished,
      onRevised,
      onRetracted,
      onResync,
      announce,
      connection,
      scheduleFrame: frames.scheduleFrame,
      ...overrides,
      ...props,
    }), { initialProps: {} })
  const flush = (): void => {
    act(() => frames.tick())
  }
  return {
    connection, frames, flush, onPublished, onRevised, onRetracted, onResync, announce, hook,
  }
}

describe('useChannelStream', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('subscribes to the three content events on the shared connection, starts it, and unsubscribes on unmount', () => {
    const { connection, hook } = setup()

    expect(connection.handlerCount()).toBe(3)
    expect(connection.startCalls).toBe(1)

    hook.unmount()

    expect(connection.handlerCount()).toBe(0)
  })

  it('does not subscribe to AlertsChanged: the alert bar owns alerts', () => {
    const { connection, onPublished, flush } = setup()

    connection.emit('AlertsChanged', { alerts: [] })
    flush()

    expect(onPublished).not.toHaveBeenCalled()
    expect(connection.handlerCount()).toBe(3)
  })

  it('delivers each FC-5 frame to its callback', () => {
    const { connection, flush, onPublished, onRevised, onRetracted } = setup()
    const item = published()
    const rev = revised(item.id, item.permalink)
    const ret = retracted(item.id, item.permalink)

    connection.emit('ContentPublished', item)
    connection.emit('ContentRevised', rev)
    connection.emit('ContentRetracted', ret)
    flush()

    expect(onPublished).toHaveBeenCalledWith(item)
    expect(onRevised).toHaveBeenCalledWith(rev)
    expect(onRetracted).toHaveBeenCalledWith(ret)
  })

  it('delivers a silent_rewrite revise (no new revisions entry) like any other', () => {
    const { connection, flush, onRevised } = setup()
    const silent = revised('item-x')

    connection.emit('ContentRevised', silent)
    flush()

    expect(onRevised).toHaveBeenCalledWith(silent)
    expect(silent.revisions).toHaveLength(0)
  })

  it('drops frames for another channel', () => {
    const { connection, flush, onPublished, onRevised, onRetracted } = setup()

    connection.emit('ContentPublished', published({ channelId: 'weather' }))
    connection.emit('ContentRevised', { ...revised('a', '/weather/nws/x'), channelId: 'weather' })
    connection.emit('ContentRetracted', { ...retracted('a', '/weather/nws/x'), channelId: 'weather' })
    flush()

    expect(onPublished).not.toHaveBeenCalled()
    expect(onRevised).not.toHaveBeenCalled()
    expect(onRetracted).not.toHaveBeenCalled()
  })

  it('drops frames for another outlet when outletSlug is given', () => {
    const { connection, flush, onPublished, onRevised, onRetracted } = setup({ outletSlug: 'newsline-7' })
    const other = published({ outlet: { id: 'o-2', channelId: 'news', slug: 'ledger', name: 'Ledger', skinKey: 'l' } })
    const mine = published()

    connection.emit('ContentPublished', other)
    connection.emit('ContentRevised', revised('a', '/news/ledger/x'))
    connection.emit('ContentRetracted', retracted('a', '/news/ledger/x'))
    connection.emit('ContentPublished', mine)
    connection.emit('ContentRevised', revised('b', '/news/newsline-7/y'))
    connection.emit('ContentRetracted', retracted('b', '/news/newsline-7/y'))
    flush()

    expect(onPublished).toHaveBeenCalledTimes(1)
    expect(onPublished).toHaveBeenCalledWith(mine)
    expect(onRevised).toHaveBeenCalledTimes(1)
    expect(onRetracted).toHaveBeenCalledTimes(1)
  })

  it('drops malformed frames (the FC-5 guards)', () => {
    const { connection, flush, onPublished, onRevised } = setup()

    connection.emit('ContentPublished', { id: 'x', channelId: 'news' })
    connection.emit('ContentPublished', { ...published(), state: 'draft' })
    connection.emit('ContentRevised', { ...revised('x'), permalink: 'https://evil.example/news/a/b' })
    flush()

    expect(onPublished).not.toHaveBeenCalled()
    expect(onRevised).not.toHaveBeenCalled()
  })

  it('replays nothing: frames sent before mount or after unmount are never delivered', () => {
    const connection = new FakeConnection()
    connection.emit('ContentPublished', published())
    const { onPublished, hook, flush } = setup({ connection })

    flush()
    expect(onPublished).not.toHaveBeenCalled()

    hook.unmount()
    connection.emit('ContentPublished', published())
    flush()
    expect(onPublished).not.toHaveBeenCalled()
  })

  it('does nothing when disabled', () => {
    const { connection } = setup({ enabled: false })

    expect(connection.handlerCount()).toBe(0)
    expect(connection.startCalls).toBe(0)
  })

  it('asks the page to refetch when the hub returns after a gap, never after a deliberate stop', () => {
    const connected = new FakeConnection()
    connected.state = HubConnectionState.Connected
    const { onResync } = setup({ connection: connected })

    act(() => connected.setState(HubConnectionState.Connected))
    expect(onResync).not.toHaveBeenCalled()

    act(() => connected.setState(HubConnectionState.Disconnected, 'stopped'))
    act(() => connected.setState(HubConnectionState.Connected))
    expect(onResync).not.toHaveBeenCalled()

    act(() => connected.setState(HubConnectionState.Reconnecting))
    act(() => connected.setState(HubConnectionState.Connected))
    expect(onResync).toHaveBeenCalledTimes(1)
  })

  it('counts distinct new items, removes a retracted one, and clears on demand', () => {
    const { connection, flush, hook } = setup()
    const a = published()
    const b = published()

    connection.emit('ContentPublished', a)
    connection.emit('ContentPublished', b)
    connection.emit('ContentPublished', a) // a restore / duplicate is not new again
    flush()
    expect(hook.result.current.newItemCount).toBe(2)

    connection.emit('ContentRetracted', retracted(a.id, a.permalink))
    flush()
    expect(hook.result.current.newItemCount).toBe(1)

    act(() => hook.result.current.clearNewItems())
    expect(hook.result.current.newItemCount).toBe(0)
  })

  it('restarts the shared connection after a deliberate stop when a token is stored', () => {
    const { connection } = setup()
    expect(connection.startCalls).toBe(1)

    tokenState.token = null
    act(() => connection.setState(HubConnectionState.Disconnected, 'stopped'))
    expect(connection.startCalls).toBe(1)

    tokenState.token = 'next-identity'
    act(() => connection.setState(HubConnectionState.Disconnected, 'stopped'))
    expect(connection.startCalls).toBe(2)
    tokenState.token = null
  })

  it('bumps announcementSeq so an identical message is announced again', () => {
    const { connection, flush, hook } = setup()

    connection.emit('ContentPublished', published())
    flush()
    expect(hook.result.current.announcementSeq).toBe(1)
    act(() => {
      vi.advanceTimersByTime(CHANNEL_STREAM_ANNOUNCE_WINDOW_MS)
    })
    connection.emit('ContentPublished', published())
    flush()

    expect(hook.result.current.announcement).toBe('1 new story')
    expect(hook.result.current.announcementSeq).toBe(2)
  })

  it('resyncs once when it mounts before the hub is connected (frames may have been missed)', () => {
    const { connection, onResync } = setup()

    act(() => connection.setState(HubConnectionState.Connected))
    act(() => connection.setState(HubConnectionState.Connected))

    expect(onResync).toHaveBeenCalledTimes(1)
  })

  it('counts a retracted-then-restored item as new again', () => {
    const { connection, flush, hook, announce } = setup()
    const a = published()

    connection.emit('ContentPublished', a)
    flush()
    connection.emit('ContentRetracted', retracted(a.id, a.permalink))
    flush()
    expect(hook.result.current.newItemCount).toBe(0)

    connection.emit('ContentPublished', a)
    flush()
    expect(hook.result.current.newItemCount).toBe(1)
    act(() => {
      vi.advanceTimersByTime(CHANNEL_STREAM_ANNOUNCE_WINDOW_MS)
    })
    expect(announce).toHaveBeenLastCalledWith('1 new story')
  })

  it('delivers the rest of a batch and keeps the count when one callback throws', () => {
    const reported = vi.fn()
    vi.stubGlobal('reportError', reported)
    const delivered: string[] = []
    const { connection, flush, hook } = setup({
      onPublished: item => {
        if (item.headline === 'boom') throw new Error('consumer bug')
        delivered.push(item.id)
      },
    })
    const items = [published(), published({ headline: 'boom' }), published()]

    for (const item of items) connection.emit('ContentPublished', item)
    flush()

    expect(delivered).toEqual([items[0]?.id, items[2]?.id])
    expect(hook.result.current.newItemCount).toBe(3)
    expect(reported).toHaveBeenCalledWith(new Error('consumer bug'))
    vi.unstubAllGlobals()
  })

  it('resets the count when the channel view changes', () => {
    const { connection, flush, hook } = setup()

    connection.emit('ContentPublished', published())
    flush()
    expect(hook.result.current.newItemCount).toBe(1)

    hook.rerender({ outletSlug: 'ledger' })
    expect(hook.result.current.newItemCount).toBe(0)
  })

  describe('live region (NFR-001)', () => {
    it('announces the first arrival at once, then one polite message per 5 s window', () => {
      const { connection, flush, announce, hook } = setup()

      connection.emit('ContentPublished', published())
      flush()
      expect(announce).toHaveBeenCalledTimes(1)
      expect(announce).toHaveBeenLastCalledWith('1 new story')
      expect(hook.result.current.announcement).toBe('1 new story')

      // A burst inside the window: no per-item announcements.
      for (let i = 0; i < 9; i += 1) {
        connection.emit('ContentPublished', published())
        flush()
      }
      expect(announce).toHaveBeenCalledTimes(1)

      act(() => {
        vi.advanceTimersByTime(CHANNEL_STREAM_ANNOUNCE_WINDOW_MS)
      })
      expect(announce).toHaveBeenCalledTimes(2)
      expect(announce).toHaveBeenLastCalledWith('9 new stories')

      // A quiet window announces nothing.
      act(() => {
        vi.advanceTimersByTime(CHANNEL_STREAM_ANNOUNCE_WINDOW_MS * 3)
      })
      expect(announce).toHaveBeenCalledTimes(2)
    })

    it('uses the consumer wording', () => {
      const { connection, flush, announce } = setup({
        formatAnnouncement: count => `${count} new forecast products`,
      })

      connection.emit('ContentPublished', published())
      flush()

      expect(announce).toHaveBeenCalledWith('1 new forecast products')
    })

    it('never announces revisions or retractions', () => {
      const { connection, flush, announce } = setup()

      connection.emit('ContentRevised', revised('a'))
      connection.emit('ContentRetracted', retracted('a'))
      flush()

      expect(announce).not.toHaveBeenCalled()
    })

    it('stops announcing after unmount', () => {
      const { connection, flush, announce, hook } = setup()

      connection.emit('ContentPublished', published())
      flush()
      connection.emit('ContentPublished', published())
      flush()
      hook.unmount()
      act(() => {
        vi.advanceTimersByTime(CHANNEL_STREAM_ANNOUNCE_WINDOW_MS)
      })

      expect(announce).toHaveBeenCalledTimes(1)
    })
  })

  describe('burst (NFR-002)', () => {
    it('batches 120 frames in a minute to at most one render per animation frame', () => {
      vi.useRealTimers()
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
      })
      const connection = new FakeConnection()
      const delivered: string[] = []
      let renders = 0

      function Probe(): null {
        renders += 1
        useChannelStream({
          channelId: 'news',
          connection,
          onPublished: item => {
            delivered.push(item.id)
          },
        })
        return null
      }

      render(<Probe />)
      const rendersAtMount = renders

      // 120 frames over 60 s, arriving in bursts of 10 within the same 16 ms frame every 5 s.
      const sent: string[] = []
      for (let second = 0; second < 60; second += 5) {
        act(() => {
          for (let i = 0; i < 10; i += 1) {
            const item = published()
            sent.push(item.id)
            connection.emit('ContentPublished', item)
          }
        })
        expect(delivered.length).toBe(sent.length - 10) // nothing delivered before the frame runs
        act(() => {
          vi.advanceTimersByTime(5000)
        })
      }

      expect(sent).toHaveLength(120)
      expect(delivered).toEqual(sent)
      // 12 bursts -> 12 animation frames -> at most 12 renders (one per frame), never 120.
      expect(renders - rendersAtMount).toBeLessThanOrEqual(12)
    })

    it('renders at most once per animation frame at a steady 120 frames/min', () => {
      vi.useRealTimers()
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
      })
      const connection = new FakeConnection()
      let renders = 0
      let flushes = 0
      const scheduleFrame: FrameScheduler = callback => {
        const handle = requestAnimationFrame(() => {
          flushes += 1
          callback()
        })
        return () => cancelAnimationFrame(handle)
      }

      function Probe(): null {
        renders += 1
        useChannelStream({ channelId: 'news', connection, scheduleFrame })
        return null
      }

      render(<Probe />)
      const rendersAtMount = renders

      // Frames every 500 ms for 60 s, each landing between two animation frames.
      for (let i = 0; i < 120; i += 1) {
        act(() => {
          connection.emit('ContentPublished', published())
          vi.advanceTimersByTime(500)
        })
      }

      expect(flushes).toBe(120)
      // One render per flush, plus at most one per 5 s announcement window (12 in a minute).
      expect(renders - rendersAtMount).toBeLessThanOrEqual(flushes + 12)
    })

    it('schedules one frame for any number of frames queued before it runs', () => {
      const { connection, frames, flush, onPublished, hook } = setup()

      for (let i = 0; i < 120; i += 1) connection.emit('ContentPublished', published())

      expect(frames.pending()).toBe(1)
      expect(onPublished).not.toHaveBeenCalled()
      flush()
      expect(onPublished).toHaveBeenCalledTimes(120)
      expect(hook.result.current.newItemCount).toBe(120)
      expect(frames.pending()).toBe(0)
    })
  })
})

describe('permalinkOutletSlug', () => {
  it('reads the outlet segment of a content permalink', () => {
    expect(permalinkOutletSlug('/news/newsline-7/story')).toBe('newsline-7')
    expect(permalinkOutletSlug('/news/newsline-7')).toBeNull()
    expect(permalinkOutletSlug('news/a/b')).toBeNull()
  })
})

describe('createAnnouncementCoalescer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits leading, then at most once per window with the folded count', () => {
    const emit = vi.fn()
    const coalescer = createAnnouncementCoalescer(emit, 1000)

    coalescer.add(1)
    coalescer.add(2)
    coalescer.add(3)
    expect(emit.mock.calls).toEqual([[1]])

    vi.advanceTimersByTime(1000)
    expect(emit.mock.calls).toEqual([[1], [5]])

    vi.advanceTimersByTime(1000)
    coalescer.add(4)
    expect(emit.mock.calls).toEqual([[1], [5], [4]])

    coalescer.dispose()
  })

  it('ignores an empty add', () => {
    const emit = vi.fn()
    createAnnouncementCoalescer(emit, 1000).add(0)
    expect(emit).not.toHaveBeenCalled()
  })
})
