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
 * TESTABILITY. `createRealtimeConnection({ hubUrl, buildConnection })` lets a
 * test point the connection at a fake transport (or override the hub URL)
 * without a real WebSocket; the app uses the lazy shared `realtimeConnection`
 * singleton.
 *
 * World: participant-adjacent shared infrastructure — no UI, no COBRA.
 */

import { HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr'
import type { HubConnection } from '@microsoft/signalr'

export { HubConnectionState } from '@microsoft/signalr'

/** A handler for a hub event's payload. The payload is untyped at the transport
 * layer — each consumer validates/narrows it to its own contract. */
export type RealtimeEventHandler = (payload: unknown) => void

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
   * Returns an unsubscribe.
   */
  onStateChange(listener: (state: HubConnectionState) => void): () => void

  /**
   * Starts the connection if it is not already started. Idempotent; resolves once
   * connected, rejects if the start fails.
   */
  start(): Promise<void>

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

/** The default live `HubConnection`: auto-reconnecting, warning-level logging. */
function createDefaultHubConnection(hubUrl: string): HubConnection {
  return new HubConnectionBuilder()
    .withUrl(hubUrl)
    .withAutomaticReconnect()
    .configureLogging(LogLevel.Warning)
    .build()
}

/**
 * The single shared connection. The underlying `HubConnection` is built lazily
 * on the first `subscribe`/`start` — importing this module (or the singleton
 * below) touches neither the network nor `window`.
 */
class SharedRealtimeConnection implements RealtimeConnection {
  private readonly buildConnection: (hubUrl: string) => HubConnection
  private readonly hubUrlOverride: string | undefined
  private readonly stateListeners = new Set<(state: HubConnectionState) => void>()
  private connection: HubConnection | null = null
  private startPromise: Promise<void> | null = null

  constructor(options: CreateRealtimeConnectionOptions = {}) {
    this.buildConnection = options.buildConnection ?? createDefaultHubConnection
    this.hubUrlOverride = options.hubUrl
  }

  get state(): HubConnectionState {
    return this.connection?.state ?? HubConnectionState.Disconnected
  }

  subscribe(eventName: string, handler: RealtimeEventHandler): () => void {
    const connection = this.ensureConnection()
    connection.on(eventName, handler)
    let active = true
    return () => {
      if (!active) return
      active = false
      connection.off(eventName, handler)
    }
  }

  onStateChange(listener: (state: HubConnectionState) => void): () => void {
    this.stateListeners.add(listener)
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  start(): Promise<void> {
    const connection = this.ensureConnection()
    if (connection.state === HubConnectionState.Connected) return Promise.resolve()
    if (this.startPromise !== null) return this.startPromise

    const pending = connection
      .start()
      .then(() => {
        this.emitState(HubConnectionState.Connected)
      })
      .catch((error: unknown) => {
        // Failed to connect: clear the memo so a later start() (the polling
        // recovery driver) can retry rather than replaying this rejection.
        this.startPromise = null
        throw error
      })
    this.startPromise = pending
    return pending
  }

  private ensureConnection(): HubConnection {
    if (this.connection !== null) return this.connection

    const hubUrl = this.hubUrlOverride ?? resolveHubUrl()
    const connection = this.buildConnection(hubUrl)
    connection.onreconnecting(() => {
      this.emitState(HubConnectionState.Reconnecting)
    })
    connection.onreconnected(() => {
      this.emitState(HubConnectionState.Connected)
    })
    connection.onclose(() => {
      // Auto-reconnect exhausted: clear the memo so start() can re-establish later.
      this.startPromise = null
      this.emitState(HubConnectionState.Disconnected)
    })
    this.connection = connection
    return connection
  }

  private emitState(state: HubConnectionState): void {
    for (const listener of this.stateListeners) {
      listener(state)
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
