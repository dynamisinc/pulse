/**
 * features/social/components/post/PinnedMarker.tsx
 * ---------------------------------------------------------------------------
 * The "Pinned" line a post card shows ABOVE its author row when the post is pinned for
 * everyone (demo-feedback story 21; DF-7, DF-34, NFR-001), the way X heads a pinned post.
 * Every surface that renders a post through `<PostCard>` gets it: home feed (All and
 * Following), thread root and replies, profile tabs, the Pinned tab and hashtag results.
 * (Explore search rows are not post cards, so they show no marker.) `<PostCard>` decides
 * WHEN (the live exercise-pin state); this part only draws it.
 *
 *   <p .marker id={id} data-testid="pinned-for-all-label">
 *     <FontAwesomeIcon faThumbtack aria-hidden/>   decoration only
 *     <span>Pinned</span>                          the meaning (read by screen readers)
 *   </p>
 *
 * Never icon-only or colour-only: the WORD carries the meaning (NFR-001). Fiction-safe copy
 * - never "controller", "exercise control" or who pinned it. The test id is story 07's, kept
 * so the Pinned tab's tests keep finding the marker.
 *
 * A personal pin (`viewer.pinned`) never shows this (DF-6: private); it is the Pin action's
 * pressed state only.
 *
 * World: participant (Pulse skin). Plain elements + CSS Module reading the card's `--pc-*`
 * tokens + FontAwesome; no COBRA, no MUI.
 */

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faThumbtack } from '@fortawesome/free-solid-svg-icons'
import styles from './PinnedMarker.module.css'

/** The marker's visible (and spoken) word. */
export const PINNED_MARKER_TEXT = 'Pinned'

export interface PinnedMarkerProps {
  /** Element id, so the card's `<article>` can point `aria-describedby` at the line. */
  readonly id?: string
}

export function PinnedMarker({ id }: PinnedMarkerProps) {
  return (
    <p id={id} className={styles.marker} data-testid="pinned-for-all-label">
      <FontAwesomeIcon icon={faThumbtack} aria-hidden="true" className={styles.icon} />
      <span>{PINNED_MARKER_TEXT}</span>
    </p>
  )
}
