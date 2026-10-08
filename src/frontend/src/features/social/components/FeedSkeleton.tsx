/**
 * features/social/components/FeedSkeleton.tsx
 * ---------------------------------------------------------------------------
 * The feed's LOADING state (demo-polish F5, story 14; F0 mounted the stub).
 * `pages/Feed.tsx` renders it in place of the old inline "Loading posts…"
 * paragraph while the first page of posts is in flight, so a participant sees
 * the SHAPE of the feed arriving rather than a line of text — it reads as a
 * finished consumer app, not a prototype (demo beat 1).
 *
 * WHAT IT RENDERS: {@link SKELETON_ROW_COUNT} (4, so well over the required 3)
 * post-shaped placeholder rows — an avatar circle, a name/handle line, body
 * lines, an action row — each laid out with the same box model as a real
 * `<PostCard>` (width, padding, gap, bottom rule) so the page does not jump when
 * the content replaces it. The soft shimmer is DECORATIVE: it is switched off
 * under `prefers-reduced-motion`, and the rows are `aria-hidden`.
 *
 * ACCESSIBILITY (NFR-001). The whole thing is ONE polite status region:
 * `role="status"` + `aria-busy="true"`, whose only accessible content is the
 * visually hidden text "Loading posts". Assistive tech therefore hears a calm,
 * in-fiction "Loading posts" and none of the placeholder boxes. There is no
 * exercise/admin language here, ever.
 *
 * `SkeletonPostRow` is also exported for `ProfileSkeleton`, which stacks a few
 * under the profile header. It is plain presentational markup (no role): only the
 * outer skeleton owns the status semantics.
 *
 * Self-contained styling: `FeedSkeleton.module.css` declares its own colours, so
 * this renders identically wherever the host mounts it (it does not depend on the
 * feed page's `--fd-*` tokens). Participant world — plain elements + a CSS
 * Module; no COBRA, no MUI.
 */

import styles from './FeedSkeleton.module.css'

/** How many post-shaped rows the feed skeleton shows (the AC floor is 3). */
export const SKELETON_ROW_COUNT = 4

/** One post-shaped placeholder: avatar, header line, body lines, action row. */
export function SkeletonPostRow() {
  return (
    <div className={styles.row} data-testid="skeleton-post-row" aria-hidden="true">
      <span className={`${styles.block} ${styles.avatar}`} />
      <div className={styles.content}>
        <div className={styles.header}>
          <span className={`${styles.block} ${styles.name}`} />
          <span className={`${styles.block} ${styles.handle}`} />
        </div>
        <span className={`${styles.block} ${styles.line}`} />
        <span className={`${styles.block} ${styles.line}`} />
        <span className={`${styles.block} ${styles.line} ${styles.lineShort}`} />
        <div className={styles.actions}>
          <span className={`${styles.block} ${styles.action}`} />
          <span className={`${styles.block} ${styles.action}`} />
          <span className={`${styles.block} ${styles.action}`} />
          <span className={`${styles.block} ${styles.action}`} />
        </div>
      </div>
    </div>
  )
}

export function FeedSkeleton() {
  return (
    <div
      className={styles.skeleton}
      role="status"
      aria-busy="true"
      data-testid="feed-skeleton"
    >
      <span className={styles.srOnly}>Loading posts</span>
      {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
        <SkeletonPostRow key={index} />
      ))}
    </div>
  )
}
