/**
 * features/channels/data/useChannelStream.ts
 * ---------------------------------------------------------------------------
 * The ONE typed subscription to channel content pushes (channels-foundation
 * story 09, #705; FC-5; PRT-006, NWS-013, NFR-001/002, XC-001/002).
 * Participant world - no UI, no COBRA.
 *
 * WHAT IT DOES
 *   - Subscribes to `ContentPublished`, `ContentRevised` and `ContentRetracted`
 *     on the SHARED `realtimeConnection` (no second hub, no second connection)
 *     and starts it if nothing has yet; unsubscribes on unmount.
 *   - Validates every frame with the frozen FC-5 guards and DROPS anything
 *     malformed, for another channel, or (when `outletSlug` is given) for
 *     another outlet. Revise/retract frames carry no outlet field, so their
 *     outlet is read from the permalink `/{channelId}/{outletSlug}/{slug}`.
 *   - Replays nothing: a frame that arrived before mount is gone. A page
 *     converges by REFETCHING when the hub comes back after a gap
 *     (`onResync`), exactly as the feed does - never by a server replay.
 *   - `AlertsChanged` is NOT handled here: the alert bar owns alerts and their
 *     announcements (PRT-010).
 *
 * BURST (NFR-002, SOC-071). At 120 items/min frames are queued and delivered in
 * ONE flush per animation frame: every callback for that frame runs inside the
 * same task, so React batches the consumer's state updates and the hook's own
 * `newItemCount` update into at most one render per frame.
 *
 * LIVE REGION (NFR-001). `newItemCount` counts distinct published items since
 * the last `clearNewItems()` (the "N new stories" pill's number); a retraction
 * of one of them takes it back out, and a channel/outlet change resets it. The hook
 * never announces per item: the first arrival is announced at once, and any
 * further arrivals inside the following 5 s window are folded into ONE polite
 * announcement when the window closes ("4 new stories"). The consumer renders
 * the message through `announce` (or reads `announcement` for its own
 * `aria-live="polite"` region).
 *
 * ISOLATION (XC-001). The hub only delivers frames for the connection's own
 * exercise group; this hook adds no exercise id and widens no shape (XC-002).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { HubConnectionState, realtimeConnection } from '@/core/realtime/connection'
import type { RealtimeConnection } from '@/core/realtime/connection'
import {
  isChannelContentSummaryDto,
  isContentRetractedDto,
  isContentRevisedDto,
  type ChannelContentSummaryDto,
  type ChannelId,
  type ContentRetractedDto,
  type ContentRevisedDto,
} from '../contract'

/** The coalescing window for live-region announcements (NFR-001/NFR-002). */
export const CHANNEL_STREAM_ANNOUNCE_WINDOW_MS = 5000

/** Schedules `callback` for the next animation frame; returns a cancel. */
export type FrameScheduler = (callback: () => void) => () => void

/** The default scheduler: `requestAnimationFrame`, or a ~16 ms timer where there is none. */
export const animationFrameScheduler: FrameScheduler = callback => {
  if (typeof requestAnimationFrame === 'function') {
    const handle = requestAnimationFrame(() => callback())
    return () => cancelAnimationFrame(handle)
  }
  const handle = setTimeout(callback, 16)
  return () => clearTimeout(handle)
}

/** The default announcement text. */
export function defaultNewItemsMessage(count: number): string {
  return count === 1 ? '1 new story' : `${count} new stories`
}

export interface UseChannelStreamOptions {
  /** The channel whose frames are delivered; every other channel's are dropped. */
  readonly channelId: ChannelId
  /** When given, only this outlet's frames are delivered. */
  readonly outletSlug?: string
  /** A published item (publish-now, scheduled runner, restore). */
  readonly onPublished?: (item: ChannelContentSummaryDto) => void
  /** A revise (no body: refetch the item if it is open). A `silent_rewrite` has no new revision. */
  readonly onRevised?: (frame: ContentRevisedDto) => void
  /** A retraction (or soft delete of a published item). */
  readonly onRetracted?: (frame: ContentRetractedDto) => void
  /** The hub came back after a gap in which pushes may have been missed: refetch. */
  readonly onResync?: () => void
  /** Receives each coalesced polite announcement. */
  readonly announce?: (message: string) => void
  /** Builds the announcement for `count` new items. Defaults to "N new stories". */
  readonly formatAnnouncement?: (count: number) => string
  /** `false` makes the hook inert (no subscription, no start). Defaults to `true`. */
  readonly enabled?: boolean
  /** The shared connection; injectable for tests. Must be a stable reference. */
  readonly connection?: RealtimeConnection
  /** The per-frame scheduler; injectable for tests. Must be a stable reference. */
  readonly scheduleFrame?: FrameScheduler
}

export interface UseChannelStreamResult {
  /** Distinct published items since the last {@link UseChannelStreamResult.clearNewItems}. */
  readonly newItemCount: number
  /** Resets `newItemCount` (the reader loaded the new items). */
  readonly clearNewItems: () => void
  /** The latest coalesced announcement, for a consumer-rendered polite live region. */
  readonly announcement: string
}

type QueuedFrame =
  | { readonly kind: 'published'; readonly item: ChannelContentSummaryDto }
  | { readonly kind: 'revised'; readonly frame: ContentRevisedDto }
  | { readonly kind: 'retracted'; readonly frame: ContentRetractedDto }

/** The outlet slug segment of a content permalink, or null when it is not one. */
export function permalinkOutletSlug(permalink: string): string | null {
  const segments = permalink.split('/')
  // '', channelId, outletSlug, contentSlug
  return segments.length === 4 && segments[0] === '' ? (segments[2] ?? null) : null
}

