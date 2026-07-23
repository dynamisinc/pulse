/**
 * features/social/services/feedStreamSource.ts
 * ---------------------------------------------------------------------------
 * The NEW-POST SOURCE seam for the buffered "▲ N new posts" pill
 * (feature: feeds-discovery, story 04; SOC-083, NFR-002/003, SOC-071, COR-001,
 * XC-002). Participant world (Pulse Social skin) — pure service module, no UI,
 * no COBRA.
 *
 * WHAT THIS IS. `useFeedStream()` (the pill's buffering hook) does not care
 * WHERE a new post came from — it only needs "here is another participant-safe
 * post that arrived AFTER the reader's baseline". This module is that single,
 * swappable seam: a `FeedStreamSource` delivering a stream of
 * `ParticipantPostView`s, plus its start/stop lifecycle and the current
 * transport `mode`.
 *
 * TWO IMPLEMENTATIONS, ONE FLIP POINT (mirrors `feedService.ts`'s USE_MOCK_FEED):
 *   - `makeRealtimeFeedSource()` — a THIN wrapper over the already-built
 *     `realtimeFeed` singleton (services/realtimeFeed.ts). That module already
 *     owns the shared-SignalR-connection consumption, the polling fallback +
 *     reconnect-window degrade (NFR-003), the field-by-field XC-002 rebuild, and
 *     dedup — this wrapper adds NOTHING that could widen any of it. AC4's
 *     transport + fallback are DONE there; we only consume.
 *   - `makeMockPostStoreSource()` — subscribes to the in-tab `postStore`
 *     (feeds-discovery/07), baselines against the store's snapshot at `start()`,
 *     and emits ONLY posts appended AFTER that baseline, each narrowed through
 *     the SOLE sanctioned `toParticipantView` (XC-002). This is what `npm run
 *     dev`, the mock-data UAT build, and the tests exercise.
 *
 * ISOLATION (COR-001). Neither source takes, builds, or joins on a client
 * `exerciseId` — the realtime source inherits the shared connection's
 * server-scoped exercise group; the mock source reads the same exercise-scoped
 * `postStore` the feed already reads. This module introduces NO parameter that
 * could widen scope.
 *
 * XC-002. Every post that leaves a source is a `ParticipantPostView` — the
 * realtime source's payloads are already rebuilt field-by-field inside
 * `realtimeFeed`; the mock source narrows each appended `Post` via
 * `toParticipantView` (never spreads a `Post`). A provenance field
 * (`origin`/`actingHumanId`/`createdWallClock`/`injectId`) can never ride out.
 */

import { USE_MOCK_DATA } from '@/core/config/mockData'
import { toParticipantView } from '@/features/social'
import type { ParticipantPostView } from '@/features/social'
import { realtimeFeed, type FeedTransportMode, type RealtimeFeed } from './realtimeFeed'
import { postStore } from './postStore'

/** Receives each newly-observed participant-safe post. */
export type FeedStreamHandler = (post: ParticipantPostView) => void

/**
 * The new-post source `useFeedStream()` consumes. Deliberately identical in
 * shape to the slice of `RealtimeFeed` the hook needs, so the realtime source
 * is a near-passthrough and a test fake is trivial to write.
 */
export interface FeedStreamSource {
  /** Registers a handler for each newly-observed post. Returns an idempotent unsubscribe. */
  subscribe(handler: FeedStreamHandler): () => void
  /** Starts the source; resolves once running. Idempotent. */
  start(): Promise<void>
  /** Stops the source and releases its subscriptions/timers. */
  stop(): void
  /** The active transport mode (see {@link FeedTransportMode}). */
  readonly mode: FeedTransportMode
}

/**
 * Wraps the shared `realtimeFeed` transport (services/realtimeFeed.ts) as a
 * `FeedStreamSource`. A thin passthrough — it re-implements NONE of the
 * SignalR/polling/dedup/XC-002 logic that already lives there; it only adapts
 * the surface. `mode` is a live getter so a caller reading it sees the current
 * transport state (`connecting`/`realtime`/`polling`).
 *
 * @param feed  Overridable for tests; defaults to the app-wide singleton bound
 *   to the shared `realtimeConnection` (never a second connection — COR-001).
 */
export function makeRealtimeFeedSource(feed: RealtimeFeed = realtimeFeed): FeedStreamSource {
  return {
    subscribe: handler => feed.subscribe(handler),
    start: () => feed.start(),
    stop: () => feed.stop(),
    get mode() {
      return feed.mode
    },
  }
}

/**
 * A `FeedStreamSource` backed by the in-tab `postStore` (feeds-discovery/07),
 * for the mock/dev/test path. On `start()` it snapshots the store as the
 * BASELINE (those posts are already the reader's frozen feed — never re-emit
 * them) and thereafter emits only posts appended AFTER that snapshot, each
 * narrowed via `toParticipantView` (XC-002). `start()` re-baselines against the
 * then-current snapshot every time, so a stop→start cycle (or a test's
 * `postStore.resetForTests()` between mounts) starts clean with no stale ids.
 *
 * `mode` is a constant `'realtime'`: an in-tab push store is a live push, not a
 * degraded poll — there is no fallback to report here (the real NFR-003
 * fallback lives in `realtimeFeed`).
 *
 * @param store  Overridable for tests; defaults to the shared `postStore`.
 */
export function makeMockPostStoreSource(store = postStore): FeedStreamSource {
  const handlers = new Set<FeedStreamHandler>()
  // Ids present at (or emitted since) `start()`. A post whose id is here has
  // already been accounted for — baseline rows are never re-emitted, and the
  // store's O(1)-append/O(n)-notify contract is diffed against this set.
  const seenIds = new Set<string>()
  let unsubscribeStore: (() => void) | null = null
  let started = false

  function emitAppendedSince(): void {
    // postStore.appendPost notifies with no payload; re-read the current
    // snapshot and emit anything not yet seen (baseline or already delivered).
    for (const post of store.getPosts()) {
      if (seenIds.has(post.id)) continue
      seenIds.add(post.id)
      const view = toParticipantView(post)
      for (const handler of handlers) handler(view)
    }
  }

  return {
    subscribe(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    start() {
      if (started) return Promise.resolve()
      started = true
      // Fresh baseline: the current store snapshot is the reader's frozen feed.
      seenIds.clear()
      for (const post of store.getPosts()) seenIds.add(post.id)
      unsubscribeStore = store.subscribe(emitAppendedSince)
      return Promise.resolve()
    },
    stop() {
      started = false
      if (unsubscribeStore !== null) {
        unsubscribeStore()
        unsubscribeStore = null
      }
    },
    mode: 'realtime',
  }
}

/**
 * The app-wide new-post source for `useFeedStream()`.
 *
 * COMPOSITION FLIP — orchestrator-owned/reviewed (mirrors `feedService.ts`'s
 * `USE_MOCK_FEED`): mock-data builds (dev / opted-in UAT / tests) stream from
 * the in-tab `postStore`; a real backend build streams from the shared SignalR
 * transport with its polling fallback. Lazy — constructing this touches neither
 * the network nor the store until `useFeedStream` calls `start()`.
 */
export const defaultFeedStreamSource: FeedStreamSource =
  USE_MOCK_DATA ? makeMockPostStoreSource() : makeRealtimeFeedSource()

// Re-export the transport-mode type so `useFeedStream` imports it from this
// seam (its direct dependency) rather than reaching into `realtimeFeed`.
export type { FeedTransportMode }
