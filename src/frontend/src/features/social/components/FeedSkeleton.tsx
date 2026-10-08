/**
 * features/social/components/FeedSkeleton.tsx
 * ---------------------------------------------------------------------------
 * The feed's LOADING state (demo-polish F0 STUB). `pages/Feed.tsx` already mounts
 * it in place of the old inline "Loading posts…" paragraph, so F5 (brand &
 * profile finish) owns only this file + its CSS module and never has to edit the
 * feed page (implementation.md §4.3: `Feed.tsx` belongs to F4 in Wave 2).
 *
 * F0 STATE: behaviour-preserving. It renders exactly what the feed rendered
 * before — a calm, in-fiction polite status line (`role="status"`, "Loading
 * posts…", no exercise/admin language). F5 replaces the body with skeleton post
 * rows; whatever it renders MUST keep a `role="status"` text alternative so
 * assistive tech still announces that content is loading (NFR-001).
 *
 * Participant world — a plain element + a CSS Module; no COBRA, no MUI.
 */

import styles from './FeedSkeleton.module.css'

export function FeedSkeleton() {
  return (
    <p className={styles.state} role="status">
      Loading posts…
    </p>
  )
}