/**
 * Coalesces announcements: the first arrival is announced at once and opens a
 * window; arrivals inside the window are announced together when it closes,
 * which opens the next window. At most one announcement per window.
 */
export function createAnnouncementCoalescer(
  emit: (count: number) => void,
  windowMs: number = CHANNEL_STREAM_ANNOUNCE_WINDOW_MS,
): { readonly add: (count: number) => void; readonly dispose: () => void } {
  let pending = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const closeWindow = (): void => {
    timer = null
    if (pending === 0) return
    const count = pending
    pending = 0
    emit(count)
    timer = setTimeout(closeWindow, windowMs)
  }

  return {
    add(count: number) {
      if (count <= 0) return
      if (timer === null) {
        emit(count)
        timer = setTimeout(closeWindow, windowMs)
        return
      }
      pending += count
    },
    dispose() {
      if (timer !== null) clearTimeout(timer)
      timer = null
      pending = 0
    },
  }
}

/**
 * Subscribes a channel page to its live content frames. See the module header.
 */
export function useChannelStream(options: UseChannelStreamOptions): UseChannelStreamResult {
  const {
    channelId,
    outletSlug,
    enabled = true,
    connection = realtimeConnection,
    scheduleFrame = animationFrameScheduler,
  } = options

  const [newItemCount, setNewItemCount] = useState(0)
  const [announcement, setAnnouncement] = useState('')

  // Callbacks are read through a ref, so a consumer passing inline lambdas never re-subscribes.
  const callbacksRef = useRef(options)
  useEffect(() => {
    callbacksRef.current = options
  })

  // Every item already delivered (a restore of a seen id is not "new" again),
  // and the ids behind newItemCount.
  const seenIdsRef = useRef(new Set<string>())
  const pendingIdsRef = useRef(new Set<string>())

  useEffect(() => {
    if (!enabled) return undefined

    let disposed = false
    let queue: QueuedFrame[] = []
    let cancelFrame: (() => void) | null = null
    let hadGap = false

    const coalescer = createAnnouncementCoalescer(count => {
      const format = callbacksRef.current.formatAnnouncement ?? defaultNewItemsMessage
      const message = format(count)
      setAnnouncement(message)
      callbacksRef.current.announce?.(message)
    })

    const isForThisOutlet = (permalink: string): boolean =>
      outletSlug === undefined || permalinkOutletSlug(permalink) === outletSlug

    const flush = (): void => {
      cancelFrame = null
      if (disposed) return
      const frames = queue
      queue = []
      const callbacks = callbacksRef.current
      const pending = pendingIdsRef.current
      const pendingBefore = pending.size
      let added = 0
      for (const frame of frames) {
        if (frame.kind === 'published') {
          if (!seenIdsRef.current.has(frame.item.id)) {
            seenIdsRef.current.add(frame.item.id)
            pending.add(frame.item.id)
            added += 1
          }
          callbacks.onPublished?.(frame.item)
        } else if (frame.kind === 'revised') {
          callbacks.onRevised?.(frame.frame)
        } else {
          // A retracted item the reader has not loaded yet is no longer "new".
          pending.delete(frame.frame.id)
          callbacks.onRetracted?.(frame.frame)
        }
      }
      if (pending.size !== pendingBefore || added > 0) setNewItemCount(pending.size)
      coalescer.add(added)
    }

    const enqueue = (frame: QueuedFrame): void => {
      if (disposed) return
      queue.push(frame)
      cancelFrame ??= scheduleFrame(flush)
    }

    const offPublished = connection.subscribe('ContentPublished', payload => {
      if (!isChannelContentSummaryDto(payload)) return
      if (payload.channelId !== channelId) return
      if (outletSlug !== undefined && payload.outlet.slug !== outletSlug) return
      enqueue({ kind: 'published', item: payload })
    })
    const offRevised = connection.subscribe('ContentRevised', payload => {
      if (!isContentRevisedDto(payload)) return
      if (payload.channelId !== channelId || !isForThisOutlet(payload.permalink)) return
      enqueue({ kind: 'revised', frame: payload })
    })
    const offRetracted = connection.subscribe('ContentRetracted', payload => {
      if (!isContentRetractedDto(payload)) return
      if (payload.channelId !== channelId || !isForThisOutlet(payload.permalink)) return
      enqueue({ kind: 'retracted', frame: payload })
    })
    const offState = connection.onStateChange((state, reason) => {
      if (disposed) return
      if (state !== HubConnectionState.Connected) {
        // A deliberate stop is the session reset's doing, not a missed-push window.
        if (reason !== 'stopped') hadGap = true
        return
      }
      if (!hadGap) return
      hadGap = false
      callbacksRef.current.onResync?.()
    })

    connection.start().catch(() => {
      // Hub unreachable: the page's own read stands; a later Connected triggers onResync.
      hadGap = true
    })

    return () => {
      disposed = true
      offPublished()
      offRevised()
      offRetracted()
      offState()
      cancelFrame?.()
      cancelFrame = null
      queue = []
      coalescer.dispose()
      // The count belongs to this channel/outlet view: a different one starts clean.
      seenIdsRef.current = new Set()
      pendingIdsRef.current = new Set()
      setNewItemCount(0)
      setAnnouncement('')
    }
  }, [enabled, channelId, outletSlug, connection, scheduleFrame])

  const clearNewItems = useCallback(() => {
    pendingIdsRef.current.clear()
    setNewItemCount(0)
  }, [])

  return { newItemCount, clearNewItems, announcement }
}
