/**
 * features/controller/liveWorld/useLiveWorldFeed.ts
 * ---------------------------------------------------------------------------
 * The DATA hook behind the console's LIVE WORLD column (demo-polish C2,
 * docs/features/demo-polish/18-live-world-column.md; CTL-030, COR-001, XC-002,
 * NFR-002 / SOC-071, NFR-003). STAFF world — no UI, no COBRA. It owns three
 * things and nothing else: the baseline read, the real-time arrivals, and the
 * transport label.
 *
 * ## The baseline: `resolveFeed('all', { includeReplies: true })`
 * The column lists the exercise's posts INCLUDING replies, so the read opts into
 * replies (`resolveFeed` is top-level only by default, DP-5). It is the same
 * participant-safe feed read every participant surface uses, taking NO client
 * `exerciseId` (the session binds the exercise server-side, COR-001); each `Post`
 * is narrowed through the sole sanctioned `toParticipantView` (XC-002) before it
 * is stored. A failed baseline read is surfaced as `status: 'error'` with a
 * `retry()` — it is NEVER swapped for an empty list, so the controller can't
 * mistake a failure for "all quiet".
 *
 * ## Arrivals: the SHARED transport, no second connection
 * New posts come from `defaultArrivalSource` (`social/services/feedStreamSource`),
 * the ref-counted UNFILTERED arrival stream (replies included — the feed-pill
 * stream drops them, this one doesn't). It wraps the app-wide `realtimeFeed`
 * singleton on the one shared SignalR connection, with the polling fallback
 * (NFR-003); under mock data it is the in-tab `postStore`. This hook subscribes
 * and `start()`s on mount and `stop()`s on unmount; because the source is
 * ref-counted, a participant preview or thread elsewhere on the page keeps its
 * own hold on the transport. A staff session reads the same participant-safe
 * payload, without `viewer`.
 *
 * ## Burst legibility
 * Arrivals are queued and applied in BATCHES every {@link ARRIVAL_BATCH_MS}, so a
 * 120 posts/min burst is a handful of state updates per second, not one render
 * per post. Each batch is applied through `ingest`: it goes to `pending` (behind
 * the "N new" control) when the caller says the controller is reading
 * (`isReading()` — scrolled down, or focus on a row below the top), and into
 * `rows` otherwise. Both collections are bounded (see `liveWorldModel`).
 *
 * ## Transport label, the polling-mode sweep, and the realtime count refresh
 * `FeedStreamSource.mode` is a plain getter, not a subscription, so it is read on
 * every applied batch and on a {@link MODE_SYNC_MS} timer. While the transport is
 * POLLING, the shared `realtimeFeed` polls the TOP-LEVEL feed only, which would
 * silently drop every reply from this column. So while polling — and once on
 * recovery, to fill the gap — the hook re-reads the baseline with replies every
 * {@link POLLING_SWEEP_MS} and merges it by id (new posts follow the same
 * buffer-or-insert rule; known posts get fresh counts). A failed sweep is
 * silent: the transport is already shown as POLLING and the next tick retries.
 *
 * While the transport is REALTIME the same merge-by-id sweep runs slowly
 * ({@link COUNT_REFRESH_MS} +/- {@link COUNT_REFRESH_JITTER_MS}) so the counts on
 * rows already listed keep moving (nothing pushes reaction counts). It stops on
 * unmount or when the mode leaves REALTIME.
 *
 * ## Lifetime
 * Unmounting stops the timers, drops the queue, unsubscribes and releases the
 * transport; a late response after unmount is ignored. `resolveFeed` takes no
 * `AbortSignal` (it is the participant seam, F0's), so an in-flight read can't be
 * cancelled on the wire — its result is simply discarded (`aliveRef`), and a
 * single-flight guard stops a slow sweep from being stacked on itself. The
 * column keys its panel by exercise, so an exercise switch is an unmount + fresh
 * mount (nothing from the old exercise survives).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ParticipantPostView } from '@/features/social'
import { resolveFeed } from '@/features/social/services/feedService'
import { toParticipantView } from '@/features/social/services/postService'
import {
  defaultArrivalSource,
  type FeedStreamSource,
  type FeedTransportMode,
} from '@/features/social/services/feedStreamSource'
import {
  EMPTY_LIVE_WORLD_STATE,
  ingest,
  mergePending,
  toEntry,
  type LiveWorldEntry,
  type LiveWorldState,
} from './liveWorldModel'

/** How long arrivals are queued before a batch is applied (burst legibility). */
export const ARRIVAL_BATCH_MS = 150

