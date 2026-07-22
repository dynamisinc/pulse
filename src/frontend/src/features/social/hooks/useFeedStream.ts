/**
 * features/social/hooks/useFeedStream.ts
 * ---------------------------------------------------------------------------
 * The buffered "▲ N new posts" pill's DATA hook (feature: feeds-discovery,
 * story 04; SOC-083, NFR-001/002/003, SOC-071, COR-001, XC-002, D1-005/011).
 * Participant world (Pulse Social skin) — no UI, no COBRA.
 *
 * THE DECISION IT IMPLEMENTS (D1-005). Real-time arrivals must NOT insert into
 * or scroll the feed the reader is looking at (that was the interim
 * feeds-discovery/07 UX, now superseded — see `useFeed.ts`). Instead they are
 * BUFFERED here; the page shows a sticky pill with the count; tapping the pill
 * drains the buffer and prepends the posts (Feed's job). Until the tap, the
 * reader's scroll position is never touched (AC1/AC2).
 *
 * WHAT IT DOES
 *   - Subscribes to a `FeedStreamSource` (the shared SignalR transport live, or
 *     the in-tab `postStore` under mock data — see `services/feedStreamSource`)
 *     and starts/stops it on mount/unmount.
 *   - Buffers each arriving `ParticipantPostView` in a BOUNDED buffer and
 *     exposes only `newCount` (the count) as render state — it never renders,
 *     nor materialises a DOM node per, a buffered post. `loadBuffered()` drains
 *     and RETURNS the buffer (Feed resolves authors + prepends).
 *
 * BURST / BOUNDING (NFR-002, SOC-071). The buffer is a bounded ring capped at
 * {@link FEED_STREAM_BUFFER_CAP}: when full, the OLDEST buffered post is evicted
 * to admit the newest, so memory cannot grow without limit at 120 posts/min and
 * `newCount` cannot exceed the cap. The count is the ONLY thing that re-renders
 * on arrival (a tiny state update the pill's `aria-live="polite"` region
 * coalesces — see `NewPostsPill`); the posts themselves stay inert in a ref
 * until the reader taps. The pill's own display caps the number to `99+`.
 *
 * DISABLED = INERT (D1-011, COR-015). In an observer / read-only session the
 * caller passes `enabled: false`; the hook then NEVER starts the source,
 * subscribes to nothing, keeps `newCount` at 0, and `loadBuffered()` returns
 * `[]`. Nothing streams, so there is nothing for the (hidden) pill to announce.
 *
 * ISOLATION (COR-001) / XC-002. The hook adds no `exerciseId` and never widens
 * a post's shape — it moves already-narrowed `ParticipantPostView`s from the
 * source into a buffer and back out. Both guarantees are inherited from the
 * source (see `services/feedStreamSource`), never re-opened here.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ParticipantPostView } from '@/features/social'
import {
  defaultFeedStreamSource,
  type FeedStreamSource,
  type FeedTransportMode,
} from '../services/feedStreamSource'

/**
 * Bounded-buffer cap (SOC-071). At the NFR-002 stress load (120 posts/min) this
 * holds ~100s of unattended arrivals before evicting; the display caps at `99+`
 * long before, so a larger cap would buy the reader nothing but memory. Chosen
 * as the single documented overflow bound — keep newest, drop oldest.
 */
export const FEED_STREAM_BUFFER_CAP = 200

export interface UseFeedStreamOptions {
  /**
   * Whether the stream runs. `false` (observer / read-only, D1-011) makes the
   * hook fully inert — no source start, no subscription, `newCount` stays 0.
   */
  readonly enabled: boolean
  /**
   * The new-post source. Defaults to the app-wide `defaultFeedStreamSource`
   * (SignalR live, `postStore` under mock). Injectable for tests; MUST be a
   * stable reference across renders (a module singleton or a `useMemo`) — it is
   * an effect dependency, so a new value each render would re-subscribe.
   */
  readonly source?: FeedStreamSource
}

export interface UseFeedStreamResult {
  /** Count of buffered posts waiting behind the pill (0 = nothing to show). */
  readonly newCount: number
  /**
   * Drains and returns the buffered posts (newest-first), clearing the buffer
   * and resetting `newCount` to 0. The caller resolves their authors and
   * prepends them to the reading stream (AC2). Stable identity.
   */
  loadBuffered(): ParticipantPostView[]
  /** The current transport mode (informational; fallback is transparent, NFR-003). */
  readonly mode: FeedTransportMode
}

/**
 * Buffers real-time post arrivals behind the "new posts" pill. See the module
 * header for the full contract.
 */
export function useFeedStream({
  enabled,
  source = defaultFeedStreamSource,
}: UseFeedStreamOptions): UseFeedStreamResult {
  // The buffer + its id-set live in refs: buffered posts are NOT render state
  // (only their count is), so admitting one must not force a full re-render of
  // anything but the pill's number (NFR-002/SOC-071).
  const bufferRef = useRef<ParticipantPostView[]>([])
  const bufferedIdsRef = useRef<Set<string>>(new Set())
  const [newCount, setNewCount] = useState(0)

  useEffect(() => {
    if (!enabled) return

    const unsubscribe = source.subscribe(post => {
      // Guard against a post the source somehow re-delivers (the transports
      // already dedup; this keeps the buffer's own invariant regardless).
      if (bufferedIdsRef.current.has(post.id)) return

      const buffer = bufferRef.current
      buffer.push(post)
      bufferedIdsRef.current.add(post.id)

      // Bounded ring (SOC-071): evict the oldest to admit the newest once full.
      if (buffer.length > FEED_STREAM_BUFFER_CAP) {
        const evicted = buffer.shift()
        if (evicted !== undefined) bufferedIdsRef.current.delete(evicted.id)
      }

      // Only the count is render state — a cheap update the pill's polite
      // region coalesces; the posts stay inert until the reader taps.
      setNewCount(buffer.length)
    })

    void source.start()

    return () => {
      unsubscribe()
      source.stop()
    }
  }, [enabled, source])

  const loadBuffered = useCallback((): ParticipantPostView[] => {
    // Drain newest-first: the buffer is filled in arrival order, and new posts
    // land at the TOP of the feed (D1-005), so hand them back newest-first.
    const drained = bufferRef.current.slice().reverse()
    bufferRef.current = []
    bufferedIdsRef.current.clear()
    setNewCount(0)
    return drained
  }, [])

  return {
    newCount: enabled ? newCount : 0,
    loadBuffered,
    mode: source.mode,
  }
}
