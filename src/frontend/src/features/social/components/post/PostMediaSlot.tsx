/**
 * features/social/components/post/PostMediaSlot.tsx
 * ---------------------------------------------------------------------------
 * The media slot of the decomposed `<PostCard>` (demo-polish F2 — media display;
 * SOC-001, NFR-001, NFR-004, NFR-008). `PostCard` mounts this between the text and
 * the link card (it is FROZEN — F2 only ever owned this file, its CSS and the
 * `media/*` components it renders). It turns the contract's `PostMedia[]` into:
 *
 *   images  ->  `MediaGrid` (1/2/3/4 X-style layouts; each photo opens the viewer)
 *   video   ->  `VideoPlayer` (plays INLINE; native fullscreen, modal fallback)
 *   viewer  ->  `MediaViewer` lightbox (focus-trapped; ←/→ across the images)
 *
 * and owns the one piece of state they share: which item the viewer shows and
 * which element to return focus to. Render nothing when there is no media.
 *
 * CONTRACT (what the slot gets): `postId` and `media` ONLY. `url`s are opaque read
 * URLs: every one passes the allow-list in `media/safeMediaUrl.ts` before it
 * reaches a `src`; a legacy `{ kind: 'image', alt }` entry (no `url`) or an unsafe
 * URL renders the accessible alt-text placeholder (NFR-004). The slot never builds
 * a URL (XC-009). A post carries <=4 images OR exactly 1 video; a mixed post still
 * renders (grid first, then each video) rather than failing.
 *
 * STACKING (the card's open-the-thread overlay): the card body is covered by a
 * transparent `z-index: 1` button, so interactive media must sit ABOVE it exactly
 * as the hashtag anchors do. `.media` is `position: relative; z-index: 2`, with
 * `pointer-events: none` so the non-interactive bits (a dead-image placeholder)
 * still fall through to the overlay, and each interactive tile/player re-enables
 * pointer events and stops click propagation (so a tap never also opens the thread).
 *
 * Participant world — plain elements + CSS Modules. No COBRA, no MUI.
 */

import { useState } from 'react'
import type { PostMedia } from '../../types/post'
import { MAX_GRID_IMAGES } from '../media/mediaLayout'
import { MediaGrid } from '../media/MediaGrid'
import { MediaViewer } from '../media/MediaViewer'
import { resolveSafeMediaUrl } from '../media/safeMediaUrl'
import { VideoPlayer } from '../media/VideoPlayer'
import styles from './PostMediaSlot.module.css'

export interface PostMediaSlotProps {
  /** The owning post's id (stable key prefix). */
  readonly postId: string
  readonly media?: readonly PostMedia[]
}

/** What the open viewer shows, and where focus returns when it closes. */
interface ViewerState {
  readonly items: readonly PostMedia[]
  readonly index: number
  readonly trigger: HTMLElement | null
  /** Resume position for a video handed over from the inline player (seconds). */
  readonly startAt?: number
}

export function PostMediaSlot({ postId, media }: PostMediaSlotProps) {
  const [viewer, setViewer] = useState<ViewerState | null>(null)

  if (media === undefined || media.length === 0) return null

  const videos = media.filter(item => item.kind === 'video')
  const images = media.filter(item => item.kind !== 'video').slice(0, MAX_GRID_IMAGES)
  // Only images with a renderable URL can be paged through in the viewer.
  const openable = images.filter(item => resolveSafeMediaUrl(item.url) !== undefined)

  return (
    <div className={styles.media} data-testid="post-media">
      {images.length > 0 && (
        <MediaGrid
          media={images}
          onOpen={(item, trigger) => {
            const index = openable.indexOf(item)
            if (index >= 0) setViewer({ items: openable, index, trigger })
          }}
        />
      )}
      {videos.map((video, index) => (
        <VideoPlayer
          key={`${postId}-video-${video.id}-${index}`}
          media={video}
          onRequestModal={(trigger, startAt) =>
            setViewer({ items: [video], index: 0, trigger, startAt })}
        />
      ))}
      {viewer !== null && (
        <MediaViewer
          items={viewer.items}
          startIndex={viewer.index}
          returnFocusTo={viewer.trigger}
          startAt={viewer.startAt}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  )
}
