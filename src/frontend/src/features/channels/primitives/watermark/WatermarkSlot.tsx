/**
 * features/channels/primitives/watermark/WatermarkSlot.tsx
 * ---------------------------------------------------------------------------
 * The "EXERCISE" chip slot on high-risk imagery (channels-foundation 14; NFR-008,
 * D3-P1 slot 7, FC-9 rule 8). A channel mounts one inside the POSITIONED box of a hero
 * image, a radar / cone image or a warning product:
 *
 *   +------------------------------+
 *   |                              |
 *   |          (the media)         |
 *   |                  [EXERCISE]  |  <- bottom-right chip
 *   +------------------------------+
 *
 *  - WHEN: shown when `isWatermarkRequired(useChromeConfig())` (`watermark || !enabled`:
 *    chrome and watermark are never both off), or when `force` is set. Outside the shell's
 *    providers the config cannot be read, so it shows: fail toward marking.
 *  - NO LAYOUT SHIFT: the chip is ALWAYS in the DOM. When not required it is
 *    `visibility: hidden`, so its box stays reserved and toggling the exercise switch moves
 *    nothing. It is also absolutely positioned, so it never pushes the media.
 *  - `clearVideoControls` lifts it above a video's control row, so it never covers
 *    the native timeline or the player's buttons.
 *  - `aria-hidden` (the compliance chrome and the alt text carry the meaning) and
 *    `pointer-events: none` (every control under it keeps working).
 *  - CONTRAST: fixed white on near-black (`#ffffff` on `#111418`, about 18:1). Skin tokens
 *    cannot address it (the FC-3b CANNOT list), so an outlet can never make it illegible.
 *
 * Participant world: CSS Module, no COBRA, no MUI.
 */

import {
  isWatermarkRequired,
  useChromeConfig,
  useChromeConfigAvailable,
} from '@/features/participant-shell/chromeConfig'
import styles from './WatermarkSlot.module.css'

/** The chip's text. Fixed copy; skins cannot change it. */
export const WATERMARK_TEXT = 'EXERCISE'

export interface WatermarkSlotProps {
  /** Show the chip whatever the exercise config says (e.g. a fullscreen hero). */
  readonly force?: boolean
  /** Sit above a video's control row instead of the bottom edge. */
  readonly clearVideoControls?: boolean
}

interface ChipProps {
  readonly shown: boolean
  readonly clearVideoControls: boolean
}

function Chip({ shown, clearVideoControls }: ChipProps) {
  return (
    <span
      className={[
        styles.slot,
        clearVideoControls ? styles.clearControls : '',
        shown ? '' : styles.reserved,
      ].filter(Boolean).join(' ')}
      aria-hidden="true"
      data-testid="watermark-slot"
      data-watermark-shown={shown ? 'true' : 'false'}
    >
      <span className={styles.chip}>{WATERMARK_TEXT}</span>
    </span>
  )
}

function ConfigDrivenChip({ force, clearVideoControls }: Required<WatermarkSlotProps>) {
  const required = isWatermarkRequired(useChromeConfig())
  return <Chip shown={required || force} clearVideoControls={clearVideoControls} />
}

export function WatermarkSlot({ force = false, clearVideoControls = false }: WatermarkSlotProps) {
  // Outside the participant shell's providers the config cannot be read: fail toward marking.
  if (!useChromeConfigAvailable()) return <Chip shown clearVideoControls={clearVideoControls} />
  return <ConfigDrivenChip force={force} clearVideoControls={clearVideoControls} />
}
