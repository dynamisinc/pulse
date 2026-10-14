/**
 * test/fakeHubConnection.ts
 * ---------------------------------------------------------------------------
 * TEST-ONLY fake of the slice of `@microsoft/signalr`'s `HubConnection` that
 * `core/realtime/connection.ts` touches, plus `createFakeTransport()` which wires a REAL
 * `createRealtimeConnection()` to a series of them. Never bundled into a real build.
 *
 * WHY IT LIVES HERE. The identity-change tests (core/realtime, the social feed, the overlay and
 * review stores, `completeSignIn`) all need the same thing: the real shared-connection wrapper -
 * its handler registry, its stop/restart logic, its state fan-out - on top of a transport that
 * is fully under the test's control. `vi.mock('@microsoft/signalr')` of the whole package is
 * deliberately avoided (see `connection.test.ts`); this fake is the module's documented seam
 * (`createRealtimeConnection({ buildConnection })`).
 *
 * FIDELITY. It behaves like the real library where the wrapper depends on it:
 *   - `start()` moves to `Connecting` at once, then `Connected`; a failed start returns to
 *     `Disconnected`; a start that a `stop()` overtook REJECTS (the real library throws an
 *     `AbortError`) unless `completesDespiteStop` is set, which models a transport that
 *     finishes its handshake anyway - the case the wrapper defends against.
 *   - `stop()` moves to `Disconnecting` at once, `Disconnected` when `stopImpl` settles, and
 *     fires `onclose` only if the connection had been up (the real library does the same).
 *   - `startedWithToken` records the session token the connection NEGOTIATED with: it is read
 *     from `sessionAccessTokenFactory()` when `start()` is called, exactly as the real
 *     library's `accessTokenFactory` is read per negotiate. It is how a test proves a
 *     restarted connection is on the NEW identity.
 *
 * `createFakeTransport().fakes` lists every `HubConnection` the wrapper built, in order, so a
 * test can assert both "a fresh connection was built" and "which token it started with".
 */
import type { HubConnection } from '@microsoft/signalr'
import {
  createRealtimeConnection,
  HubConnectionState,
  sessionAccessTokenFactory,
} from '@/core/realtime/connection'
import type { RealtimeConnection } from '@/core/realtime/connection'

type Handler = (...args: unknown[]) => void

export class FakeHubConnection {
  state: HubConnectionState = HubConnectionState.Disconnected
  startCallCount = 0
  stopCallCount = 0
  /** The session token this connection negotiated with (read when `start()` was called). */
  startedWithToken: string | undefined
  startImpl: () => Promise<void> = () => Promise.resolve()
  stopImpl: () => Promise<void> = () => Promise.resolve()
  /** When true, a start that a stop overtook still resolves and ends `Connected`. */
  completesDespiteStop = false

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
    this.startedWithToken = sessionAccessTokenFactory()
    this.state = HubConnectionState.Connecting
    const stopsWhenStarted = this.stopCallCount
    return this.startImpl().then(
      () => {
        if (this.stopCallCount !== stopsWhenStarted && !this.completesDespiteStop) {
          this.state = HubConnectionState.Disconnected
          throw new Error('The connection was stopped before the hub handshake could complete.')
        }
        this.state = HubConnectionState.Connected
      },
      (error: unknown) => {
        this.state = HubConnectionState.Disconnected
        throw error
      },
    )
  }

  stop(): Promise<void> {
    this.stopCallCount += 1
    const wasUp =
      this.state === HubConnectionState.Connected || this.state === HubConnectionState.Reconnecting
    if (this.state !== HubConnectionState.Disconnected) {
      this.state = HubConnectionState.Disconnecting
    }
    return this.stopImpl().then(() => {
      this.state = HubConnectionState.Disconnected
      if (wasUp) this.closeCb?.()
    })
  }

  /** Test helper: simulate the server pushing `eventName` with `payload`. */
  emit(eventName: string, payload: unknown): void {
    for (const handler of [...(this.handlers.get(eventName) ?? [])]) handler(payload)
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

  /** The fake as the `HubConnection` the wrapper's `buildConnection` must return. */
  asHubConnection(): HubConnection {
    return this as unknown as HubConnection
  }
}

/** A real shared-connection wrapper over a series of fake transports. */
export interface FakeTransport {
  readonly connection: RealtimeConnection
  /** Every `HubConnection` the wrapper has built, oldest first. */
  readonly fakes: FakeHubConnection[]
  /** The most recently built one (throws if nothing was built yet - a test bug). */
  latest(): FakeHubConnection
}

/**
 * @param configure  Called with each fake as it is built (and its index), BEFORE the wrapper uses
 *   it - the place to give the Nth connection a failing or hanging `startImpl`.
 */
export function createFakeTransport(
  configure?: (fake: FakeHubConnection, index: number) => void,
): FakeTransport {
  const fakes: FakeHubConnection[] = []
  const connection = createRealtimeConnection({
    hubUrl: 'http://test.invalid/hubs/exercise',
    buildConnection: () => {
      const fake = new FakeHubConnection()
      configure?.(fake, fakes.length)
      fakes.push(fake)
      return fake.asHubConnection()
    },
  })
  return {
    connection,
    fakes,
    latest() {
      const fake = fakes[fakes.length - 1]
      if (fake === undefined) throw new Error('createFakeTransport: no connection built yet')
      return fake
    },
  }
}
