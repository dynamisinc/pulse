/**
 * features/social/components/ProfileSkeleton.tsx
 * ---------------------------------------------------------------------------
 * The profile page's LOADING state (demo-polish F5, story 14), shown by
 * `pages/Profile.tsx` while the persona cast is still resolving — in place of the
 * plain "Loading profile…" line.
 *
 * It sketches the page that is about to appear, in the same boxes: the banner
 * band (same 150px height), the avatar lockup overlapping it (same 80px circle in
 * its 4px ring, pulled up the same 42px), the name / handle / bio / counts lines,
 * a four-cell tab strip, and a couple of post-shaped rows (the shared
 * `SkeletonPostRow` from `FeedSkeleton`). Matching the real geometry is what keeps
 * the page from jumping when the profile arrives.
 *
 * ACCESSIBILITY (NFR-001). One polite status region — `role="status"` +
 * `aria-busy="true"` — whose only accessible content is the visually hidden text
 * "Loading profile". The placeholder shapes are `aria-hidden` and the shimmer is
 * decorative (removed under `prefers-reduced-motion`). No exercise/admin wording.
 *
 * Participant world: plain elements + a CSS Module (light only). No COBRA, no MUI.
 */

import { SkeletonPostRow } from './FeedSkeleton'
import styles from './ProfileSkeleton.module.css'

/** How many post-shaped rows sit under the profile header while it loads. */
const PROFILE_SKELETON_POSTS = 2

export function ProfileSkeleton() {
  return (
    <div
      className={styles.skeleton}
      role="status"
      aria-busy="true"
      data-testid="profile-skeleton"
    >
      <span className={styles.srOnly}>Loading profile</span>

      <div aria-hidden="true">
        <div className={`${styles.block} ${styles.banner}`} />

        <div className={styles.identity}>
          <span className={styles.avatarRing}>
            <span className={`${styles.block} ${styles.avatar}`} />
          </span>
          <span className={`${styles.block} ${styles.name}`} />
          <span className={`${styles.block} ${styles.handle}`} />
          <span className={`${styles.block} ${styles.bio}`} />
          <span className={`${styles.block} ${styles.bio} ${styles.bioShort}`} />
          <div className={styles.stats}>
            <span className={`${styles.block} ${styles.stat}`} />
            <span className={`${styles.block} ${styles.stat}`} />
          </div>
        </div>

        <div className={styles.tabs}>
          <span className={`${styles.block} ${styles.tab}`} />
          <span className={`${styles.block} ${styles.tab}`} />
          <span className={`${styles.block} ${styles.tab}`} />
          <span className={`${styles.block} ${styles.tab}`} />
        </div>

        {Array.from({ length: PROFILE_SKELETON_POSTS }, (_, index) => (
          <SkeletonPostRow key={index} />
        ))}
      </div>
    </div>
  )
}
