/**
 * features/social/components/NewPostsPill.tsx
 * ---------------------------------------------------------------------------
 * The sticky "▲ N new posts" pill (feature: feeds-discovery, story 04;
 * SOC-083, NFR-001/002, SOC-071, D1-005/011). Participant world (Pulse Social
 * skin): a scoped CSS Module + FontAwesome only — NO COBRA, NO themed MUI, NO
 * `@mui/icons-material`.
 *
 * PRESENTATIONAL. It renders the buffered-post count and calls `onLoad` when
 * tapped; it owns no buffer and no transport. `useFeedStream()` owns the count;
 * `<Feed>` owns what a tap DOES (drain, prepend, scroll-to-top).
 *
 * A11Y (NFR-001).
 *   - The pill is a REAL `<button>` — keyboard- and AT-operable natively
 *     (Enter/Space/click), no custom key handling, no `role` hacks.
 *   - It lives inside a PERSISTENT `aria-live="polite"` region that stays
 *     mounted even at count 0 (empty). A polite region must exist in the DOM
 *     *before* its content changes for a screen reader to reliably announce the
 *     change, so the wrapper is intentionally always rendered; only the visible
 *     pill toggles. AT is notified of "N new posts" WITHOUT focus being hijacked
 *     (polite, never assertive; the reader's place is never stolen).
 *   - The count is conveyed as TEXT ("N new posts"), never by color/icon alone.
 *
 * BURST LEGIBILITY (NFR-002/SOC-071). The visible number is capped at `99+` so
 * a 120-posts/min storm never renders an illegibly long count. This is display
 * only — `useFeedStream` already bounds the underlying buffer.
 */

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowUp } from '@fortawesome/free-solid-svg-icons'
import styles from './NewPostsPill.module.css'

/** Above this the pill shows `99+` rather than an illegibly long number (NFR-002). */
const DISPLAY_CAP = 99

export interface NewPostsPillProps {
  /** Buffered-post count from `useFeedStream()`. At 0 the pill is not shown. */
  readonly count: number
  /** Called when the reader taps/activates the pill to load the buffered posts. */
  readonly onLoad: () => void
}

/**
 * Renders the sticky "new posts" pill inside a persistent polite live region.
 * See the module header for the a11y contract behind the always-mounted
 * wrapper.
 */
export function NewPostsPill({ count, onLoad }: NewPostsPillProps) {
  const hasNew = count > 0
  const displayCount = count > DISPLAY_CAP ? `${DISPLAY_CAP}+` : String(count)
  const label = `${displayCount} new ${count === 1 ? 'post' : 'posts'}`

  return (
    <div className={styles.liveRegion} aria-live="polite">
      {hasNew && (
        <button
          type="button"
          className={styles.pill}
          onClick={onLoad}
          data-testid="new-posts-pill"
        >
          <FontAwesomeIcon icon={faArrowUp} aria-hidden="true" className={styles.icon} />
          {label}
        </button>
      )}
    </div>
  )
}
