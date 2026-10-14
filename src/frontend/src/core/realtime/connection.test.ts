/**
 * core/realtime/connection.test.ts
 * ---------------------------------------------------------------------------
 * Covers story social-api/03 "SignalR feed host"'s shared real-time transport
 * (SOC-083, NFR-003): the "one connection, new handlers added to it" shape
 * (`docs/features/social-api/03-signalr-feed-host.md`'s "Shared-connection
 * shape honored" AC) — multiple handlers registered on a SINGLE underlying
 * `HubConnection` (never a second one built per subscriber), subscribe/
 * unsubscribe correctness, `start()` idempotency/memoization, and connection-
 * state fan-out (Connected/Reconnecting/Disconnected).
 *
 * Also covers `stop()` (COR-001, identity change): idempotent, never throws, safe in every
 * state including mid-`start()`; the registered handlers survive it; and the NEXT `start()`
 * builds a fresh connection on the then-current token with those handlers re-attached.
 *
 * Uses `createRealtimeConnection({ buildConnection })` — the module's own
 * documented test seam — with a hand-rolled fake `HubConnection`
 * (`@/test/fakeHubConnection`), never a real WebSocket and never a
 * `vi.mock('@microsoft/signalr')` of the whole package.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  createRealtimeConnection,
  HubConnectionState,
  sessionAccessTokenFactory,
  stopOnHotDispose,
} from './connection'
import type { RealtimeConnection, RealtimeStateReason } from './connection'
import { clearTokens, setTokens } from '@/core/auth/tokenStore'
import { createFakeTransport, FakeHubConnection } from '@/test/fakeHubConnection'

function buildFake() {
  const fake = new FakeHubConnection()
  let buildCallCount = 0
  const connection = createRealtimeConnection({
    hubUrl: 'http://test.invalid/hubs/exercise',
    buildConnection: () => {
      buildCallCount += 1
      return fake.asHubConnection()
    },
  })
  return { fake, connection, getBuildCallCount: () => buildCallCount }
}

describe('sessionAccessTokenFactory — the hub credential (identity-auth-roles/11)', () => {
  afterEach(() => {
    clearTokens()
  })

  it('supplies the stored access token', () => {
    // Before story 11 the hub connected with NO credential and the server accepted it — an
    // unauthenticated client received live PostReceived frames (#359). Both hub endpoints are now
    // gated, so the connection has to present the session token or the participant feed goes dark.
    setTokens({ token: 'session-token-abc' })

    expect(sessionAccessTokenFactory()).toBe('session-token-abc')
  })

  it('reads the store on EVERY call, so a rotated token is picked up on reconnect', () => {
    // SignalR calls the factory again on each negotiate/reconnect. Capturing the token once would
    // pin the connection to a token the silent refresh has already rotated away.
    setTokens({ token: 'first' })
    expect(sessionAccessTokenFactory()).toBe('first')

    setTokens({ token: 'rotated' })
    expect(sessionAccessTokenFactory()).toBe('rotated')
  })

  it('returns an empty string when nothing is stored, so the connection fails closed', () => {
    clearTokens()

    expect(sessionAccessTokenFactory()).toBe('')
  })
})

describe('createRealtimeConnection — one shared connection, many handlers', () => {
  it('builds the underlying HubConnection lazily, and only ONCE across multiple subscribe calls', () => {
    const { getBuildCallCount, connection } = buildFake()

    expect(getBuildCallCount()).toBe(0) // no side effect just from creating the wrapper

    connection.subscribe('PostReceived', () => {})
    connection.subscribe('OverlayPushed', () => {})
    connection.subscribe('AlertRaised', () => {})

    expect(getBuildCallCount()).toBe(1)
  })

  it('registers each handler on the SAME underlying connection instance', () => {
    const { fake, connection } = buildFake()

    connection.subscribe('PostReceived', () => {})
    connection.subscribe('PostReceived', () => {})
    connection.subscribe('OverlayPushed', () => {})

    expect(fake.handlerCount('PostReceived')).toBe(2)
    expect(fake.handlerCount('OverlayPushed')).toBe(1)
  })

  it('delivers a pushed payload to the registered handler', () => {
    const { fake, connection } = buildFake()
    const received: unknown[] = []
    connection.subscribe('PostReceived', payload => received.push(payload))

    fake.emit('PostReceived', { id: 'post-1' })

    expect(received).toEqual([{ id: 'post-1' }])
  })

  it('unsubscribe removes only that handler, via connection.off', () => {
    const { fake, connection } = buildFake()
    const a: unknown[] = []
    const b: unknown[] = []
    const unsubscribeA = connection.subscribe('PostReceived', payload => a.push(payload))
    connection.subscribe('PostReceived', payload => b.push(payload))

    unsubscribeA()
    fake.emit('PostReceived', { id: 'post-1' })

    expect(a).toEqual([])
    expect(b).toEqual([{ id: 'post-1' }])
  })

  it('unsubscribe is idempotent — calling it twice does not throw or double-remove', () => {
    const { fake, connection } = buildFake()
    const unsubscribe = connection.subscribe('PostReceived', () => {})

    expect(() => {
      unsubscribe()
      unsubscribe()
    }).not.toThrow()
    expect(fake.handlerCount('PostReceived')).toBe(0)
  })
})

describe('createRealtimeConnection — start()', () => {
  it('calls the underlying start() and resolves once connected', async () => {
    const { fake, connection } = buildFake()

    await connection.start()

    expect(fake.startCallCount).toBe(1)
    expect(connection.state).toBe(HubConnectionState.Connected)
  })

  it('memoizes a pending start — a second concurrent call does not start a second time', async () => {
    const { fake, connection } = buildFake()
    let resolveStart: () => void = () => {}
    fake.startImpl = () => new Promise(resolve => { resolveStart = resolve })

    const first = connection.start()
    const second = connection.start()

    expect(fake.startCallCount).toBe(1)
    resolveStart()
    await Promise.all([first, second])
  })

  it('is a no-op once already connected', async () => {
    const { fake, connection } = buildFake()
    await connection.start()

    await connection.start()

    expect(fake.startCallCount).toBe(1)
  })

  it('clears the memo on failure so a later start() can retry (the polling recovery driver)', async () => {
    const { fake, connection } = buildFake()
    fake.startImpl = () => Promise.reject(new Error('hub unreachable'))

    await expect(connection.start()).rejects.toThrow('hub unreachable')

    fake.startImpl = () => Promise.resolve()
    await connection.start()

    expect(fake.startCallCount).toBe(2)
    expect(connection.state).toBe(HubConnectionState.Connected)
  })

  it('state reflects Disconnected before the first start', () => {
    const { connection } = buildFake()
    expect(connection.state).toBe(HubConnectionState.Disconnected)
  })
})

describe('createRealtimeConnection — connection-state fan-out (NFR-003 signal)', () => {
  it('notifies Connected after a successful start', async () => {
    const { connection } = buildFake()
    const states: HubConnectionState[] = []
    connection.onStateChange(state => states.push(state))

    await connection.start()

    expect(states).toEqual([HubConnectionState.Connected])
  })

  it('notifies Reconnecting, then Connected, on a reconnect episode that recovers', async () => {
    const { fake, connection } = buildFake()
    await connection.start()
    const states: HubConnectionState[] = []
    connection.onStateChange(state => states.push(state))

    fake.triggerReconnecting()
    fake.triggerReconnected()

    expect(states).toEqual([HubConnectionState.Reconnecting, HubConnectionState.Connected])
  })

  it('notifies Disconnected when auto-reconnect is exhausted (onclose)', async () => {
    const { fake, connection } = buildFake()
    await connection.start()
    const states: HubConnectionState[] = []
    connection.onStateChange(state => states.push(state))

    fake.triggerClose()

    expect(states).toEqual([HubConnectionState.Disconnected])
  })

  it('a removed listener stops receiving state notifications', async () => {
    const { fake, connection } = buildFake()
    await connection.start()
    const states: HubConnectionState[] = []
    const unsubscribe = connection.onStateChange(state => states.push(state))

    unsubscribe()
    fake.triggerReconnecting()

    expect(states).toEqual([])
  })
})

/** `[state, reason]` pairs, so a test can tell a deliberate stop from a lost connection. */
type Observed = [HubConnectionState, RealtimeStateReason | undefined]

