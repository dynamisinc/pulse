/**
 * features/controller/liveWorld/pinChangeSource.integration.test.ts
 * ---------------------------------------------------------------------------
 * Demo-feedback 07 + 08 END TO END: a `PostPinChanged` push on the SHARED connection,
 * through the REAL app-wide `realtimeFeed` singleton (story 07's `subscribePinChanged`),
 * reaches the Live world column's `defaultPinChangeSource` handler (story 08) as exactly
 * `{ postId, pinnedForAll }`, and unsubscribing detaches it.
 *
 * What it proves: story 08's structural lookup of `realtimeFeed.subscribePinChanged` finds
 * story 07's method on the singleton, and the `.call(realtimeFeed, ...)` binding gives that
 * method its `this` (it keeps its handlers on the controller instance, so an unbound call
 * would throw - the control case below shows that the binding is load-bearing).
 *
 * The shared connection is replaced by a controllable fake at the module boundary
 * (`@/core/realtime/connection`), as `realtimeFeed.removedWiring.test.ts` does; everything
 * else (the singleton, its payload validation, the seam) is real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RealtimeConnection, RealtimeEventHandler } from '@/core/realtime/connection'

const handlers = new Map<string, Set<RealtimeEventHandler>>()

vi.mock('@/core/realtime/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/realtime/connection')>()
  const fake: RealtimeConnection = {
    state: actual.HubConnectionState.Disconnected,
    subscribe(eventName, handler) {
      const set = handlers.get(eventName) ?? new Set<RealtimeEventHandler>()
      set.add(handler)
      handlers.set(eventName, set)
      return () => set.delete(handler)
    },
    onStateChange: () => () => {},
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(),
  }
  return { ...actual, realtimeConnection: fake }
})

/** Delivers `payload` as the hub would, to every handler on the fake shared connection. */
function push(eventName: string, payload: unknown): void {
  for (const handler of [...(handlers.get(eventName) ?? [])]) handler(payload)
}

beforeEach(() => {
  handlers.clear()
})

afterEach(async () => {
  const { realtimeFeed } = await import('@/features/social/services/realtimeFeed')
  realtimeFeed.stop()
})

describe('PostPinChanged -> realtimeFeed singleton -> defaultPinChangeSource (07 + 08)', () => {
  it('delivers a push on the shared connection to the column seam as { postId, pinnedForAll }', async () => {
    const { realtimeFeed } = await import('@/features/social/services/realtimeFeed')
    const { defaultPinChangeSource } = await import('./pinChangeSource')
    await realtimeFeed.start()

    const handler = vi.fn()
    const off = defaultPinChangeSource.subscribePinChanged(handler)

    push('PostPinChanged', { postId: 'post-newscast', pinnedForAll: true })
    push('PostPinChanged', {
      postId: 'post-newscast',
      pinnedForAll: false,
      pinnedForAllByHumanId: 'human-secret', // never surfaced
    })

    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler.mock.calls[0]?.[0]).toEqual({ postId: 'post-newscast', pinnedForAll: true })
    const second = handler.mock.calls[1]?.[0] as Record<string, unknown>
    expect(Object.keys(second).sort()).toEqual(['pinnedForAll', 'postId'])
    expect(second).toEqual({ postId: 'post-newscast', pinnedForAll: false })

    off()
  })

  it('unsubscribe detaches the column handler from the singleton', async () => {
    const { realtimeFeed } = await import('@/features/social/services/realtimeFeed')
    const { defaultPinChangeSource } = await import('./pinChangeSource')
    await realtimeFeed.start()

    const detached = vi.fn()
    const kept = vi.fn()
    const off = defaultPinChangeSource.subscribePinChanged(detached)
    const offKept = defaultPinChangeSource.subscribePinChanged(kept)

    push('PostPinChanged', { postId: 'p-1', pinnedForAll: true })
    off()
    push('PostPinChanged', { postId: 'p-1', pinnedForAll: false })

    expect(detached).toHaveBeenCalledTimes(1)
    expect(kept).toHaveBeenCalledTimes(2) // only that handler was detached
    offKept()
    push('PostPinChanged', { postId: 'p-1', pinnedForAll: true })
    expect(kept).toHaveBeenCalledTimes(2)
  })

  it('drops a malformed push before it reaches the column', async () => {
    const { realtimeFeed } = await import('@/features/social/services/realtimeFeed')
    const { defaultPinChangeSource } = await import('./pinChangeSource')
    await realtimeFeed.start()

    const handler = vi.fn()
    const off = defaultPinChangeSource.subscribePinChanged(handler)
    push('PostPinChanged', { postId: '', pinnedForAll: true })
    push('PostPinChanged', { postId: 'p-1', pinnedForAll: 'yes' })
    expect(handler).not.toHaveBeenCalled()
    off()
  })

  it('control: the singleton method needs its `this`, so the seam\'s .call binding is load-bearing', async () => {
    const { realtimeFeed } = await import('@/features/social/services/realtimeFeed')
    const unbound = realtimeFeed.subscribePinChanged
    expect(() => unbound(() => {})).toThrow(TypeError)
  })
})
