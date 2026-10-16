/**
 * features/social/edit/postEdited.singletonWiring.test.ts
 * ---------------------------------------------------------------------------
 * The app-wide `realtimeFeed` singleton is wired to `editedPostsStore` (story 20; DF-33): a valid
 * `PostEdited` on the SHARED connection lands in the store, a malformed one does not, and a stale
 * or replayed frame is dropped by the store's version gate. Same fake-connection boundary as
 * `realtimeFeed.removedWiring.test.ts`.
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

function push(payload: unknown): void {
  for (const handler of [...(handlers.get('PostEdited') ?? [])]) handler(payload)
}

function frame(version: number, text: string) {
  return {
    postId: 'p1',
    text,
    edited: { count: version, scenarioTime: `2033-09-04T10:0${version}:00Z` },
    version,
  }
}

beforeEach(async () => {
  handlers.clear()
  const { editedPostsStore } = await import('./editedPostsStore')
  editedPostsStore.resetForTests()
  const { realtimeFeed } = await import('../services/realtimeFeed')
  await realtimeFeed.start()
})

afterEach(async () => {
  const { realtimeFeed } = await import('../services/realtimeFeed')
  realtimeFeed.stop()
})

describe('realtimeFeed singleton - PostEdited feeds editedPostsStore', () => {
  it('records a valid frame', async () => {
    const { editedPostsStore } = await import('./editedPostsStore')

    push(frame(1, 'first edit'))

    expect(editedPostsStore.get('p1').text).toBe('first edit')
    expect(editedPostsStore.get('p1').edited?.count).toBe(1)
  })

  it('ignores a malformed frame', async () => {
    const { editedPostsStore } = await import('./editedPostsStore')

    push({ ...frame(1, 'x'), version: 2 })
    push({ postId: 'p1' })

    expect(editedPostsStore.get('p1')).toEqual({})
  })

  it('drops a stale and a replayed frame (version gate)', async () => {
    const { editedPostsStore } = await import('./editedPostsStore')

    push(frame(2, 'second'))
    push(frame(1, 'stale'))
    push(frame(2, 'replay'))

    expect(editedPostsStore.get('p1').text).toBe('second')
    vi.restoreAllMocks()
  })
})
