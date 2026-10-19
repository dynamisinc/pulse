/**
 * features/participant-shell/components/OverlayLayer/overlayState.live.test.ts
 * ---------------------------------------------------------------------------
 * Covers the LIVE overlay-state source (world-steering story 08; CTL-023,
 * COR-001, XC-001, XC-002) — the branch `useOverlayState()` uses once
 * `USE_MOCK_DATA` is false:
 *  - `ensureStarted` SEEDS the snapshot from `GET /api/overlay-state`, so a
 *    participant who joins or refreshes MID-Freeze still gets the holding page
 *    (AC4);
 *  - an `OverlayStateChanged` push reconciles live — Freeze shows the holding
 *    page and Resume clears it with no manual refresh (AC2/AC3);
 *  - both registers survive the wire verbatim (AC5);
 *  - a MALFORMED push is dropped, never cast blindly (fail closed);
 *  - a STALE (older-`sequence`) push is dropped, so a late out-of-order publish
 *    cannot re-show a holding page over a resumed world;
 *  - a hub reconnect RE-GETs the authoritative state ("GET seeds, push updates,
 *    reconnect re-GETs");
 *  - NO GET response is trusted on arrival order (CR-001): a superseded seed GET
 *    (production issues TWO, and they race) and a GET body overtaken by a push
 *    are both DROPPED — neither may show a stale page nor rewind the stale-push
 *    cutoff below a push that has already been consumed;
 *  - a push with no `sequence` is unorderable and therefore dropped (SG-002),
 *    while the sequence-less GET fallback body stays acceptable;
 *  - a failed GET leaves the previous snapshot alone rather than inventing one —
 *    EXCEPT a `403` (WR-001), which is definitive: the lifecycle gate refuses this
 *    route only where the world is closed to participants, which is never a pause,
 *    so the overlay is CLEARED instead of stranding a holding page on every
 *    reconnect. `401`/`5xx`/network failures stay fail-closed.
 *
 * Uses the module's own test seam (`ensureStarted(connection)`) with a
 * hand-rolled fake `RealtimeConnection` plus a mocked `api` — mirroring
 * `liveReviewStore.test.ts` exactly. Nothing here opens a second hub
 * connection: the fake stands in for the ONE shared `core/realtime` connection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HubConnectionState } from '@/core/realtime/connection'
import type { RealtimeConnection, RealtimeEventHandler } from '@/core/realtime/connection'
import { liveOverlayStateStore } from './overlayState'

const getMock = vi.fn()

vi.mock('@/core/services/api', () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
  },
}))

class FakeConnection implements RealtimeConnection {
  state: HubConnectionState = HubConnectionState.Disconnected
  startCallCount = 0
  subscribedEvents: string[] = []
  startImpl: () => Promise<void> = () => Promise.resolve()

  private readonly pushHandlers = new Set<RealtimeEventHandler>()
  private readonly stateListeners = new Set<(state: HubConnectionState) => void>()

  subscribe(eventName: string, handler: RealtimeEventHandler): () => void {
    this.subscribedEvents.push(eventName)
    if (eventName !== 'OverlayStateChanged') return () => {}
    this.pushHandlers.add(handler)
    return () => this.pushHandlers.delete(handler)
  }

  onStateChange(listener: (state: HubConnectionState) => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  stop(): Promise<void> {
    return Promise.resolve()
  }

  start(): Promise<void> {
    this.startCallCount += 1
    return this.startImpl().then(() => {
      // The REAL SharedRealtimeConnection.start() emits Connected on success
      // (core/realtime/connection.ts:152-155), which fires the store's resync
      // listener — so production issues a SECOND seed GET. A fake that stayed
      // silent here hid the CR-001 race entirely.
      this.setState(HubConnectionState.Connected)
    })
  }

  push(payload: unknown): void {
    for (const handler of this.pushHandlers) handler(payload)
  }

  setState(state: HubConnectionState): void {
    this.state = state
    for (const listener of this.stateListeners) listener(state)
  }
}

function wireState(overrides: Record<string, unknown> = {}) {
  return { state: 'none', register: 'in-fiction', message: '', sequence: 1, ...overrides }
}

function resolveGet(body: unknown): void {
  getMock.mockResolvedValue({ data: body })
}

/** A promise whose resolution the test controls — for interleaving two in-flight GETs. */
async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

let connection: FakeConnection

beforeEach(() => {
  getMock.mockReset()
  resolveGet(wireState({ sequence: 0 }))
  connection = new FakeConnection()
})

afterEach(() => {
  liveOverlayStateStore.resetForTests()
})

describe('liveOverlayStateStore — ended (read-only review)', () => {
  it('defaults ended to false', () => {
    expect(liveOverlayStateStore.getSnapshot().ended).toBe(false)
  })

  it('treats an absent ended as false', async () => {
    resolveGet(wireState({ sequence: 1 }))
    liveOverlayStateStore.ensureStarted(connection)
    await flush()
    expect(liveOverlayStateStore.getSnapshot().ended).toBe(false)
  })

  it('seeds ended: true from the GET, with state staying none', async () => {
    resolveGet(wireState({ ended: true, sequence: 4 }))
    liveOverlayStateStore.ensureStarted(connection)
    await flush()
    expect(liveOverlayStateStore.getSnapshot()).toMatchObject({ state: 'none', ended: true })
  })

  it.each([['true'], [1], [null], ['yes']])('treats non-boolean ended %j as false', async raw => {
    resolveGet(wireState({ ended: raw, sequence: 2 }))
    liveOverlayStateStore.ensureStarted(connection)
    await flush()
    expect(liveOverlayStateStore.getSnapshot().ended).toBe(false)
  })

  it('a push flips ended and notifies subscribers', async () => {
    liveOverlayStateStore.ensureStarted(connection)
    await flush()
    const listener = vi.fn()
    liveOverlayStateStore.subscribe(listener)

    connection.push(wireState({ ended: true, sequence: 9 }))

    expect(liveOverlayStateStore.getSnapshot().ended).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('a 403 refetch clears ended back to the default', async () => {
    resolveGet(wireState({ ended: true, sequence: 3 }))
    liveOverlayStateStore.ensureStarted(connection)
    await flush()
    expect(liveOverlayStateStore.getSnapshot().ended).toBe(true)

    getMock.mockRejectedValue(Object.assign(new Error('403'), { isAxiosError: true, response: { status: 403 } }))
    connection.setState(HubConnectionState.Connected)
    await flush()

    expect(liveOverlayStateStore.getSnapshot().ended).toBe(false)
  })
})
