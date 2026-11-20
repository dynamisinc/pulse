/**
 * features/social/services/realtimeFeed.scopeChange.test.ts
 * ---------------------------------------------------------------------------
 * #856, with a REAL consumer: a started `createRealtimeFeed` (live on the staff console through
 * `useLiveWorldFeed`) over the real shared-connection wrapper on a fake transport.
 *
 * `stop('scope-changed')` SUSPENDS the connection. The feed must treat it as a gap (mode
 * `'connecting'`, never `enterPolling()`), and even a feed that polls anyway must not reopen the
 * hub: its recovery driver's `start()` is refused while suspended - not while the switch POST is
 * in flight, not every poll interval after it, and not after a switch whose scope could not be
 * re-resolved (fail closed). `resume()` brings the hub, and the feed, back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HubConnectionState } from '@/core/realtime/connection'
import { clearTokens, setTokens } from '@/core/auth/tokenStore'
import { createFakeTransport } from '@/test/fakeHubConnection'
import type { FakeTransport } from '@/test/fakeHubConnection'
import type { Post } from '@/features/social'
import { createRealtimeFeed } from './realtimeFeed'
import type { SessionResettableFeed } from './realtimeFeed'

const POLL_MS = 1000

let transport: FakeTransport
let feed: SessionResettableFeed
let fetchFeed: ReturnType<typeof vi.fn<() => Promise<Post[]>>>
/** While true every connection's start() is refused (the hub is down). */
let hubDown = false

beforeEach(async () => {
  vi.useFakeTimers()
  setTokens({ token: 'staff-token' })
  hubDown = false
  transport = createFakeTransport(fake => {
    fake.startImpl = () => (hubDown ? Promise.reject(new Error('hub down')) : Promise.resolve())
  })
  fetchFeed = vi.fn<() => Promise<Post[]>>().mockResolvedValue([])
  feed = createRealtimeFeed({
    connection: transport.connection,
    fetchFeed,
    pollIntervalMs: POLL_MS,
    reconnectWindowMs: 5000,
  })
  await feed.start()
  await vi.advanceTimersByTimeAsync(0)
})

afterEach(() => {
  feed.stop()
  vi.useRealTimers()
  clearTokens()
})

describe('a started feed across an exercise switch', () => {
  it('holds as a gap: not polling, and no new connection while the switch is in flight', async () => {
    expect(feed.mode).toBe('realtime')

    void transport.connection.stop('scope-changed')
    await vi.advanceTimersByTimeAsync(POLL_MS * 20)

    expect(feed.mode).toBe('connecting')
    expect(fetchFeed).not.toHaveBeenCalled() // never degraded to polling
    expect(transport.fakes).toHaveLength(1)
    expect(transport.connection.state).toBe(HubConnectionState.Disconnected)
  })

  it('a feed that was already polling neither reopens the hub nor reads the new exercise mid-switch', async () => {
    // The hub drops first, so the feed degrades and its recovery driver is running.
    transport.latest().triggerReconnecting()
    await vi.advanceTimersByTimeAsync(5000)
    expect(feed.mode).toBe('polling')
    const buildsBefore = transport.fakes.length
    const readsBefore = fetchFeed.mock.calls.length
    expect(readsBefore).toBeGreaterThan(0)

    void transport.connection.stop('scope-changed')
    // The switch POST is in flight, then the re-resolve fails: nobody ever calls resume().
    await vi.advanceTimersByTimeAsync(POLL_MS * 30)

    expect(transport.fakes).toHaveLength(buildsBefore) // no connection was built
    expect(fetchFeed.mock.calls.length).toBe(readsBefore) // and no poll read exercise B early
    expect(transport.connection.state).toBe(HubConnectionState.Disconnected)
  })

  it('a resume() that fails does not strand the feed: it polls, then recovers when the hub works', async () => {
    void transport.connection.stop('scope-changed')
    await vi.advanceTimersByTimeAsync(POLL_MS * 2)
    expect(feed.mode).toBe('connecting')

    // The resumed connection is refused: the hub is down.
    hubDown = true
    await transport.connection.resume()
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)

    expect(feed.mode).toBe('polling') // degraded normally, not stuck in 'connecting'
    expect(fetchFeed).toHaveBeenCalled()

    // The hub works again: the recovery driver's next start() connects.
    hubDown = false
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(transport.connection.state).toBe(HubConnectionState.Connected)
    expect(feed.mode).toBe('realtime')
  })

  it('resume() brings the hub back on the current token and the feed returns to real-time', async () => {
    void transport.connection.stop('scope-changed')
    await vi.advanceTimersByTimeAsync(POLL_MS * 5)
    expect(feed.mode).toBe('connecting')

    setTokens({ token: 'staff-token-for-exercise-b' })
    await transport.connection.resume()
    await vi.advanceTimersByTimeAsync(0)

    expect(transport.fakes).toHaveLength(2)
    expect(transport.latest().startedWithToken).toBe('staff-token-for-exercise-b')
    expect(feed.mode).toBe('realtime')
  })
})
