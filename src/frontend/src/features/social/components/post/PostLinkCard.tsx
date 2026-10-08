/**
 * features/social/components/post/PostLinkCard.tsx
 * ---------------------------------------------------------------------------
 * The in-sim link-preview card of the decomposed `<PostCard>` (demo-polish F0).
 * `PostCard` already mounts it after the media slot; F2 owns this file + its CSS
 * module from here on (it can use the new `PostLinkPreview.imageUrl?` — a
 * CLIENT-TYPED field this push; the server never sends a link preview).
 *
 * F0 STATE: behaviour-preserving — a bordered card with the decorative image
 * label (`aria-hidden`), the title and the in-fiction domain
 * (`data-testid="post-link-preview"`). `domain` is an in-sim domain only, never
 * a real external URL. Renders nothing without a preview.
 *
 * Participant world — plain elements + `PostLinkCard.module.css`.
 */

import type { PostLinkPreview } from '../../types/post'
import styles from './PostLinkCard.module.css'

export interface PostLinkCardProps {
  readonly linkPreview?: PostLinkPreview
}

export function PostLinkCard({ linkPreview }: PostLinkCardProps) {
  if (linkPreview === undefined) return null

  return (
    <div className={styles.linkCard} data-testid="post-link-preview">
      <div className={styles.linkCardImage} aria-hidden="true">
        {linkPreview.imageLabel}
      </div>
      <div className={styles.linkCardBody}>
        <p className={styles.linkTitle}>{linkPreview.title}</p>
        <p className={styles.linkDomain}>{linkPreview.domain}</p>
      </div>
    </div>
  )
}
