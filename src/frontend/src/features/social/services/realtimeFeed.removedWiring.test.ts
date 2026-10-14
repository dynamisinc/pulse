/**
 * features/social/services/realtimeFeed.removedWiring.test.ts
 * ---------------------------------------------------------------------------
 * The app-wide `realtimeFeed` singleton is wired to the session's `removedPosts` store
 * (demo-polish C5, story 22): a valid `PostRemoved { postId }` on the SHARED connection records
 * the id, a malformed one records nothing - which is what `<Feed>` and the Explore baseline
 * react to. An isolated `createRealtimeFeed()` (the unit tests' kind) writes to NO global state.
 *
 * The shared connection is replaced by a controllable fake at the module boundary
 * (`@/core/realtime/connection`); everything else is real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HubConnectionState } from '@/core/realtime/connection'
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
  }
  return { ...actual, realtimeConnection: fake }
})

function push(eventName: string, payload: unknown): void {
  for (const handler of [...(handlers.get(eventName) ?? [])]) handler(payload)
}

beforeEach(async () => {
  handlers.clear()
  const { removedPosts } = await import('./removedPosts')
  removedPosts.resetForTests()
})

afterEach(async () => {
  const { realtimeFeed } = await import('./realtimeFeed')
  realtimeFeed.stop()
})

describe('realtimeFeed singleton - PostRemoved is recorded in removedPosts', () => {
  it('records the id of a valid PostRemoved on the shared connection', async () => {
    const { realtimeFeed } = await import('./realtimeFeed')
    const { removedPosts } = await import('./removedPosts')
    await realtimeFeed.start()

    push('PostRemoved', { postId: 'post-taken-down' })

    expect(removedPosts.has('post-taken-down')).toBe(true)
  })

  it('records nothing for a malformed payload', async () => {
    const { realtimeFeed } = await import('./realtimeFeed')
    const { removedPosts } = await import('./removedPosts')
    await realtimeFeed.start()

    push('PostRemoved', { postId: '' })
    push('PostRemoved', { id: 'post-taken-down' })
    push('PostRemoved', 'post-taken-down')
    push('PostRemoved', null)

    expect(removedPosts.getAll().size).toBe(0)
  })

  it('records nothing once the transport is stopped (the hub subscription is released)', async () => {
    const { realtimeFeed } = await import('./realtimeFeed')
    const { removedPosts } = await import('./removedPosts')
    await realtimeFeed.start()
    realtimeFeed.stop()

    push('PostRemoved', { postId: 'post-after-stop' })

    expect(removedPosts.has('post-after-stop')).toBe(false)
  })

  it('an isolated createRealtimeFeed() writes to no global state', async () => {
    const { createRealtimeFeed } = await import('./realtimeFeed')
    const { removedPosts } = await import('./removedPosts')
    const connection: RealtimeConnection = {
      state: HubConnectionState.Disconnected,
      subscribe(eventName, handler) {
        const set = handlers.get(`isolated:${eventName}`) ?? new Set<RealtimeEventHandler>()
        set.add(handler)
        handlers.set(`isolated:${eventName}`, set)
        return () => set.delete(handler)
      },
      onStateChange: () => () => {},
      start: () => Promise.resolve(),
    }
    const isolated = createRealtimeFeed({ connection })
    await isolated.start()

    push('isolated:PostRemoved', { postId: 'post-isolated' })

    expect(removedPosts.has('post-isolated')).toBe(false)
    isolated.stop()
  })
})