function observe(connection: RealtimeConnection): Observed[] {
  const seen: Observed[] = []
  connection.onStateChange((state, reason) => seen.push([state, reason]))
  return seen
}

/** Lets the wrapper's deferred "stopped" announcement (a microtask) run. */
async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

/** Lets a whole (fake) close run to the end: a handful of promise hops, not one. */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve()
}

describe('createRealtimeConnection — stop() (identity change, COR-001)', () => {
  afterEach(() => {
    clearTokens()
  })

  it('is a harmless no-op when nothing was ever built or started', async () => {
    const { connection, getBuildCallCount } = buildFake()
    const seen = observe(connection)

    await expect(connection.stop()).resolves.toBeUndefined()
    await flush()

    expect(getBuildCallCount()).toBe(0) // stopping never builds a connection
    expect(seen).toEqual([])
    expect(connection.state).toBe(HubConnectionState.Disconnected)
  })

  it('leaves a built-but-never-started connection alone, to serve the next start()', async () => {
    const { fake, connection, getBuildCallCount } = buildFake()
    connection.subscribe('PostReceived', () => {})
    const seen = observe(connection)

    await connection.stop()
    await connection.start()
    await flush()

    expect(fake.stopCallCount).toBe(0)
    expect(getBuildCallCount()).toBe(1)
    expect(seen).toEqual([[HubConnectionState.Connected, undefined]])
  })

  it('ends a started connection: Disconnected at once, closed, announced ONCE as "stopped"', async () => {
    const { connection, fakes, latest } = createFakeTransport()
    await connection.start()
    const first = latest()
    const seen = observe(connection)

    const stopping = connection.stop()
    expect(connection.state).toBe(HubConnectionState.Disconnected) // synchronous
    await stopping
    await flush()

    expect(first.stopCallCount).toBe(1)
    expect(first.state).toBe(HubConnectionState.Disconnected)
    // One announcement, tagged as deliberate - NOT a second bare Disconnected from the
    // library's own onclose, which would read as "auto-reconnect exhausted".
    expect(seen).toEqual([[HubConnectionState.Disconnected, 'stopped']])
    expect(fakes).toHaveLength(1) // stopping built nothing new
  })

  it('is idempotent: a second or concurrent stop does nothing more and announces nothing more', async () => {
    const { connection, latest } = createFakeTransport()
    await connection.start()
    const first = latest()
    const seen = observe(connection)

    await Promise.all([connection.stop(), connection.stop()])
    await connection.stop()
    await flush()

    expect(first.stopCallCount).toBe(1)
    expect(seen).toEqual([[HubConnectionState.Disconnected, 'stopped']])
  })

  it('never throws or rejects, even when the transport fails to close', async () => {
    const { connection, latest } = createFakeTransport()
    await connection.start()
    latest().stopImpl = () => Promise.reject(new Error('close failed'))

    await expect(connection.stop()).resolves.toBeUndefined()
    await expect(connection.stop()).resolves.toBeUndefined()
  })

  it('is safe while a reconnect is in progress', async () => {
    const { connection, latest } = createFakeTransport()
    await connection.start()
    const first = latest()
    first.triggerReconnecting()
    const seen = observe(connection)

    await connection.stop()
    await flush()

    expect(first.state).toBe(HubConnectionState.Disconnected)
    expect(seen).toEqual([[HubConnectionState.Disconnected, 'stopped']])
  })

  describe('mid-start', () => {
    /** A wrapper whose first connection is built (so it can be configured) but not yet started. */
    function prepare() {
      const transport = createFakeTransport()
      transport.connection.subscribe('PostReceived', () => {})
      const live = transport.latest()
      let finishHandshake: () => void = () => {}
      let failHandshake: (error: Error) => void = () => {}
      live.startImpl = () => new Promise<void>((resolve, reject) => {
        finishHandshake = resolve
        failHandshake = reject
      })
      return {
        ...transport,
        live,
        finishHandshake: () => finishHandshake(),
        failHandshake: (error: Error) => failHandshake(error),
      }
    }

    it('rejects the start in flight and leaves nothing connected', async () => {
      const { connection, live, finishHandshake } = prepare()
      const seen = observe(connection)

      const started = connection.start()
      const rejected = expect(started).rejects.toThrow(/stopped/)
      const stopping = connection.stop()
      expect(connection.state).toBe(HubConnectionState.Disconnected) // swapped synchronously
      finishHandshake() // the handshake completes AFTER the stop (a faithful transport aborts it)
      await rejected
      await stopping
      await flush()

      expect(live.state).toBe(HubConnectionState.Disconnected)
      expect(seen).toEqual([[HubConnectionState.Disconnected, 'stopped']]) // never "Connected"
    })

    it('closes a transport that finishes the handshake despite the stop (no live old-token connection)', async () => {
      const { connection, live, finishHandshake } = prepare()
      const seen = observe(connection)
      live.completesDespiteStop = true // the worst case: it comes up regardless

      const started = connection.start()
      const rejected = expect(started).rejects.toThrow(/stopped/)
      const stopping = connection.stop()
      finishHandshake()
      await rejected
      await stopping
      await flush()

      expect(live.state).toBe(HubConnectionState.Disconnected)
      expect(live.stopCallCount).toBe(2) // asked once to stop, and again once it came up anyway
      expect(seen.some(([state]) => state === HubConnectionState.Connected)).toBe(false)
    })

    it('leaves a start that fails on its own to the starter', async () => {
      const { connection, failHandshake } = prepare()

      const started = connection.start()
      const rejected = expect(started).rejects.toThrow('hub unreachable')
      const stopping = connection.stop()
      failHandshake(new Error('hub unreachable'))
      await rejected
      await expect(stopping).resolves.toBeUndefined()
    })
  })

  describe('the next start() after a stop', () => {
    it('builds a NEW connection and negotiates with the CURRENT token', async () => {
      const { connection, fakes } = createFakeTransport()
      setTokens({ token: 'identity-A' })
      await connection.start()
      expect(fakes[0]?.startedWithToken).toBe('identity-A')

      await connection.stop()
      setTokens({ token: 'identity-B' }) // the identity on the tab changed
      await connection.start()

      expect(fakes).toHaveLength(2)
      expect(fakes[1]?.startedWithToken).toBe('identity-B')
      expect(connection.state).toBe(HubConnectionState.Connected)
    })

    it('does not wait for the old connection to finish closing', async () => {
      const { connection, fakes, latest } = createFakeTransport()
      setTokens({ token: 'identity-A' })
      await connection.start()
      let finishClosing: () => void = () => {}
      latest().stopImpl = () => new Promise<void>(resolve => { finishClosing = resolve })

      const stopping = connection.stop() // the old teardown is HUNG
      setTokens({ token: 'identity-B' })
      await connection.start() // must still come up

      expect(fakes[1]?.startedWithToken).toBe('identity-B')
      expect(connection.state).toBe(HubConnectionState.Connected)
      finishClosing()
      await stopping
    })

    it('re-attaches every handler that is still subscribed, and none that was unsubscribed', async () => {
      const { connection, fakes } = createFakeTransport()
      const kept: unknown[] = []
      const dropped: unknown[] = []
      connection.subscribe('PostReceived', payload => kept.push(payload))
      const unsubscribe = connection.subscribe('PostReceived', payload => dropped.push(payload))
      connection.subscribe('OverlayStateChanged', payload => kept.push(payload))
      unsubscribe()
      await connection.start()

      await connection.stop()
      await connection.start()
      fakes[1]?.emit('PostReceived', 'post-1')
      fakes[1]?.emit('OverlayStateChanged', 'overlay-1')

      expect(kept).toEqual(['post-1', 'overlay-1'])
      expect(dropped).toEqual([])
      expect(fakes[1]?.handlerCount('PostReceived')).toBe(1)
    })

    it('attaches a subscribe made AFTER the stop to the next connection', async () => {
      const { connection, fakes } = createFakeTransport()
      await connection.start()
      await connection.stop()
      const received: unknown[] = []

      connection.subscribe('PostReceived', payload => received.push(payload))
      await connection.start()
      fakes[1]?.emit('PostReceived', 'post-1')

      expect(fakes).toHaveLength(2) // subscribe built the connection start() then used
      expect(received).toEqual(['post-1'])
    })

    it('unsubscribe still works after the connection was rebuilt', async () => {
      const { connection, fakes } = createFakeTransport()
      const received: unknown[] = []
      const unsubscribe = connection.subscribe('PostReceived', payload => received.push(payload))
      await connection.start()
      await connection.stop()
      await connection.start()

      unsubscribe()
      fakes[1]?.emit('PostReceived', 'post-1')

      expect(received).toEqual([])
      expect(fakes[1]?.handlerCount('PostReceived')).toBe(0)
    })

    it('announces Connected for the new connection, with no reason', async () => {
      const { connection } = createFakeTransport()
      await connection.start()
      await connection.stop()
      await flush()
      const seen = observe(connection)

      await connection.start()

      expect(seen).toEqual([[HubConnectionState.Connected, undefined]])
    })
  })

  describe('the abandoned connection', () => {
    it('can no longer deliver to any handler, even while it is still closing', async () => {
      const { connection, fakes, latest } = createFakeTransport()
      const received: unknown[] = []
      connection.subscribe('PostReceived', payload => received.push(payload))
      await connection.start()
      latest().stopImpl = () => new Promise<void>(() => {}) // never finishes closing

      void connection.stop()
      fakes[0]?.emit('PostReceived', 'a frame for the previous identity\'s exercise')

      expect(received).toEqual([])
    })

    it('cannot speak for the shared connection through its own lifecycle callbacks', async () => {
      const { connection, fakes } = createFakeTransport()
      await connection.start()
      await connection.stop()
      await connection.start()
      await flush()
      const seen = observe(connection)

      fakes[0]?.triggerReconnecting()
      fakes[0]?.triggerReconnected()
      fakes[0]?.triggerClose()

      expect(seen).toEqual([])
      expect(connection.state).toBe(HubConnectionState.Connected) // the NEW one is untouched
    })
  })

  it('a state listener that throws starves neither the others nor stop()', async () => {
    const { connection } = createFakeTransport()
    await connection.start()
    connection.onStateChange(() => {
      throw new Error('listener bug')
    })
    const seen = observe(connection)

    await expect(connection.stop()).resolves.toBeUndefined()
    await flush()

    expect(seen).toEqual([[HubConnectionState.Disconnected, 'stopped']])
  })
})

