/**
 * features/social/pinned/usePinnedFeed.ts
 * ---------------------------------------------------------------------------
 * The Pinned tab's data hook (demo-feedback story 07; DF-5, DF-7). Participant world -
 * pure hook, no UI.
 *
 *  - Reads `GET /api/feed/pinned` once on mount (`resolvePinnedFeed`, mock adapter behind
 *    the existing switch) and keeps the server's order.
 *  - RE-READS whenever the viewer's own pin or like settles anywhere in the tab
 *    (`viewerEngagement`) and on every `PostPinChanged` push, so pinning, unpinning,
 *    liking or unliking - or a controller pinning a post for everyone - updates the tab
 *    without a reload. Reads never overlap: a change that lands while one is on the wire
 *    queues exactly one more, and only the newest read's answer is applied.
 *  - A `PostPinChanged` also PATCHES the listed post's `pinnedForAll` at once, so the
 *    "Pinned" marker moves before the re-read lands.
 *  - A failed FIRST read is `status: 'error'` (never an empty tab in its place); a failed
 *    re-read keeps what is on screen (the next change retries).
 *
 * Taken-down posts are filtered by the component (it reads the session's `removedPosts`),
 * not here, so a removal needs no re-read.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { realtimeFeed, type PinChangeSource } from '../services/realtimeFeed'
import type { ParticipantPostView } from '../types/post'
import { resolvePinnedFeed } from './pinnedFeedService'
import { viewerEngagement } from './pinEvents'
import type { PinnedFeedItem } from './types'

/** Where the tab stands. */
export type PinnedFeedStatus = 'loading' | 'ready' | 'error'

export interface UsePinnedFeedResult {
  readonly items: readonly PinnedFeedItem[]
  readonly status: PinnedFeedStatus
}

/** The post with `pinnedForAll` set or removed (a fresh object; the key is absent when false). */
function withPinnedForAll(post: ParticipantPostView, pinnedForAll: boolean): ParticipantPostView {
  if (pinnedForAll) return post.pinnedForAll === true ? post : { ...post, pinnedForAll: true }
  if (post.pinnedForAll !== true) return post
  const { pinnedForAll: _dropped, ...rest } = post
  return rest
}

/**
 * @param pinChanges The `PostPinChanged` source. Defaults to the app-wide `realtimeFeed`
 *   (the one shared connection); tests inject a fake.
 */
export function usePinnedFeed(pinChanges: PinChangeSource = realtimeFeed): UsePinnedFeedResult {
  const [items, setItems] = useState<readonly PinnedFeedItem[]>([])
  const [status, setStatus] = useState<PinnedFeedStatus>('loading')

  const aliveRef = useRef(true)
  const inFlightRef = useRef(false)
  const queuedRef = useRef(false)

  // One read at a time; a change that lands mid-read queues exactly one more pass.
  const load = useCallback(() => {
    if (inFlightRef.current) {
      queuedRef.current = true
      return
    }
    inFlightRef.current = true
    void (async () => {
      try {
        do {
          queuedRef.current = false
          try {
            const next = await resolvePinnedFeed()
            if (!aliveRef.current) return
            setItems(next)
            setStatus('ready')
          } catch {
            if (!aliveRef.current) return
            // Only a tab that never loaded shows the error; otherwise keep what is on screen.
            setStatus(prev => (prev === 'loading' ? 'error' : prev))
          }
        } while (queuedRef.current && aliveRef.current)
      } finally {
        inFlightRef.current = false
      }
    })()
  }, [])

  useEffect(() => {
    aliveRef.current = true
    load()
    const offEngagement = viewerEngagement.subscribe(() => load())
    const offPinChanged = pinChanges.subscribePinChanged(({ postId, pinnedForAll }) => {
      setItems(prev =>
        prev.some(item => item.post.id === postId)
          ? prev.map(item =>
            item.post.id === postId
              ? { ...item, post: withPinnedForAll(item.post, pinnedForAll) }
              : item)
          : prev,
      )
      load()
    })
    return () => {
      aliveRef.current = false
      queuedRef.current = false
      offEngagement()
      offPinChanged()
    }
  }, [load, pinChanges])

  return { items, status }
}