/** Baseline re-read cadence while the transport is polling (replies would be missed). */
export const POLLING_SWEEP_MS = 5000

/** How often the (non-reactive) transport mode is re-read. */
export const MODE_SYNC_MS = 1000

/**
 * Cadence of the slow COUNT-REFRESH sweep while the transport is REALTIME: nothing
 * pushes reaction counts, so without it the engagement numbers on rows already
 * listed would freeze at load time. Each delay is this plus or minus a random
 * jitter of up to {@link COUNT_REFRESH_JITTER_MS}, so several consoles never sync
 * their reads.
 */
export const COUNT_REFRESH_MS = 45_000
export const COUNT_REFRESH_JITTER_MS = 15_000

/** Progress of the first baseline read. */
export type LiveWorldLoadStatus = 'loading' | 'ready' | 'error'

export interface UseLiveWorldFeedOptions {
  /**
   * The arrival source. Defaults to the app-wide ref-counted
   * `defaultArrivalSource`. Injectable for tests; MUST be a stable reference
   * across renders (it is an effect dependency).
   */
  readonly source?: FeedStreamSource
  /**
   * Whether the controller is reading (scrolled down, or focus on a row below the
   * top) at the moment a batch lands. Read at apply time; reading it must be
   * cheap. When true, new posts are held in `pending` instead of moving the list.
   */
  readonly isReading: () => boolean
}

export interface UseLiveWorldFeedResult {
  /** The listed posts, newest-first, bounded. */
  readonly rows: readonly LiveWorldEntry[]
  /** Arrivals held behind the "N new" control, newest-first, bounded. */
  readonly pending: readonly LiveWorldEntry[]
  /** Progress of the first baseline read; `'error'` carries {@link error}. */
  readonly status: LiveWorldLoadStatus
  /** The first baseline read's failure, or `undefined`. */
  readonly error: unknown
  /** The shared transport's current mode (REALTIME / POLLING / CONNECTING). */
  readonly mode: FeedTransportMode
  /** Re-runs the first baseline read after a failure. Stable identity. */
  retry(): void
  /** Moves every pending arrival into `rows`. A no-op when none. Stable identity. */
  showPending(): void
}

