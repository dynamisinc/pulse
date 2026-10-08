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
 *   - A PERSISTENT, visually hidden `aria-live="polite"` region stays mounted even at
 *     count 0 (empty). A polite region must exist in the DOM *before* its content
 *     changes for a screen reader to reliably announce the change, so it is
 *     intentionally always rendered; only the visible pill toggles. AT is notified of
 *     "N new posts" WITHOUT focus being hijacked (polite, never assertive; the
 *     reader's place is never stolen).
 *   - The count is conveyed as TEXT ("N new posts"), never by color/icon alone.
 *
 * THE SPOKEN LABEL IS THROTTLED; THE VISIBLE COUNT IS NOT (Wave 2 Gate-2 low). The
 * live region used to wrap the pill itself, so at 120 posts/min every arrival changed
 * the announced text and a screen reader queued "37 new posts ... 38 new posts ..." for
 * as long as the burst lasted -- the stress is the training, but a stuck announcement
 * queue is not. Now the visible button carries the live count (it re-renders on every
 * change, and reading it on focus gives the current number) but sits OUTSIDE the live
 * region; the region holds a separate copy of the label that is updated at most once
 * per {@link SPOKEN_THROTTLE_MS}: the FIRST arrival is announced at once, further
 * changes inside the window are held and the LATEST label is spoken when it ends
 * (never a stale intermediate one), and a count back at 0 clears the region at once.
 *
 * BURST LEGIBILITY (NFR-002/SOC-071). The visible number is capped at `99+` so
 * a 120-posts/min storm never renders an illegibly long count. This is display
 * only — `useFeedStream` already bounds the underlying buffer.
 */

import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowUp } from '@fortawesome/free-solid-svg-icons'
import styles from './NewPostsPill.module.css'

/** Above this the pill shows `99+` rather than an illegibly long number (NFR-002). */
const DISPLAY_CAP = 99

/**
 * The least time between two SPOKEN updates of the label (see the module header). A UI
 * timer only -- it reads no clock and renders no time.
 */
export const SPOKEN_THROTTLE_MS = 3000

/**
 * The label to ANNOUNCE for `label` (`''` = nothing to say): leading + trailing throttle
 * with a cooldown timer. Speaks the first non-empty label at once, then holds later
 * changes for {@link SPOKEN_THROTTLE_MS} and speaks the latest one when the cooldown
 * ends (and only if it differs from what was last spoken). `''` clears at once.
 */
function useThrottledSpokenLabel(label: string): string {
  const [spoken, setSpoken] = useState('')
  const latestRef = useRef('')
  const spokenRef = useRef('')
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    latestRef.current = label

    const speak = (text: string) => {
      spokenRef.current = text
      setSpoken(text)
      cooldownRef.current = setTimeout(() => {
        cooldownRef.current = undefined
        const latest = latestRef.current
        if (latest !== '' && latest !== spokenRef.current) speak(latest)
      }, SPOKEN_THROTTLE_MS)
    }

    if (label === '') {
      // Nothing buffered any more: clear at once (a clear is not announced) and let the
      // next burst start with a fresh, immediate announcement.
      if (cooldownRef.current !== undefined) clearTimeout(cooldownRef.current)
      cooldownRef.current = undefined
      spokenRef.current = ''
      setSpoken('')
      return
    }
    // Inside the cooldown: the timer above will speak the latest label when it ends.
    if (cooldownRef.current !== undefined) return
    speak(label)
  }, [label])

  // Unmount (and StrictMode's simulated one): drop the timer AND the "cooling down" mark,
  // or a re-run of the effect above would wait on a timer that no longer exists.
  useEffect(
    () => () => {
      if (cooldownRef.current !== undefined) clearTimeout(cooldownRef.current)
      cooldownRef.current = undefined
    },
    [],
  )

  return spoken
}

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
  const spokenLabel = useThrottledSpokenLabel(hasNew ? label : '')

  return (
    <div className={styles.liveRegion}>
      {/* The persistent polite region: always mounted, throttled text, visually hidden. */}
      <span className={styles.srOnly} aria-live="polite" aria-atomic="true">
        {spokenLabel}
      </span>
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
