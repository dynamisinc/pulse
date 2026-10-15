/**
 * features/social/services/realtimeFeed.streamGap.test.ts
 * ---------------------------------------------------------------------------
 * Demo-feedback story 14, Gate-1 L-B: the app-wide wiring at the bottom of `realtimeFeed.ts`
 * turns every hub state other than `Connected` into `postCountsStore.markGap()`, so a frame held
 * from before a drop no longer beats a fresh read when a card mounts (M-3).
 *
 * LIVE mode (`USE_MOCK_DATA` false), with the shared `realtimeConnection` replaced by a fake
 * whose `onStateChange` listeners the test drives.
 */
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HubConnectionState } from '@/core/realtime/connection'
import type { RealtimeStateListener } from '@/core/realtime/connection'

const stateListeners = vi.hoisted(() => new Set<RealtimeStateListener>())

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/realtime/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/realtime/connection')>()
  return {
    ...actual,
    realtimeConnection: {
      get state() {
        return actual.HubConnectionState.Connected
      },
      subscribe: () => () => undefined,
      onStateChange: (listener: RealtimeStateListener) => {
        stateListeners.add(listener)
        return () => {
          stateListeners.delete(listener)
        }
      },
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    },
  }
})

// Imported after the mocks: loading the module runs the wiring under test.
const { postCountsStore, usePostCounts } = await import('./postCountsStore')
await import('./realtimeFeed')

function emitState(state: HubConnectionState) {
  for (const listener of [...stateListeners]) listener(state)
}

const HELD = { reply: 0, repost: 1, like: 9 }
const FRESH_READ = { reply: 0, repost: 1, like: 11 }

beforeEach(() => {
  postCountsStore.reset()
})

describe('realtimeFeed wiring: hub state -> postCountsStore.markGap (L-B)', () => {
  it('registers on the shared connection', () => {
    expect(stateListeners.size).toBeGreaterThan(0)
  })

  it('a Connected state is not a gap: a held frame still wins on mount', () => {
    postCountsStore.apply('p1', HELD, 5)
    emitState(HubConnectionState.Connected)

    const { result } = renderHook(() => usePostCounts('p1', FRESH_READ))
    expect(result.current.like).toBe(9)
  })

  it('a Reconnecting state makes a held frame untrusted on mount: the fresh read wins', () => {
    postCountsStore.apply('p1', HELD, 5)
    emitState(HubConnectionState.Reconnecting)

    const { result } = renderHook(() => usePostCounts('p1', FRESH_READ))
    expect(result.current.like).toBe(11)
  })

  it('a Disconnected state is a gap too, and a frame after it is trusted again', () => {
    postCountsStore.apply('p1', HELD, 5)
    emitState(HubConnectionState.Disconnected)
    emitState(HubConnectionState.Connected)
    postCountsStore.apply('p1', { reply: 0, repost: 1, like: 12 }, 6)

    const { result } = renderHook(() => usePostCounts('p1', FRESH_READ))
    expect(result.current.like).toBe(12)
  })
})
