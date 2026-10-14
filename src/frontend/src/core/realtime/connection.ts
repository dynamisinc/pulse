/**
 * core/realtime/connection.ts
 * ---------------------------------------------------------------------------
 * The ONE shared real-time connection primitive (feature: social-api, story 03
 * "SignalR feed host"; SOC-083, NFR-003). A single, lazily-created
 * `@microsoft/signalr` `HubConnection` to the exercise hub (`/hubs/exercise`),
 * wrapped behind a small subscribe-by-event-name surface.
 *
 * SHARED, NOT FEED-ONLY. This is deliberately the transport, not a feed
 * consumer — it honours the "one connection, new handlers added to it"
 * precedent already anticipated by `overlayState.ts:17-19` ("overlay pushes …
 * will ultimately arrive over the shared SignalR connection — one connection,
 * new handlers added to it") and `useAlerts.ts:33` ("… plus a SignalR push").
 * Future consumers — the break-fiction/pause overlay, the alert bar,
 * live-monitoring's CTL-030 board, multi-controller presence — must
 * `subscribe(...)` here, NOT open a second connection.
 *
 * RECONNECTION. Built with `withAutomaticReconnect()`, so a transient drop
 * self-heals. Lifecycle transitions (reconnecting → reconnected, and the
 * terminal close once auto-reconnect is exhausted) are surfaced through
 * `onStateChange`, so a degraded-mode consumer (see
 * `features/social/services/realtimeFeed.ts`) can fall back to polling and
 * recover without knowing anything about SignalR internals.
 *
 * IDENTITY CHANGE: `stop()` (COR-001). The server joins a connection to its
 * `exercise:{id}` group (and the role-scoped groups) ONCE, in `OnConnectedAsync`,
 * from the token presented when the connection was made. A connection therefore
 * belongs to ONE identity for its whole life: if the identity on a tab changes
 * without a page reload (sign-out then sign-in as someone else; every
 * `completeSignIn`), a connection left running would keep delivering the PREVIOUS
 * identity's exercise to the new one. So this module registers a session reset
 * (`core/auth/sessionReset`, run by `resetClientSession()` on sign-out AND every
 * sign-in) that calls `stop()` on the shared connection:
 *   - the live `HubConnection` is ABANDONED synchronously (its handlers detached
 *     first, so a late frame from the old exercise can reach no one) and closed in
 *     the background; `state` reads `Disconnected` from that moment;
 *   - the registered `subscribe` handlers are kept in a registry here, not just on
 *     the `HubConnection`, so they survive: the NEXT `start()` builds a fresh
 *     `HubConnection`, re-attaches every handler and negotiates with whatever token
 *     the store holds THEN (the token factory is read per call);
 *   - `start()` never waits for the old connection to finish closing, so a slow or
 *     hung teardown can never block the new identity's connection;
 *   - a stop that overtakes a `start()` in flight rejects that start and makes sure
 *     the half-made connection is closed too, so nothing is left connected on the
 *     old token;
 *   - listeners hear `Disconnected` with reason `'stopped'` (once, and only if a
 *     connection was actually up or coming up) so a consumer can tell a deliberate
 *     stop from "auto-reconnect exhausted" and re-attach instead of giving up.
 *
 * TESTABILITY. `createRealtimeConnection({ hubUrl, buildConnection })` lets a
 * test point the connection at a fake transport (or override the hub URL)
 * without a real WebSocket; the app uses the lazy shared `realtimeConnection`
 * singleton.
 *
 * World: participant-adjacent shared infrastructure — no UI, no COBRA.
 */

import { HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr'
import type { HubConnection } from '@microsoft/signalr'
import { getAccessToken } from '@/core/auth/tokenStore'
import { registerSessionReset } from '@/core/auth/sessionReset'
import type { HotModule } from '@/core/auth/sessionReset'

export { HubConnectionState } from '@microsoft/signalr'

/** A handler for a hub event's payload. The payload is untyped at the transport
 * layer — each consumer validates/narrows it to its own contract. */
export type RealtimeEventHandler = (payload: unknown) => void

/**
 * Why a state transition happened, when the transport knows. Only one reason exists:
 * `'stopped'` accompanies the `Disconnected` that `stop()` causes (a DELIBERATE end,
 * e.g. the session's identity changed), as opposed to a bare `Disconnected`, which means
 * the connection was lost and auto-reconnect is exhausted. A consumer that polls as a
 * fallback should degrade on the latter and re-attach on the former.
 */
export type RealtimeStateReason = 'stopped'

/** Observes connection-state transitions; `reason` is set only for a deliberate stop. */
export type RealtimeStateListener = (
  state: HubConnectionState,
  reason?: RealtimeStateReason,
) => void

/**
 * The shared real-time transport surface consumers depend on. Kept minimal so
 * it is trivially faked in tests and cannot leak SignalR specifics to callers.
 */
export interface RealtimeConnection {
  /**
   * Registers `handler` for a hub event. Returns an idempotent unsubscribe.
   * Adding a handler never opens a new connection — it attaches to the shared one.
   */
  subscribe(eventName: string, handler: RealtimeEventHandler): () => void

  /**
   * Observes connection-state transitions (Connected / Reconnecting / Disconnected).
   * A `Disconnected` caused by {@link RealtimeConnection.stop} carries the reason
   * `'stopped'`. Returns an unsubscribe.
   */
  onStateChange(listener: RealtimeStateListener): () => void

  /**
   * Starts the connection if it is not already started. Idempotent; resolves once
   * connected, rejects if the start fails (or if `stop()` overtakes it). After a
   * `stop()` this opens a NEW connection on the then-current session token with
   * every `subscribe`d handler re-attached.
   */
  start(): Promise<void>

  /**
   * Deliberately ends the connection (the session's identity is changing). Idempotent,
   * never throws or rejects, and safe in every state: never started, connecting (the
   * start in flight is rejected and its half-made connection closed), connected or
   * reconnecting. `subscribe`d handlers survive and are re-attached by the next
   * `start()`. Resolves once the abandoned connection has finished closing; callers
   * that do not care (the session reset) may ignore the promise, and `start()` never
   * waits on it.
   */
  stop(): Promise<void>

  /** The current connection state (`Disconnected` before the first start). */
  readonly state: HubConnectionState
}

/** Options for {@link createRealtimeConnection} — overrides used by tests. */
export interface CreateRealtimeConnectionOptions {
  /** Overrides the derived hub URL (used by tests to point at a fake transport). */
  readonly hubUrl?: string
  /** Overrides the `HubConnection` factory (used by tests to inject a fake). */
  readonly buildConnection?: (hubUrl: string) => HubConnection
}

const HUB_PATH = '/hubs/exercise'

/**
 * Derives the hub URL from the app origin. When `VITE_API_URL` is an absolute
 * origin (a split-host deploy) the hub shares that origin; a relative base
 * (e.g. `/api` behind a dev proxy) or an unset base falls through to the
 * current window origin.
 */
function resolveHubUrl(): string {
  const apiBase = import.meta.env.VITE_API_URL
  if (typeof apiBase === 'string' && apiBase.length > 0) {
    try {
      return new URL(HUB_PATH, apiBase).toString()
    } catch {
      // Relative base (e.g. '/api' for a dev proxy) — fall through to the app origin.
    }
  }
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}${HUB_PATH}`
}

/**
 * Supplies the session token SignalR presents on every negotiate and on every
 * reconnect attempt (feature: identity-auth-roles, story 11).
 *
 * Reads `tokenStore` PER CALL, never a value captured once, so a token rotated
 * by the shared axios client's silent refresh (`core/services/api.ts`) is
 * picked up on the next (re)connect without rebuilding the connection.
 *
 * Returns `''` when nothing is stored — the documented "no credential" signal.
 * The connection then fails closed against the server's default-deny gate (401)
 * rather than silently attaching an empty credential the server might treat as
 * present.
 */
export function sessionAccessTokenFactory(): string {
  return getAccessToken() ?? ''
}

/**
 * The default live `HubConnection`: authenticated, auto-reconnecting,
 * warning-level logging.
 *
 * CREDENTIALS (feature: identity-auth-roles, story 11; COR-012). The hub used
 * to connect with no credential at all, and the server used to accept that —
 * an unauthenticated client could negotiate, join the exercise group, and
 * receive live `PostReceived` frames (#359). Both hub endpoints now sit behind
 * the API's default-deny session gate, so the connection MUST present the
 * session token.
 *
 * The token comes from {@link sessionAccessTokenFactory}, which reads the same
 * dependency-free `tokenStore` leaf the axios client does — so this module
 * gains no coupling to React context or `sessionResolver`.
 *
 * The client sends the token as an `Authorization` header where it can
 * (negotiate, long polling) and as `?access_token=` where a browser cannot set
 * headers (WebSocket upgrade, SSE); the server accepts the query form under
 * `/hubs` only.
 */
function createDefaultHubConnection(hubUrl: string): HubConnection {
  return new HubConnectionBuilder()
    .withUrl(hubUrl, { accessTokenFactory: sessionAccessTokenFactory })
    .withAutomaticReconnect()
    .configureLogging(LogLevel.Warning)
    .build()
}

/** One registered `subscribe`, kept so a rebuilt `HubConnection` can be given it back. */
interface Subscription {
  readonly eventName: string
  readonly handler: RealtimeEventHandler
}

/** Why a start that `stop()` overtook was rejected (the real SignalR reports its own abort). */
const STOPPED_DURING_START = 'The realtime connection was stopped while it was starting.'

/**
 * Closes an abandoned `HubConnection` as far as it will go, and NEVER rejects.
 *
 * `HubConnection.stop()` is asked synchronously (this runs up to its first `await` as soon
 * as it is called), so the transport starts closing at once. If a `start()` was in flight
 * we then let it settle and, should it have produced a live connection anyway (a transport
 * that finished its handshake despite the abort), stop that too: a stop must never leave a
 * connection that was negotiated on the old identity's token.
 */
async function closeQuietly(
  connection: HubConnection,
  startInFlight: Promise<void> | null,
): Promise<void> {
  try {
    await connection.stop()
  } catch {
    // Closing is best effort; there is nothing a caller could do about a failed close.
  }
  if (startInFlight !== null) {
    try {
      await startInFlight
    } catch {
      // The rejection belongs to whoever called start(); here we only wait for it to settle.
    }
  }
  if (connection.state !== HubConnectionState.Disconnected) {
    try {
      await connection.stop()
    } catch {
      // As above.
    }
  }
}

/**
 * The single shared connection. The underlying `HubConnection` is built lazily
 * on the first `subscribe`/`start` — importing this module (or the singleton
 * below) touches neither the network nor `window`. After `stop()` it is built
 * afresh on the next `subscribe`/`start` (see the module header).
 */
class SharedRealtimeConnection implements RealtimeConnection {
  private readonly buildConnection: (hubUrl: string) => HubConnection
  private readonly hubUrlOverride: string | undefined
  private readonly stateListeners = new Set<RealtimeStateListener>()
  /** Every live `subscribe`, so the handlers outlive any one `HubConnection` (see `stop`). */
  private readonly subscriptions = new Set<Subscription>()
  private connection: HubConnection | null = null
  private startPromise: Promise<void> | null = null
  /**
   * Settles when the connection the MOST RECENT `stop()` abandoned has finished closing. Not a
   * chain of every earlier close: one hung negotiate must not make every later stop() hang.
   */
  private closing: Promise<void> = Promise.resolve()

  constructor(options: CreateRealtimeConnectionOptions = {}) {
    this.buildConnection = options.buildConnection ?? createDefaultHubConnection
    this.hubUrlOverride = options.hubUrl
  }

  get state(): HubConnectionState {
    return this.connection?.state ?? HubConnectionState.Disconnected
  }

  subscribe(eventName: string, handler: RealtimeEventHandler): () => void {
    const connection = this.ensureConnection()
    const subscription: Subscription = { eventName, handler }
    this.subscriptions.add(subscription)
    connection.on(eventName, handler)
    return () => {
      if (!this.subscriptions.delete(subscription)) return
      // The CURRENT connection: it may have been rebuilt since this subscribe.
      this.connection?.off(eventName, handler)
    }
  }

  onStateChange(listener: RealtimeStateListener): () => void {
    this.stateListeners.add(listener)
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  start(): Promise<void> {
    const connection = this.ensureConnection()
    if (connection.state === HubConnectionState.Connected) return Promise.resolve()
    if (this.startPromise !== null) return this.startPromise

    const pending: Promise<void> = connection
      .start()
      .then(() => {
        if (this.connection !== connection) {
          // stop() overtook this start and is closing this connection (and re-stopping it if
          // it came up after all): do not announce a connection that is already abandoned.
          throw new Error(STOPPED_DURING_START)
        }
        this.emitState(HubConnectionState.Connected)
      })
      .catch((error: unknown) => {
        // Failed to connect: clear the memo so a later start() (the polling
        // recovery driver) can retry rather than replaying this rejection. Only if it is
        // still OURS: after a stop() a newer start may own the memo.
        if (this.startPromise === pending) this.startPromise = null
        throw error
      })
    this.startPromise = pending
    return pending
  }

  stop(): Promise<void> {
    const connection = this.connection
    if (connection === null) return this.closing

    const startInFlight = this.startPromise
    const wasLive = connection.state !== HubConnectionState.Disconnected || startInFlight !== null
    // Nothing up and nothing coming up (never started, or already closed): there is nothing
    // to end, and the built-but-idle connection can serve the next start() as it is.
    if (!wasLive) return this.closing

    // Abandon the connection SYNCHRONOUSLY, before anything awaits: from here `state` reads
    // Disconnected and a start() builds a new connection rather than touching this one.
    this.connection = null
    this.startPromise = null
    try {
      // Detach every handler first, so a frame still in flight from the old identity's
      // exercise reaches nobody - least of all a consumer already subscribed for the next one.
      for (const { eventName, handler } of this.subscriptions) connection.off(eventName, handler)
    } catch {
      // Detaching is best effort; the connection is abandoned either way.
    }

    this.closing = closeQuietly(connection, startInFlight)
    // Announced AFTER the rest of the synchronous reset pass (and, on sign-out, after the
    // token clear that follows it) so a listener that re-attaches sees the world as it
    // will be, not as it was.
    void Promise.resolve().then(() => {
      this.emitState(HubConnectionState.Disconnected, 'stopped')
    })
    return this.closing
  }

  private ensureConnection(): HubConnection {
    if (this.connection !== null) return this.connection

    const hubUrl = this.hubUrlOverride ?? resolveHubUrl()
    const connection = this.buildConnection(hubUrl)
    // Every callback below ignores a connection stop() has abandoned: it is closing in the
    // background and must not speak for the shared connection any more.
    connection.onreconnecting(() => {
      if (this.connection !== connection) return
      this.emitState(HubConnectionState.Reconnecting)
    })
    connection.onreconnected(() => {
      if (this.connection !== connection) return
      this.emitState(HubConnectionState.Connected)
    })
    connection.onclose(() => {
      if (this.connection !== connection) return
      // Auto-reconnect exhausted: clear the memo so start() can re-establish later.
      this.startPromise = null
      this.emitState(HubConnectionState.Disconnected)
    })
    for (const { eventName, handler } of this.subscriptions) connection.on(eventName, handler)
    this.connection = connection
    return connection
  }

  private emitState(state: HubConnectionState, reason?: RealtimeStateReason): void {
    for (const listener of [...this.stateListeners]) {
      try {
        listener(state, reason)
      } catch {
        // One listener's failure must not starve the others - or reject start()/stop().
      }
    }
  }
}

/**
 * Creates an isolated realtime connection. The app uses {@link realtimeConnection};
 * tests use this to inject a fake.
 */
export function createRealtimeConnection(
  options: CreateRealtimeConnectionOptions = {},
): RealtimeConnection {
  return new SharedRealtimeConnection(options)
}

/**
 * The app-wide shared connection. Every consumer subscribes here — nothing else
 * should construct a `HubConnection`. Lazy: no side effects until first use.
 */
export const realtimeConnection: RealtimeConnection = createRealtimeConnection()

// The shared connection belongs to ONE identity (see the module header), so every end of a
// session - sign-out and every sign-in, both through `resetClientSession()` - stops it. Done
// through the registry, not a direct import, so `core/auth` stays free of `core/realtime`.
// `stop()` never rejects, so ignoring the promise is safe.
registerSessionReset(() => {
  void realtimeConnection.stop()
}, import.meta.hot)

/**
 * Stops `connection` when Vite hot-replaces the module that calls this (dev only; `hot` is
 * `undefined` in a production build). A hot-replaced `connection.ts` creates a NEW singleton, so
 * without this the old one would stay connected - on its identity's groups - with nobody holding
 * it. Takes the connection and `hot` as arguments so a test can drive the dispose callback.
 */
export function stopOnHotDispose(connection: RealtimeConnection, hot?: HotModule): void {
  hot?.dispose(() => {
    void connection.stop()
  })
}

stopOnHotDispose(realtimeConnection, import.meta.hot)
