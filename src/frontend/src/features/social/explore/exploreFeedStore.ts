/**
 * features/social/explore/exploreFeedStore.ts
 * ---------------------------------------------------------------------------
 * THE SHARED EXPLORE BASELINE (demo-polish F6, fold of Gate-1 M1/M3). One live,
 * bounded copy of the newest top-level posts that EVERY Explore consumer reads —
 * the right-rail Trending panel and search box, and the Explore page's own. A
 * participant-world, hook-free module; `useExploreFeed.ts` is its React binding.
 *
 * WHY IT IS NOT A MOUNT-TIME SNAPSHOT. The right rail is persistent: it mounts at
 * sign-in and stays for the session. If Trending read the same frozen baseline the
 * main feed does (`useFeed`), the rail would show sign-in-time trends all session,
 * and the demo's `#WaterIssues` surge — posts landing minutes after sign-in — would
 * never move it. So this store keeps itself current: it reads the feed ONCE
 * (`resolveFeed`, top-level only) and then folds in every arrival from the shared
 * arrival source.
 *
 * ONE READ, ONE CONNECTION, REF-COUNTED. However many components consume it:
 *   - the first consumer starts it (one feed read; one subscription to the app-wide
 *     `defaultFeedStreamSource` — the ref-counted, top-level-only narrowing of the
 *     shared arrival source, so no connection of its own is opened);
 *   - the last consumer leaving stops it, releasing the source and DROPPING the data
 *     (teardown is deferred one microtask, so a route change that unmounts one
 *     consumer and mounts another in the same commit — or React StrictMode's
 *     mount/unmount/mount — never restarts it).
 * Personas are NOT read here: the store holds `ParticipantPostView`s only, and the
 * channel's shared persona directory resolves authors for the consumers that need
 * them (search). Trending needs no author at all.
 *
 * BOUNDED + DEDUPED. At most {@link EXPLORE_FEED_CAP} (200) newest posts, by scenario
 * time (COR-053), deduplicated by id. The first copy of an id wins (an arrival that
 * the baseline read also returned is not doubled).
 *
 * BATCHED. Arrivals are collected and published together every
 * {@link EXPLORE_ARRIVAL_BATCH_MS}, so a 120-posts/min burst re-renders consumers a
 * couple of times a second, not once per post (NFR-002/SOC-071). The snapshot array
 * keeps its identity between batches, which is what lets Trending's memoized
 * computation run once per batch (or scenario minute), never per render.
 *
 * ISOLATION (COR-001 / XC-002). No client `exerciseId` goes anywhere: both the read
 * and the stream are session-scoped server-side. The store is keyed by a LOCAL scope
 * string (exercise + account) so a different session never reads the previous one's
 * data: a key change discards everything and starts clean, and the last consumer
 * leaving (sign-out unmounts the channel) discards it too. Everything it holds was
 * already narrowed to the participant-safe view (`toParticipantView`, or the arrival
 * source's own narrowing).
 *
 * FAILURE. A failed baseline read leaves the store in `error` (consumers show a text
 * state, never an empty "nothing is trending") and retries every
 * {@link EXPLORE_RETRY_MS} while anyone is still consuming it — the rail is
 * persistent, so one transient failure at sign-in must not blank it for the session.
 *
 * TODO(C5): takedown removal (Wave 3). When a removed-post event reaches the client,
 * drop that id from `byId` here and publish, so a taken-down post leaves Trending
 * and search without a reload. Until then the visibility filter in `trending.ts` /
 * `search.ts` only covers posts that arrive already marked removed.
 */

import { toParticipantView, type ParticipantPostView, type Post } from '@/features/social'
import { compareNewestFirst, resolveFeed } from '../services/feedService'
import { defaultFeedStreamSource, type FeedStreamSource } from '../services/feedStreamSource'

/** Most posts the baseline keeps (the newest-200 the contract serves). */
export const EXPLORE_FEED_CAP = 200
/** How long arrivals are collected before consumers are told. */
export const EXPLORE_ARRIVAL_BATCH_MS = 250
/** How long after a failed baseline read the next attempt is made. */
export const EXPLORE_RETRY_MS = 15_000

export type ExploreFeedStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface ExploreFeedSnapshot {
  readonly status: ExploreFeedStatus
  /** Newest first, at most {@link EXPLORE_FEED_CAP}, unique by id. Stable between batches. */
  readonly posts: readonly ParticipantPostView[]
  /** The baseline read's failure, while `status === 'error'`. */
  readonly error: unknown
}

export interface ExploreFeedStore {
  /**
   * Registers a consumer for `scopeKey` and (for the first one) starts the baseline.
   * Returns the idempotent release. Shape-compatible with `useSyncExternalStore`.
   */
  subscribe(scopeKey: string, listener: () => void): () => void
  /** The current snapshot for `scopeKey` (the idle snapshot for any other scope). */
  getSnapshot(scopeKey: string): ExploreFeedSnapshot
  /** Drops everything immediately (tests, and sign-out paths that want it now). */
  reset(): void
}

export interface CreateExploreFeedStoreOptions {
  /** The arrival source (default: the app-wide top-level-only `defaultFeedStreamSource`). */
  readonly source?: FeedStreamSource
  /** The baseline read (default: `resolveFeed`, top-level, All Posts). */
  readonly fetchFeed?: () => Promise<Post[]>
  readonly batchMs?: number
  readonly retryMs?: number
  readonly cap?: number
}

