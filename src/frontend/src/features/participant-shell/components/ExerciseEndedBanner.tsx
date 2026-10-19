/**
 * features/participant-shell/components/ExerciseEndedBanner.tsx
 * ---------------------------------------------------------------------------
 * The "this exercise has ended" band (exercise-ended read-only review). Hosted by
 * `ComplianceChrome`, directly under the top classification banner, and it renders even when the
 * chrome is switched off. `ComplianceChrome` measures its height and adds it to
 * `--pulse-chrome-top`, so the alert bar, pins and overlays shift down automatically.
 *
 * Out-of-fiction register (it speaks as the exercise, not the fiction): a FontAwesome icon PLUS
 * text, never colour alone; NOT a live region itself (ComplianceChrome keeps an always-mounted,
 * initially empty live region and fills it on the flip, so the announcement is reliable and not
 * doubled); NO dismiss control (it must stay while the exercise is ended); no time of any kind
 * (scenario or wall-clock). Text wraps on narrow screens.
 *
 * World: participant. Plain React + a CSS module; no COBRA, no MUI.
 */

import type { CSSProperties, Ref } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFlagCheckered } from '@fortawesome/free-solid-svg-icons'
import { SHELL_Z } from '../mountContract'
import styles from './ExerciseEndedBanner.module.css'

/** The exact banner copy. */
export const EXERCISE_ENDED_BANNER_TEXT =
  'This exercise has ended. You can still read posts, but nothing new can be posted.'

export interface ExerciseEndedBannerProps {
  /** CSS length the band sits at (the bottom edge of the top classification banner, or 0). */
  readonly top: string
  /** Pad by the top safe-area inset (only when no top classification banner already does). */
  readonly safeAreaTop: boolean
  readonly ref?: Ref<HTMLDivElement>
}

export function ExerciseEndedBanner({ top, safeAreaTop, ref }: ExerciseEndedBannerProps) {
  const style: CSSProperties = { top, zIndex: SHELL_Z.chrome }
  return (
    <div
      ref={ref}
      data-testid="pulse-exercise-ended-banner"
      className={safeAreaTop ? `${styles.banner} ${styles.safeTop}` : styles.banner}
      style={style}
    >
      <FontAwesomeIcon icon={faFlagCheckered} className={styles.icon} aria-hidden="true" />
      <span className={styles.text}>{EXERCISE_ENDED_BANNER_TEXT}</span>
    </div>
  )
}
