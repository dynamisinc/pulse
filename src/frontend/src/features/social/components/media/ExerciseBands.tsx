/**
 * features/social/components/media/ExerciseBands.tsx
 * ---------------------------------------------------------------------------
 * The EXERCISE media marking (demo-feedback 06, issue #502; NFR-008, DF-3, DF-4).
 * The customer's ask: "EVERYTHING must be watermarked — a still marking on top and
 * bottom of video". One shared overlay draws two bands over its media box:
 *
 *   +--------------------------------------+
 *   |      EXERCISE EXERCISE EXERCISE      |  <- top band (semi-opaque dark strip)
 *   |                                      |
 *   |             (the media)              |
 *   |                                      |
 *   |      EXERCISE EXERCISE EXERCISE      |  <- bottom band
 *   +--------------------------------------+
 *
 * WHEN: whenever `isWatermarkRequired(useChromeConfig())` — the exercise's
 * `watermark` switch is on, OR the compliance chrome is off (DF-3:
 * `watermark || !enabled`). `force` draws them regardless; the video player passes
 * its fullscreen state, because fullscreen hides the compliance banners and the
 * media must never be on screen with no exercise signal at all. When not required
 * this renders NOTHING (`null`), and because the overlay is absolutely positioned it
 * never took any layout space either — toggling it shifts nothing. Rendered outside the
 * participant shell's providers (no query client / exercise scope, so no config to
 * read) it draws the bands: fail toward marking, never toward bare media.
 *
 * WHERE: every participant media surface mounts one inside the media's POSITIONED
 * box (it fills `inset: 0` of its nearest positioned ancestor): the feed/thread
 * image tiles (`MediaGrid`), the inline and expanded `VideoPlayer` (inside the
 * wrapper that is fullscreened, so it stays on screen in fullscreen), the
 * `MediaViewer` image, the profile Media tab (`MediaTabGrid`) and the composer's
 * attachment previews (`ComposerMedia`). Alt-text placeholders (no media shown) do
 * not get bands.
 *
 * LOOK (`ExerciseBands.module.css`): the participant skin tokens — `--pc-bg` text on
 * a `--pc-ink` strip at 66% opacity, which is >= 4.5:1 over ANY media (the worst case,
 * pure white underneath, is pinned by `ExerciseBands.test.tsx`). The text scales with
 * the box via container query units: readable on a 2-up grid tile, capped so it is not
 * dominant on a full-screen video.
 *
 * A11Y: `aria-hidden` — the media's alt text and the compliance banner already carry
 * the meaning, and a screen reader hearing "EXERCISE EXERCISE EXERCISE" twice per
 * picture would bury the feed. `pointer-events: none` — every control under or over
 * the bands (tile buttons, the player's Mute / Expand / Play, native video controls)
 * keeps working.
 *
 * Participant world — CSS Module, no COBRA, no MUI.
 */

import {
  isWatermarkRequired,
  useChromeConfig,
  useChromeConfigAvailable,
} from '@/features/participant-shell/chromeConfig'
import { EXERCISE_BAND_TEXT } from './mediaCopy'
import styles from './ExerciseBands.module.css'

export interface ExerciseBandsProps {
  /**
   * Draw the bands even when the exercise does not require them. The video player
   * passes `true` while it is fullscreen (the compliance banners are hidden then).
   */
  readonly force?: boolean
  /**
   * Lift the bottom band clear of the browser's native `<video>` control bar, so the
   * timeline and time read stay legible (the band is click-through either way).
   */
  readonly clearNativeControls?: boolean
}

/** The two bands themselves (always drawn; the callers decide whether). */
function Bands({ clearNativeControls }: { readonly clearNativeControls: boolean }) {
  return (
    <div
      className={`${styles.bands} ${clearNativeControls ? styles.clearControls : ''}`}
      aria-hidden="true"
      data-testid="exercise-bands"
      data-clear-native-controls={clearNativeControls ? 'true' : undefined}
    >
      <div className={styles.band} data-testid="exercise-band-top">
        <span className={styles.text}>{EXERCISE_BAND_TEXT}</span>
      </div>
      <div className={styles.band} data-testid="exercise-band-bottom">
        <span className={styles.text}>{EXERCISE_BAND_TEXT}</span>
      </div>
    </div>
  )
}

/** Reads the exercise's chrome config (only mounted where the shell's providers are). */
function ConfigDrivenBands({ force, clearNativeControls }: Required<ExerciseBandsProps>) {
  const required = isWatermarkRequired(useChromeConfig())
  if (!required && !force) return null
  return <Bands clearNativeControls={clearNativeControls} />
}

export function ExerciseBands({ force = false, clearNativeControls = false }: ExerciseBandsProps) {
  // Outside the participant shell's providers (a media component rendered on its own) the
  // config cannot be read: fail toward marking, never toward bare media.
  if (!useChromeConfigAvailable()) return <Bands clearNativeControls={clearNativeControls} />
  return <ConfigDrivenBands force={force} clearNativeControls={clearNativeControls} />
}
