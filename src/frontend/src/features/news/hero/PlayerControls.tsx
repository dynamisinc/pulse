/**
 * features/news/hero/PlayerControls.tsx
 * ---------------------------------------------------------------------------
 * The broadcast player's control row (news story 05; NWS-014, NFR-001). Drawn by the
 * shared `VideoPlayer` through its `renderControls` hook, so it sits INSIDE the wrapper
 * that goes fullscreen.
 *
 *   [play] [----o---------] 0:12 / 1:30 [mute] [CC] [full screen]
 *
 *  - A labelled control group ("Video controls"): play/pause, scrub, elapsed / total,
 *    mute, captions (ONLY when the video exposes a captions track), fullscreen.
 *  - TINT: the row's background is `--pulse-skin-player-tint` and its ink is
 *    `--pulse-skin-on-player-tint` (F13 picks black or white, always >= 4.5:1 on the
 *    tint). The row is OPAQUE, so chrome-over-poster contrast never depends on the
 *    footage (the >= 3:1 floor, NFR-001). No other token reaches the player.
 *  - NOT COLOUR-ONLY: Play / Pause swaps its NAME and icon (a pressed "Play" would read
 *    as the opposite of the state); Mute and Captions keep a stable name + `aria-pressed`.
 *  - SCRUB: while the thumb is dragged it shows the drag position, so `timeupdate`s from
 *    the playing video never pull it back mid-drag.
 *  - 44px targets on a coarse pointer (CSS). One row, so the EXERCISE chip and bands
 *    above it are never covered.
 *
 * Presentational: state and actions come from the player (`PlayerControlsApi`).
 * Participant world: CSS Module + FontAwesome, no COBRA, no MUI.
 */

import { useState } from 'react'
import type { CSSProperties, ChangeEvent, PointerEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faClosedCaptioning,
  faCompress,
  faExpand,
  faPause,
  faPlay,
  faVolumeHigh,
  faVolumeXmark,
} from '@fortawesome/free-solid-svg-icons'
import { formatDuration } from '@/core/media/player'
import type { PlayerControlsApi } from '@/core/media/player'
import styles from './PlayerControls.module.css'

export interface PlayerControlsProps {
  readonly api: PlayerControlsApi
}

/** The keys a range input handles itself. */
const SLIDER_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown',
])

/** Accessible name of the control group. */
export const PLAYER_CONTROLS_LABEL = 'Video controls'

export function PlayerControls({ api }: PlayerControlsProps) {
  const { duration } = api
  const max = duration !== undefined && duration > 0 ? duration : 0
  // The drag position while a pointer holds the thumb; `null` otherwise.
  const [dragValue, setDragValue] = useState<number | null>(null)
  const shownTime = dragValue ?? api.currentTime
  const value = Math.min(shownTime, max)
  const elapsed = formatDuration(shownTime)
  const total = duration !== undefined ? formatDuration(duration) : '--:--'

  const handleScrub = (event: ChangeEvent<HTMLInputElement>) => {
    const seconds = Number(event.currentTarget.value)
    if (dragValue !== null) setDragValue(seconds)
    api.seekTo(seconds)
  }
  const endDrag = () => setDragValue(null)
  const startDrag = (event: PointerEvent<HTMLInputElement>) => {
    // Primary button only (a right-click's context menu would swallow the pointerup).
    if (event.button !== 0) return
    // Capture, so a release OUTSIDE the slider still ends the drag (lostpointercapture).
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // No capture support (or the pointer is already gone): pointerup / blur still end it.
    }
    setDragValue(api.currentTime)
  }
  // The played fraction; the CSS offsets it by half a thumb so fill and thumb line up.
  const scrubStyle = {
    '--news-scrub-fill': String(max > 0 ? value / max : 0),
  } as CSSProperties

  return (
    <div
      className={styles.row}
      role="group"
      aria-label={PLAYER_CONTROLS_LABEL}
      data-testid="broadcast-controls"
    >
      <button
        type="button"
        className={styles.button}
        aria-label={api.playing ? 'Pause' : 'Play'}
        data-testid="broadcast-play"
        onClick={api.togglePlay}
      >
        <FontAwesomeIcon icon={api.playing ? faPause : faPlay} aria-hidden="true" />
      </button>

      <input
        type="range"
        className={styles.scrub}
        style={scrubStyle}
        min={0}
        max={max}
        step="any"
        value={value}
        disabled={max === 0}
        aria-label="Seek"
        aria-valuetext={`${elapsed} of ${total}`}
        data-testid="broadcast-scrub"
        onChange={handleScrub}
        onPointerDown={startDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onBlur={endDrag}
        // A slider key always steps from the video's own time (modifiers do not end a drag).
        onKeyDown={event => {
          if (SLIDER_KEYS.has(event.key)) endDrag()
        }}
      />

      <span className={styles.time} data-testid="broadcast-time">
        <span>{elapsed}</span>
        <span className={styles.total}>
          <span aria-hidden="true"> / </span>
          <span className={styles.srOnly}> of </span>
          <span>{total}</span>
        </span>
      </span>

      <button
        type="button"
        className={styles.button}
        aria-label="Mute"
        aria-pressed={api.muted}
        data-testid="broadcast-mute"
        onClick={api.toggleMute}
      >
        <FontAwesomeIcon icon={api.muted ? faVolumeXmark : faVolumeHigh} aria-hidden="true" />
      </button>

      {api.captionsAvailable && (
        <button
          type="button"
          className={styles.button}
          aria-label="Captions"
          aria-pressed={api.captionsOn}
          data-testid="broadcast-captions"
          onClick={api.toggleCaptions}
        >
          <FontAwesomeIcon icon={faClosedCaptioning} aria-hidden="true" />
          {/* Not colour-only: "off" also draws a strike-through bar. */}
          {!api.captionsOn && <span className={styles.strike} aria-hidden="true" />}
        </button>
      )}

      <button
        type="button"
        className={styles.button}
        aria-label={api.fullscreen ? 'Exit full screen' : 'Full screen'}
        data-testid="broadcast-fullscreen"
        onClick={api.toggleFullscreen}
      >
        <FontAwesomeIcon icon={api.fullscreen ? faCompress : faExpand} aria-hidden="true" />
      </button>
    </div>
  )
}
