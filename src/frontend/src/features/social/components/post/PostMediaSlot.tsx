/**
 * features/social/components/post/PostMediaSlot.tsx
 * ---------------------------------------------------------------------------
 * The media slot of the decomposed `<PostCard>` (demo-polish F0). `PostCard`
 * ALREADY MOUNTS THIS between the text and the link card, so F2 (media display)
 * owns only this file + its CSS module + the `media/*` components it renders —
 * it never needs to touch the frozen `PostCard`.
 *
 * F0 STATE: behaviour-preserving. It renders exactly what the pre-split card
 * rendered — an accessible placeholder box per attachment (`role="img"`, the
 * attachment's `alt` as its name and visible text) inside
 * `data-testid="post-media"` — even though the contract-v2 `PostMedia` now also
 * carries `url`, `kind`, `posterUrl`, size and duration. F2 replaces the body
 * with the real image grid / video player / viewer.
 *
 * CONTRACT (what F2 receives): `media` is the post's v2 `PostMedia[]` (id, kind
 * image|video, url, REQUIRED alt, optional posterUrl/width/height/durationSec).
 * Treat `url`s as opaque read URLs; never build one (XC-009). Render nothing
 * when there is no media.
 *
 * Participant world — plain elements + `PostMediaSlot.module.css`.
 */

import type { PostMedia } from '../../types/post'
import styles from './PostMediaSlot.module.css'

export interface PostMediaSlotProps {
  /** The owning post's id (stable key prefix). */
  readonly postId: string
  readonly media?: readonly PostMedia[]
}

export function PostMediaSlot({ postId, media }: PostMediaSlotProps) {
  if (media === undefined || media.length === 0) return null

  return (
    <div className={styles.media} data-testid="post-media">
      {media.map((item, index) => (
        <div
          key={`${postId}-media-${item.id}-${index}`}
          className={styles.mediaPlaceholder}
          role="img"
          aria-label={item.alt}
        >
          {item.alt}
        </div>
      ))}
    </div>
  )
}
