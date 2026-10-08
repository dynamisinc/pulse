/**
 * features/social/components/post/PostLinkCard.tsx
 * ---------------------------------------------------------------------------
 * The in-sim link-preview card of the decomposed `<PostCard>` (demo-polish F0
 * shell, F2 image). `PostCard` mounts it after the media slot. A bordered card:
 * the preview image (or, without one, the decorative image label), the title and
 * the in-fiction domain (`data-testid="post-link-preview"`). `domain` is an in-sim
 * domain only, never a real external URL. Renders nothing without a preview.
 *
 * THE IMAGE (F2): `linkPreview.imageUrl` is a CLIENT-TYPED member this push — the
 * server sends no link previews yet (feature.md "cut") — so this path is
 * MOCK-VERIFIED ONLY. When present it passes the same allow-list as every other
 * media `src` (`media/safeMediaUrl.ts`, NFR-004) and renders `loading="lazy"` in a
 * frame whose aspect ratio is reserved up front (no layout shift). A missing,
 * unsafe or failed image falls back to the label. The image is DECORATIVE
 * (`alt=""`): the title directly below carries the meaning, so a screen reader
 * does not hear it twice.
 *
 * Not interactive on purpose (no real link to follow): a tap anywhere on the card
 * opens the thread through the card's open-region overlay, so it needs no z-index
 * lift and no click handler.
 *
 * Participant world — plain elements + `PostLinkCard.module.css`.
 */

import { useState } from 'react'
import type { PostLinkPreview } from '../../types/post'
import { resolveSafeMediaUrl } from '../media/safeMediaUrl'
import styles from './PostLinkCard.module.css'

export interface PostLinkCardProps {
  readonly linkPreview?: PostLinkPreview
}

export function PostLinkCard({ linkPreview }: PostLinkCardProps) {
  const [imageFailed, setImageFailed] = useState(false)

  if (linkPreview === undefined) return null

  const imageSrc = resolveSafeMediaUrl(linkPreview.imageUrl)

  return (
    <div className={styles.linkCard} data-testid="post-link-preview">
      {imageSrc !== undefined && !imageFailed ? (
        <div className={styles.linkCardPhotoFrame}>
          <img
            className={styles.linkCardPhoto}
            src={imageSrc}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            data-testid="post-link-image"
            onError={() => setImageFailed(true)}
          />
        </div>
      ) : (
        <div className={styles.linkCardImage} aria-hidden="true">
          {linkPreview.imageLabel}
        </div>
      )}
      <div className={styles.linkCardBody}>
        <p className={styles.linkTitle}>{linkPreview.title}</p>
        <p className={styles.linkDomain}>{linkPreview.domain}</p>
      </div>
    </div>
  )
}
