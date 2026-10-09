/**
 * features/social/components/media/MediaTabGrid.tsx
 * ---------------------------------------------------------------------------
 * The profile "Media" tab grid (demo-polish F2 content; F0 created the stub and
 * the prop contract, F5 mounts it in `pages/Profile.tsx`'s Media tab). A 3-column
 * grid of SQUARE thumbnails, one per media-bearing post, in the order given:
 *
 *   - an image post shows its first photo (cropped square, `object-fit: cover`);
 *   - a video post shows its POSTER with a play badge — or, with no poster, a muted
 *     first-frame `<video preload="metadata">` (`#t=0.1`), or the alt-text
 *     placeholder when even the URL is unusable;
 *   - activating a tile calls `onOpenPost(postId)` — thread navigation is the
 *     caller's job; this component never routes.
 *
 * ACCESSIBILITY (NFR-001): each tile is a real `<button>` whose accessible name is
 * the media item's ALT text; a video tile adds a visually-hidden "Video" description
 * and a play-icon badge, so the kind is never colour-only or sight-only. With no
 * `onOpenPost` the tiles render as inert `role="img"` boxes — never a focusable
 * no-op (WR-002). Renders NOTHING when no post has media.
 *
 * SAFE URLs (NFR-004): every `src` passes `safeMediaUrl`'s allow-list. Treats the
 * `url`s as opaque (XC-009) and shows no timestamps (COR-053 is not in play).
 *
 * Participant world — CSS Module (composes the shared `.tokens`, because the tab
 * lives outside a `<PostCard>`), FontAwesome icons, no COBRA, no MUI.
 */

import { useId } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlay } from '@fortawesome/free-solid-svg-icons'
import type { PostMedia } from '../../types/post'
import type { PostView } from '../post'
import { MediaFallbackTile } from './MediaFallbackTile'
import { mediaAlt } from './mediaLayout'
import { resolveSafeMediaUrl, withFirstFrameHint } from './safeMediaUrl'
import styles from './MediaTabGrid.module.css'

export interface MediaTabGridProps {
  /** The account's posts that carry media, in display order. */
  readonly posts: readonly PostView[]
  /** Fires with the POST id when a thumbnail is activated. */
  readonly onOpenPost?: (postId: string) => void
}

/** The visible face of one tile: the photo, the poster, a first frame, or the placeholder. */
function Thumbnail({ item, alt }: { readonly item: PostMedia, readonly alt: string }) {
  if (item.kind === 'video') {
    const poster = resolveSafeMediaUrl(item.posterUrl)
    if (poster !== undefined) {
      return <img className={styles.thumb} src={poster} alt={alt} loading="lazy" decoding="async" />
    }
    const src = resolveSafeMediaUrl(item.url)
    if (src !== undefined) {
      return (
        <video
          className={styles.thumb}
          src={withFirstFrameHint(src)}
          muted
          playsInline
          preload="metadata"
          tabIndex={-1}
          aria-hidden="true"
        />
      )
    }
    return <MediaFallbackTile alt={alt} kind="video" />
  }

  const src = resolveSafeMediaUrl(item.url)
  if (src === undefined) return <MediaFallbackTile alt={alt} />
  return <img className={styles.thumb} src={src} alt={alt} loading="lazy" decoding="async" />
}

interface MediaTabTileProps {
  readonly postId: string
  readonly item: PostMedia
  readonly onOpenPost?: (postId: string) => void
}

function MediaTabTile({ postId, item, onOpenPost }: MediaTabTileProps) {
  const hintId = useId()
  const alt = mediaAlt(item)
  const isVideo = item.kind === 'video'

  const face = (
    <>
      <Thumbnail item={item} alt={alt} />
      {isVideo && (
        <span className={styles.playBadge} data-testid="media-tab-play-badge" aria-hidden="true">
          <FontAwesomeIcon icon={faPlay} />
        </span>
      )}
    </>
  )

  if (onOpenPost === undefined) {
    return (
      <div className={styles.tile} role="img" aria-label={alt}>
        {face}
      </div>
    )
  }

  return (
    <button
      type="button"
      className={`${styles.tile} ${styles.tileButton}`}
      aria-label={alt}
      aria-describedby={isVideo ? hintId : undefined}
      data-testid="media-tab-tile"
      data-post-id={postId}
      onClick={() => onOpenPost(postId)}
    >
      {face}
      {isVideo && <span id={hintId} className={styles.srOnly}>Video</span>}
    </button>
  )
}

export function MediaTabGrid({ posts, onOpenPost }: MediaTabGridProps) {
  const tiles = posts.flatMap(post => {
    const item = post.media?.[0]
    return item === undefined ? [] : [{ postId: post.id, item }]
  })
  if (tiles.length === 0) return null

  return (
    <ul className={styles.grid} role="list" aria-label="Media" data-testid="media-tab-grid">
      {tiles.map(({ postId, item }) => (
        <li key={postId} className={styles.cell}>
          <MediaTabTile postId={postId} item={item} onOpenPost={onOpenPost} />
        </li>
      ))}
    </ul>
  )
}