export const IDLE_SNAPSHOT: ExploreFeedSnapshot = Object.freeze({
  status: 'idle',
  posts: Object.freeze([]) as readonly ParticipantPostView[],
  error: undefined,
})

/** Newest first by scenario time (COR-053), ties by id so the order is total. */
function compareViews(a: ParticipantPostView, b: ParticipantPostView): number {
  const byTime = compareNewestFirst(a.scenarioTime, b.scenarioTime)
  if (byTime !== 0) return byTime
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Builds a store. The app uses the singleton {@link exploreFeedStore}; tests build their own. */
export function createExploreFeedStore(
  options: CreateExploreFeedStoreOptions = {},
): ExploreFeedStore {
  const source = options.source ?? defaultFeedStreamSource
  const fetchFeed = options.fetchFeed ?? (() => resolveFeed())
  const batchMs = options.batchMs ?? EXPLORE_ARRIVAL_BATCH_MS
  const retryMs = options.retryMs ?? EXPLORE_RETRY_MS
  const cap = options.cap ?? EXPLORE_FEED_CAP

  const listeners = new Set<() => void>()
  const byId = new Map<string, ParticipantPostView>()

  let holders = 0
  let generation = 0 // bumped by reset(): a release from before it must not touch the count
  let active = false
  let key: string | undefined
  let status: ExploreFeedStatus = 'idle'
  let failure: unknown
  let snapshot: ExploreFeedSnapshot = IDLE_SNAPSHOT
  let epoch = 0 // bumped on every start/teardown: a stale async result checks it
  let dirty = false
  let unsubscribeSource: (() => void) | undefined
  let batchTimer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  function notify(): void {
    for (const listener of [...listeners]) listener()
  }

  /** Rebuilds the published snapshot from `byId` (bounded, newest first) and tells everyone. */
  function publish(): void {
    dirty = false
    const sorted = [...byId.values()].sort(compareViews)
    if (sorted.length > cap) {
      for (const dropped of sorted.splice(cap)) byId.delete(dropped.id)
    }
    snapshot = { status, posts: sorted, error: failure }
    notify()
  }

  function scheduleBatch(): void {
    dirty = true
    if (batchTimer !== undefined || status !== 'ready') return
    batchTimer = setTimeout(() => {
      batchTimer = undefined
      if (active && dirty) publish()
    }, batchMs)
  }

  function onArrival(view: ParticipantPostView): void {
    if (!active || byId.has(view.id)) return
    byId.set(view.id, view)
    scheduleBatch()
  }

  function load(): void {
    const mine = epoch
    status = status === 'error' ? 'loading' : status
    fetchFeed()
      .then(posts => {
        if (mine !== epoch) return
        for (const post of posts) {
          const view = toParticipantView(post)
          if (!byId.has(view.id)) byId.set(view.id, view)
        }
        status = 'ready'
        failure = undefined
        publish()
      })
      .catch((error: unknown) => {
        if (mine !== epoch) return
        status = 'error'
        failure = error
        publish()
        retryTimer = setTimeout(() => {
          retryTimer = undefined
          if (mine !== epoch || !active) return
          load()
        }, retryMs)
      })
  }

  function start(scopeKey: string): void {
    active = true
    key = scopeKey
    epoch += 1
    byId.clear()
    dirty = false
    status = 'loading'
    failure = undefined
    snapshot = { status, posts: IDLE_SNAPSHOT.posts, error: undefined }
    // Subscribe BEFORE the read so nothing that lands while it is in flight is lost;
    // duplicates between the two are removed by id.
    unsubscribeSource = source.subscribe(onArrival)
    void source.start().catch(() => {})
    load()
    notify()
  }

  function teardown(): void {
    if (!active) return
    active = false
    epoch += 1
    if (batchTimer !== undefined) clearTimeout(batchTimer)
    if (retryTimer !== undefined) clearTimeout(retryTimer)
    batchTimer = undefined
    retryTimer = undefined
    unsubscribeSource?.()
    unsubscribeSource = undefined
    source.stop()
    byId.clear()
    key = undefined
    status = 'idle'
    failure = undefined
    snapshot = IDLE_SNAPSHOT
    dirty = false
  }

  return {
    subscribe(scopeKey, listener) {
      // A different session/exercise must never see the previous one's posts.
      if (active && key !== scopeKey) teardown()
      listeners.add(listener)
      holders += 1
      if (!active) start(scopeKey)

      const mine = generation
      let released = false
      return () => {
        if (released || mine !== generation) return
        released = true
        listeners.delete(listener)
        holders -= 1
        if (holders > 0) return
        // Deferred: a same-commit unmount + mount (route change, StrictMode) re-acquires
        // before this runs and keeps the baseline alive.
        queueMicrotask(() => {
          if (holders === 0) teardown()
        })
      }
    },
    getSnapshot(scopeKey) {
      return active && key === scopeKey ? snapshot : IDLE_SNAPSHOT
    },
    reset() {
      generation += 1
      holders = 0
      listeners.clear()
      teardown()
    },
  }
}

/** The app-wide Explore baseline. */
export const exploreFeedStore: ExploreFeedStore = createExploreFeedStore()
