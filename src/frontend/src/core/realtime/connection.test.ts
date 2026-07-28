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
 * Uses `createRealtimeConnection({ buildConnection })` — the module's own
 * documented test seam — with a hand-rolled fake `HubConnection`, never a real
 * WebSocket and never a `vi.mock('@microsoft/signalr')` of the whole package.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  createRealtimeConnection,
  HubConnectionState,
  sessionAccessTokenFactory,
} from './connection'
import { clearTokens, setTokens } from '@/core/auth/tokenStore'

type Handler = (...args: unknown[]) => void

/** A minimal fake satisfying every `HubConnection` member `connection.ts` touches. */
class FakeHubConnection {
  state: HubConnectionState = HubConnectionState.Disconnected
  startCallCount = 0
  startImpl: () => Promise<void> = () => Promise.resolve()

  private readonly handlers = new Map<string, Set<Handler>>()
  private reconnectingCb: (() => void) | undefined
  private reconnectedCb: (() => void) | undefined
  private closeCb: (() => void) | undefined

  on(eventName: string, handler: Handler): void {
    const set = this.handlers.get(eventName) ?? new Set<Handler>()
    set.add(handler)
    this.handlers.set(eventName, set)
  }

  off(eventName: string, handler: Handler): void {
    this.handlers.get(eventName)?.delete(handler)
  }

  onreconnecting(cb: () => void): void {
    this.reconnectingCb = cb
  }

  onreconnected(cb: () => void): void {
    this.reconnectedCb = cb
  }

  onclose(cb: () => void): void {
    this.closeCb = cb
  }

  start(): Promise<void> {
    this.startCallCount += 1
    return this.startImpl().then(() => {
      this.state = HubConnectionState.Connected
    })
  }

  /** Test helper: simulate the server pushing `eventName` with `payload`. */
  emit(eventName: string, payload: unknown): void {
    for (const handler of this.handlers.get(eventName) ?? []) handler(payload)
  }

  /** Test helper: how many handlers are currently registered for `eventName`. */
  handlerCount(eventName: string): number {
    return this.handlers.get(eventName)?.size ?? 0
  }

  triggerReconnecting(): void {
    this.state = HubConnectionState.Reconnecting
    this.reconnectingCb?.()
  }

  triggerReconnected(): void {
    this.state = HubConnectionState.Connected
    this.reconnectedCb?.()
  }

  triggerClose(): void {
    this.state = HubConnectionState.Disconnected
    this.closeCb?.()
  }
}

function buildFake() {
  const fake = new FakeHubConnection()
  let buildCallCount = 0
  const connection = createRealtimeConnection({
    hubUrl: 'http://test.invalid/hubs/exercise',
    buildConnection: () => {
      buildCallCount += 1
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return fake as any
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