describe('createRealtimeConnection — stop() promises are independent (Gate-1 S-1)', () => {
  afterEach(() => {
    clearTokens()
  })

  it('a hung close of an EARLIER connection does not make a later stop() hang', async () => {
    const { connection, fakes, latest } = createFakeTransport()
    await connection.start()
    latest().stopImpl = () => new Promise<void>(() => {}) // identity A's teardown never finishes
    void connection.stop()

    await connection.start() // identity B connects regardless
    expect(fakes).toHaveLength(2)
    let secondStopSettled = false
    void connection.stop().then(() => {
      secondStopSettled = true
    })
    await settle()

    expect(fakes[1]?.state).toBe(HubConnectionState.Disconnected)
    expect(secondStopSettled).toBe(true) // it reports ITS close, not A's
  })

  it('a repeat stop() while the connection is already abandoned reports the latest close', async () => {
    const { connection, latest } = createFakeTransport()
    await connection.start()
    let finishClosing: () => void = () => {}
    latest().stopImpl = () => new Promise<void>(resolve => { finishClosing = resolve })

    const first = connection.stop()
    let repeatSettled = false
    void connection.stop().then(() => {
      repeatSettled = true
    })
    await settle()
    expect(repeatSettled).toBe(false) // still closing: the repeat waits for the same close

    finishClosing()
    await first
    await settle()
    expect(repeatSettled).toBe(true)
  })
})

describe('stopOnHotDispose — a hot-replaced module cannot orphan a live connection (Gate-1 L-2)', () => {
  it('stops the connection when Vite disposes the module', async () => {
    const { connection, latest } = createFakeTransport()
    await connection.start()
    let dispose: () => void = () => {}
    stopOnHotDispose(connection, { dispose: callback => { dispose = callback } })

    dispose()
    await flush()

    expect(latest().stopCallCount).toBe(1)
    expect(connection.state).toBe(HubConnectionState.Disconnected)
  })

  it('does nothing without a hot context (a production build)', async () => {
    const { connection, latest } = createFakeTransport()
    await connection.start()

    expect(() => stopOnHotDispose(connection, undefined)).not.toThrow()
    expect(latest().stopCallCount).toBe(0)
  })
})