/** Streams the exercise's posts (replies included) for the Live world column. */
export function useLiveWorldFeed({
  source = defaultArrivalSource,
  isReading,
}: UseLiveWorldFeedOptions): UseLiveWorldFeedResult {
  const [state, setState] = useState<LiveWorldState>(EMPTY_LIVE_WORLD_STATE)
  const [status, setStatus] = useState<LiveWorldLoadStatus>('loading')
  const [error, setError] = useState<unknown>(undefined)
  const [mode, setMode] = useState<FeedTransportMode>(source.mode)

  const isReadingRef = useRef(isReading)
  useLayoutEffect(() => {
    isReadingRef.current = isReading
  })

  const aliveRef = useRef(false)
  const seqRef = useRef(0)
  const queueRef = useRef<ParticipantPostView[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadedRef = useRef(false)
  const sweepInFlightRef = useRef(false)

  const syncMode = useCallback(() => {
    setMode(source.mode)
  }, [source])

  /** Applies the queued arrivals as ONE batch. */
  const flush = useCallback(() => {
    timerRef.current = null
    const batch = queueRef.current
    if (batch.length === 0) return
    queueRef.current = []
    const entries = batch.map(view => {
      seqRef.current += 1
      return toEntry(view, seqRef.current)
    })
    const buffer = isReadingRef.current()
    setState(prev => ingest(prev, entries, buffer))
    syncMode()
  }, [syncMode])

  /** One baseline read (with replies); `'sweep'` is the silent polling-mode refresh. */
  const load = useCallback(async (kind: 'initial' | 'sweep'): Promise<void> => {
    if (kind === 'sweep') {
      if (!loadedRef.current || sweepInFlightRef.current) return
      sweepInFlightRef.current = true
    }
    try {
      const posts = await resolveFeed('all', { includeReplies: true })
      if (!aliveRef.current) return
      // The feed arrives newest-first: give earlier items the HIGHER seq so a
      // same-instant tie keeps the server's order.
      const base = seqRef.current
      seqRef.current += posts.length
      const entries = posts.map((post, index) =>
        toEntry(toParticipantView(post), base + posts.length - index))
      const buffer = kind === 'sweep' && isReadingRef.current()
      setState(prev => ingest(prev, entries, buffer))
      if (kind === 'initial') {
        loadedRef.current = true
        setError(undefined)
        setStatus('ready')
      }
    } catch (err) {
      if (!aliveRef.current) return
      if (kind === 'initial') {
        setError(err)
        setStatus('error')
      }
    } finally {
      if (kind === 'sweep') sweepInFlightRef.current = false
    }
  }, [])

  // Subscribe BEFORE the baseline read so an arrival during the read is not lost
  // (a post that is in both is de-duplicated by id).
  useEffect(() => {
    aliveRef.current = true
    const unsubscribe = source.subscribe(view => {
      queueRef.current.push(view)
      if (timerRef.current === null) timerRef.current = setTimeout(flush, ARRIVAL_BATCH_MS)
    })
    // A source that cannot start yields no stream; the baseline still shows. The
    // shipped realtime source degrades to polling internally, so this is defence
    // in depth against an unhandled rejection.
    void source.start().then(syncMode, syncMode)
    void load('initial')

    return () => {
      aliveRef.current = false
      loadedRef.current = false
      unsubscribe()
      source.stop()
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      queueRef.current = []
    }
  }, [source, flush, load, syncMode])

  // The mode getter is not reactive: re-read it on a timer.
  useEffect(() => {
    const id = setInterval(syncMode, MODE_SYNC_MS)
    return () => clearInterval(id)
  }, [syncMode])

  // Polling-mode sweep (see the module header) + a one-off gap fill on recovery.
  const previousModeRef = useRef<FeedTransportMode>(mode)
  useEffect(() => {
    const previous = previousModeRef.current
    previousModeRef.current = mode
    if (mode === 'polling') {
      void load('sweep')
      const id = setInterval(() => {
        void load('sweep')
      }, POLLING_SWEEP_MS)
      return () => clearInterval(id)
    }
    if (previous === 'polling' && mode === 'realtime') void load('sweep')
    return undefined
  }, [mode, load])

  // Slow count refresh while REALTIME (see the module header). A self-rescheduling
  // timeout (not an interval) so every delay carries its own jitter.
  useEffect(() => {
    if (mode !== 'realtime') return undefined
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      const jitter = (Math.random() * 2 - 1) * COUNT_REFRESH_JITTER_MS
      timer = setTimeout(() => {
        void load('sweep')
        schedule()
      }, COUNT_REFRESH_MS + jitter)
    }
    schedule()
    return () => {
      if (timer !== null) clearTimeout(timer)
    }
  }, [mode, load])

  const retry = useCallback(() => {
    setError(undefined)
    setStatus('loading')
    void load('initial')
  }, [load])

  const showPending = useCallback(() => {
    setState(mergePending)
  }, [])

  return {
    rows: state.rows,
    pending: state.pending,
    status,
    error,
    mode,
    retry,
    showPending,
  }
}
