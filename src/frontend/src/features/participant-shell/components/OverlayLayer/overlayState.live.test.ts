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
 *  - a failed GET leaves the previous snapshot alone rather than inventing one.
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
import type { OverlayState } from './types'

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

function wireState(overrides: Partial<OverlayState & { sequence: number }> = {}) {
  return { state: 'none', register: 'in-fiction', message: '', sequence: 1, ...overrides }
}

function resolveGet(body: unknown): void {
  getMock.mockResolvedValue({ data: body })
}

/** A promise whose resolution the test controls — for interleaving two in-flight GETs. */
function deferred<T>(): { promise: Promise<T>, resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

/** Lets the store's own `void refetchLive()` promise settle. */
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

describe('liveOverlayStateStore — seeding GET (AC4)', () => {
  it('starts at the safe "none" default before anything resolves (fails closed)', () => {
    expect(liveOverlayStateStore.getSnapshot()).toEqual({
      state: 'none',
      register: 'in-fiction',
      message: '',
    })
  })

  it('seeds a mid-Freeze holding page from the GET, so a refresh still shows it', async () => {
    resolveGet(wireState({ state: 'pause', register: 'out-of-fiction', sequence: 7 }))

    liveOverlayStateStore.ensureStarted(connection)
    await flush()

    expect(liveOverlayStateStore.getSnapshot()).toEqual({
      state: 'pause',
      register: 'out-of-fiction',
      message: '',
    })
    expect(getMock).toHaveBeenCalledWith('/overlay-state')
  })

  it('subscribes to OverlayStateChanged once and starts the shared connection once', async () => {
    liveOverlayStateStore.ensureStarted(connection)
    liveOverlayStateStore.ensureStarted(connection)
    await flush()

    expect(connection.subscribedEvents).toEqual(['OverlayStateChanged'])
    expect(connection.startCallCount).toBe(1)
    // TWO seed GETs, which is what production really does: ensureStarted issues one
    // directly and connection.start()'s Connected transition fires the resync
    // listener. They race, so refetchLive is generation-guarded (CR-001).
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it('keeps the previous snapshot when the GET fails (never invents an overlay)', async () => {
    resolveGet(wireState({ state: 'pause', register: 'out-of-fiction', sequence: 3 }))
    liveOverlayStateStore.ensureStarted(connection)
    await flush()

    getMock.mockRejectedValue(new Error('401'))
    connection.setState(HubConnectionState.Connected)
    await flush()

    expect(liveOverlayStateStore.getSnapshot().state).toBe('pause')
  })
})

describe('liveOverlayStateStore — pushes (AC2/AC3/AC5)', () => {
  beforeEach(async () => {
    liveOverlayStateStore.ensureStarted(connection)
    await flush()
  })

  it('reconciles a Freeze push into the holding-page state and notifies subscribers', () => {
    const listener = vi.fn()
    liveOverlayStateStore.subscribe(listener)

    connection.push(wireState({ state: 'pause', register: 'out-of-fiction', sequence: 1 }))

    expect(liveOverlayStateStore.getSnapshot()).toEqual({
      state: 'pause',
      register: 'out-of-fiction',
      message: '',
    })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('reconciles a Resume push back to "none" — clearing the rendered holding page', () => {
    connection.push(wireState({ state: 'pause', register: 'out-of-fiction', sequence: 1 }))

    connection.push(wireState({ state: 'none', register: 'in-fiction', sequence: 2 }))

    expect(liveOverlayStateStore.getSnapshot().state).toBe('none')
  })

  it('carries the in-fiction register verbatim (the participant sees the matching copy)', () => {
    connection.push(wireState({ state: 'pause', register: 'in-fiction', sequence: 1 }))

    expect(liveOverlayStateStore.getSnapshot().register).toBe('in-fiction')
  })

  it('drops a malformed push payload instead of corrupting the snapshot', () => {
    connection.push(wireState({ state: 'pause', register: 'out-of-fiction', sequence: 1 }))

    connection.push({ state: 'god-mode', register: 'in-fiction', message: '', sequence: 2 })
    connection.push({ state: 'none', register: 'sideways', message: '', sequence: 3 })
    connection.push({ state: 'none', register: 'in-fiction', sequence: 4 })
    connection.push(null)
    connection.push('none')

    expect(liveOverlayStateStore.getSnapshot()).toEqual({
      state: 'pause',
      register: 'out-of-fiction',
      message: '',
    })
  })

  it('drops a STALE push, so a late out-of-order publish cannot re-show a cleared holding page', () => {
    connection.push(wireState({ state: 'none', register: 'in-fiction', sequence: 9 }))

    // The Freeze's publish raced the Resume's and arrives late, carrying an older sequence.
    connection.push(wireState({ state: 'pause', register: 'out-of-fiction', sequence: 4 }))

    expect(liveOverlayStateStore.getSnapshot().state).toBe('none')
  })
})

describe('liveOverlayStateStore — reconnect resync (AC4)', () => {
  it('re-GETs the authoritative state on every (re)connect', async () => {
    liveOverlayStateStore.ensureStarted(connection)
    await flush()
    expect(liveOverlayStateStore.getSnapshot().state).toBe('none')

    // Frozen while this client was disconnected: the push was missed entirely.
    resolveGet(wireState({ state: 'pause', register: 'out-of-fiction', sequence: 12 }))
    connection.setState(HubConnectionState.Connected)
    await flush()

    expect(getMock).toHaveBeenCalledTimes(3)
    expect(liveOverlayStateStore.getSnapshot().state).toBe('pause')
  })

  it('treats the re-GET as ground truth, re-baselining the sequence after a server restart', async () => {
    liveOverlayStateStore.ensureStarted(connection)
    await flush()
    connection.push(wireState({ state: 'pause', register: 'out-of-fiction', sequence: 40 }))
    expect(liveOverlayStateStore.getSnapshot().state).toBe('pause')

    // A restarted host serves the cleared state with a RESET sequence counter.
    resolveGet(wireState({ state: 'none', register: 'in-fiction', sequence: 0 }))
    connection.setState(HubConnectionState.Connected)
    await flush()

    expect(liveOverlayStateStore.getSnapshot().state).toBe('none')

    connection.push(wireState({ state: 'pause', register: 'out-of-fiction', sequence: 1 }))
    expect(liveOverlayStateStore.getSnapshot().state).toBe('pause')
  })
})

describe('liveOverlayStateStore — no trust in arrival order (CR-001)', () => {
  it('drops a SUPERSEDED seed GET body that resolves last, keeping the newer truth', async () => {
    // Production issues two seed GETs (ensureStarted + the Connected transition) with no
    // response-ordering guarantee. If the OLDER one resolved last unguarded, a participant
    // would sit with no holding page over a frozen world until the next transition.
    const first = deferred<{ data: unknown }>()
    const second = deferred<{ data: unknown }>()
    getMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)

    liveOverlayStateStore.ensureStarted(connection)
    await flush()
    expect(getMock).toHaveBeenCalledTimes(2)

    // The newer GET answers first, with the current truth: frozen.
    second.resolve({ data: wireState({ state: 'pause', register: 'out-of-fiction', sequence: 7 }) })
    await flush()
    expect(liveOverlayStateStore.getSnapshot().state).toBe('pause')

    // The older GET answers late, carrying the PRE-Freeze body.
    first.resolve({ data: wireState({ state: 'none', register: 'in-fiction', sequence: 6 }) })
    await flush()

    expect(liveOverlayStateStore.getSnapshot().state).toBe('pause')

    // ...and the cutoff was not rewound to 6 behind the consumed sequence 7.
    connection.push(wireState({ state: 'pause', register: 'in-fiction', sequence: 7 }))
    expect(liveOverlayStateStore.getSnapshot().register).toBe('out-of-fiction')
    connection.push(wireState({ state: 'none', register: 'in-fiction', sequence: 8 }))
    expect(liveOverlayStateStore.getSnapshot().state).toBe('none')
  })

  it('drops a GET body that a push overtook while it was in flight', async () => {
    liveOverlayStateStore.ensureStarted(connection)
    await flush()

    const pending = deferred<{ data: unknown }>()
    getMock.mockReturnValueOnce(pending.promise)
    connection.setState(HubConnectionState.Connected)

    // The Freeze push lands mid-flight. The server writes its store BEFORE it pushes, so
    // this is strictly newer than the in-flight GET's body.
    connection.push(wireState({ state: 'pause', register: 'out-of-fiction', sequence: 3 }))
    expect(liveOverlayStateStore.getSnapshot().state).toBe('pause')

    pending.resolve({ data: wireState({ state: 'none', register: 'in-fiction', sequence: 2 }) })
    await flush()

    expect(liveOverlayStateStore.getSnapshot().state).toBe('pause')

    // The cutoff still reflects the applied push: an equal/older push is dropped, a newer applies.
    connection.push(wireState({ state: 'none', register: 'in-fiction', sequence: 3 }))
    expect(liveOverlayStateStore.getSnapshot().state).toBe('pause')
    connection.push(wireState({ state: 'none', register: 'in-fiction', sequence: 4 }))
    expect(liveOverlayStateStore.getSnapshot().state).toBe('none')
  })
})

describe('liveOverlayStateStore — an unorderable push is malformed (SG-002)', () => {
  it('drops a push with no sequence', async () => {
    liveOverlayStateStore.ensureStarted(connection)
    await flush()
    connection.push(wireState({ state: 'pause', register: 'out-of-fiction', sequence: 5 }))

    connection.push({ state: 'none', register: 'in-fiction', message: '' })
    connection.push({ state: 'none', register: 'in-fiction', message: '', sequence: 'later' })

    expect(liveOverlayStateStore.getSnapshot().state).toBe('pause')
  })

  it('still accepts a sequence-less GET body — the pre-wiring fallback shape', async () => {
    resolveGet({ state: 'pause', register: 'out-of-fiction', message: '' })

    liveOverlayStateStore.ensureStarted(connection)
    await flush()

    expect(liveOverlayStateStore.getSnapshot().state).toBe('pause')
  })
})
