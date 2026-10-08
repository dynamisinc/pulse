/**
 * features/social/components/media/VideoPlayer.tsx
 * ---------------------------------------------------------------------------
 * The inline video player (demo-polish F2 — the demo's headline feature;
 * SOC-001, NFR-001, NFR-004, NFR-008, COR-053). A news video plays RIGHT IN the
 * post, with the platform's own controls, and expands full-screen.
 *
 *   <div role="group" aria-label={alt} tabindex=0>      the focusable wrapper
 *     <video controls playsInline preload="metadata" poster>   native controls
 *     top row: duration badge · EXERCISE watermark slot · Mute · Expand
 *     centre: Play / Pause
 *   </div>
 *
 * BEHAVIOUR (the ACs)
 *  - NEVER autoplays. `preload="metadata"` only; with a poster the poster is
 *    shown, with none the URL gets `#t=0.1` so Safari paints a first frame.
 *  - ONE video at a time: a `play` event claims playback in
 *    `playbackCoordinator`, which pauses whichever player held it.
 *  - A DURATION BADGE ("0:24") from the contract's `durationSec` (or, when the
 *    server did not send one, the media's own metadata). It is a media LENGTH,
 *    not a clock — COR-053 is unaffected; the player shows no wall-clock.
 *  - KEYBOARD (NFR-001), in addition to the native controls: the wrapper is a
 *    focusable `role="group"` named by the alt text; with focus ON THE WRAPPER
 *    (or one of its buttons) Space/K play-pauses, ←/→ seek 5 s, M mutes, F
 *    toggles fullscreen. Keys are deliberately NOT handled while focus is in the
 *    native `<video>` itself — the browser already implements them there and a
 *    second handler would toggle twice (a net no-op). Every key we do handle
 *    `preventDefault`s (no page scroll) and `stopPropagation`s (so the modal
 *    viewer's ←/→ "previous/next image" never also fires).
 *  - NOT COLOUR-ONLY: Play and Mute are real buttons with an icon AND an
 *    accessible name AND `aria-pressed` for their state; Expand swaps its
 *    label/icon when fullscreen. The focus ring is a white + dark double ring,
 *    visible over any footage.
 *  - EXERCISE WATERMARK SLOT (NFR-008): `data-testid="media-watermark-slot"` is
 *    ALWAYS in the DOM, in the overlay's top row, with the SAME flexible width
 *    whether empty or filled (so toggling never shifts the layout). It renders the
 *    text "EXERCISE" exactly when
 *    `isWatermarkRequired(useChromeConfig())` — i.e. when the compliance chrome is
 *    off — and is an empty, invisible slot otherwise. We fullscreen the WRAPPER
 *    (not the bare `<video>`), the native fullscreen button is removed in
 *    Chromium (`controlsList="nofullscreen"`) and PiP is disabled, so the
 *    watermark cannot be dropped by a native fullscreen path. (Known gap: iOS
 *    Safari has no element fullscreen, so Expand opens the modal viewer there —
 *    which keeps the watermark — but its own native fullscreen button, if the
 *    user taps it, shows the bare video.)
 *  - EXPAND: native fullscreen on the wrapper; when the API is missing or
 *    refuses it asks the owner (`onRequestModal`) to open the modal viewer.
 *  - UNPLAYABLE: the server cannot tell an MP4's codec, so a `<video>` `error`
 *    swaps the frame for "This video can't be played in this browser" plus the
 *    alt text — never a blank box. A URL the allow-list rejects
 *    (`safeMediaUrl.ts`) renders the alt-text placeholder instead.
 *  - DP-12: there is NO caption track this push (an NFR-001 / WCAG 1.2.2 gap
 *    flagged in the contract); the alt text is the only text alternative.
 *
 * STACKING: the post card's open-the-thread overlay (`z-index: 1`) covers the
 * media; `PostMediaSlot` lifts this player to `z-index: 2` and the wrapper stops
 * click propagation, so clicking the player never opens the thread.
 *
 * Participant world — CSS Module, FontAwesome icons, no COBRA, no MUI. Reads only
 * the URLs on the contract; never builds one.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, SyntheticEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCompress,
  faExpand,
  faPause,
  faPlay,
  faTriangleExclamation,
  faVolumeHigh,
  faVolumeXmark,
} from '@fortawesome/free-solid-svg-icons'
import { isWatermarkRequired, useChromeConfig } from '@/features/participant-shell/chromeConfig'
import type { PostMedia } from '../../types/post'
import { formatDuration } from './formatDuration'
import {
  FULLSCREEN_CHANGE_EVENTS,
  exitFullscreen,
  getFullscreenElement,
  requestElementFullscreen,
} from './fullscreen'
import { MediaFallbackTile } from './MediaFallbackTile'
import { UNPLAYABLE_VIDEO_MESSAGE } from './mediaCopy'
import { SEEK_STEP_SECONDS, mediaAlt, singleMediaAspectRatio } from './mediaLayout'
import { claimPlayback, releasePlayback } from './playbackCoordinator'
import { resolveSafeMediaUrl, withFirstFrameHint } from './safeMediaUrl'
import styles from './VideoPlayer.module.css'

export interface VideoPlayerProps {
  /** The video attachment (`kind: 'video'`). */
  readonly media: PostMedia
  /**
   * `inline` (default): the in-feed player, with an Expand button. `expanded`: the
   * player inside the modal viewer — sized to the stage, no Expand button.
   */
  readonly variant?: 'inline' | 'expanded'
  /**
   * Called (with the player wrapper, for focus return) when native fullscreen is
   * unavailable or refused, so the owner can open the modal viewer instead.
   */
  readonly onRequestModal?: (trigger: HTMLElement) => void
}

/** Starts playback without leaking a rejected promise (autoplay policy, abort). */
function safePlay(video: HTMLVideoElement): void {
  void Promise.resolve(video.play()).catch(() => undefined)
}

export function VideoPlayer({ media, variant = 'inline', onRequestModal }: VideoPlayerProps) {
  const alt = mediaAlt(media)
  const watermarkRequired = isWatermarkRequired(useChromeConfig())

  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [failed, setFailed] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [metadataDuration, setMetadataDuration] = useState<number | undefined>(undefined)

  // Page-wide "one video at a time": give up the claim if this player unmounts mid-play.
  useEffect(() => {
    const video = videoRef.current
    return () => {
      if (video !== null) releasePlayback(video)
    }
  }, [])

  // Track whether THIS player's wrapper is the fullscreen element (for the Expand label).
  useEffect(() => {
    const sync = () => setFullscreen(getFullscreenElement() === wrapperRef.current)
    for (const name of FULLSCREEN_CHANGE_EVENTS) document.addEventListener(name, sync)
    return () => {
      for (const name of FULLSCREEN_CHANGE_EVENTS) document.removeEventListener(name, sync)
    }
  }, [])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (video === null) return
    if (video.paused) safePlay(video)
    else video.pause()
  }, [])

  const toggleMute = useCallback(() => {
    const video = videoRef.current
    if (video === null) return
    video.muted = !video.muted
    setMuted(video.muted)
  }, [])

  const seek = useCallback((deltaSeconds: number) => {
    const video = videoRef.current
    if (video === null) return
    const end = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY
    video.currentTime = Math.min(end, Math.max(0, video.currentTime + deltaSeconds))
  }, [])

  const toggleFullscreen = useCallback(async () => {
    const wrapper = wrapperRef.current
    if (wrapper === null) return
    if (getFullscreenElement() === wrapper) {
      await exitFullscreen()
      return
    }
    const entered = await requestElementFullscreen(wrapper)
    if (!entered && variant === 'inline' && onRequestModal !== undefined) {
      // No usable native fullscreen (e.g. iPhone Safari): fall back to the modal viewer.
      videoRef.current?.pause()
      onRequestModal(wrapper)
    }
  }, [onRequestModal, variant])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    // The native <video> already implements these keys while it has focus; handling them
    // here too would toggle twice. Only the wrapper and our own buttons are ours.
    if (event.target instanceof HTMLVideoElement) return
    // A focused <button> activates itself on Space/Enter.
    const onButton = event.target instanceof HTMLButtonElement

    switch (event.key) {
      case ' ':
      case 'Spacebar':
        if (onButton) return
        togglePlay()
        break
      case 'k':
      case 'K':
        togglePlay()
        break
      case 'ArrowLeft':
        seek(-SEEK_STEP_SECONDS)
        break
      case 'ArrowRight':
        seek(SEEK_STEP_SECONDS)
        break
      case 'm':
      case 'M':
        toggleMute()
        break
      case 'f':
      case 'F':
        void toggleFullscreen()
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  const src = resolveSafeMediaUrl(media.url)
  if (src === undefined) {
    // Unsafe or missing URL (NFR-004): the alt-text placeholder, in the same frame.
    return (
      <div
        className={styles.player}
        style={{ aspectRatio: singleMediaAspectRatio(media.width, media.height) }}
        data-testid="video-player-fallback"
      >
        <MediaFallbackTile alt={alt} kind="video" />
      </div>
    )
  }

  const posterSrc = resolveSafeMediaUrl(media.posterUrl)
  // No poster: ask for the frame at 0.1 s so Safari has something to paint.
  const videoSrc = posterSrc === undefined ? withFirstFrameHint(src) : src

  const knownDuration = typeof media.durationSec === 'number'
    && Number.isFinite(media.durationSec) && media.durationSec > 0
    ? media.durationSec
    : metadataDuration
  const ratio = singleMediaAspectRatio(media.width, media.height)
  const frameStyle = { aspectRatio: ratio, '--vp-ratio': ratio } as CSSProperties

  const handleLoadedMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    const { duration } = event.currentTarget
    if (Number.isFinite(duration) && duration > 0) setMetadataDuration(duration)
  }

  return (
    <div
      ref={wrapperRef}
      className={`${styles.player} ${variant === 'expanded' ? styles.expanded : ''}`}
      style={frameStyle}
      role="group"
      aria-label={alt}
      tabIndex={0}
      data-testid="video-player"
      onKeyDown={handleKeyDown}
      onClick={event => event.stopPropagation()}
    >
      {failed ? (
        <div className={styles.unplayable} role="status" data-testid="video-unplayable">
          <FontAwesomeIcon
            icon={faTriangleExclamation}
            className={styles.unplayableIcon}
            aria-hidden="true"
          />
          <p className={styles.unplayableMessage}>{UNPLAYABLE_VIDEO_MESSAGE}</p>
          <p className={styles.unplayableAlt}>{alt}</p>
        </div>
      ) : (
        <video
          ref={videoRef}
          className={styles.video}
          src={videoSrc}
          poster={posterSrc}
          controls
          controlsList="nofullscreen"
          disablePictureInPicture
          playsInline
          preload="metadata"
          onPlay={event => {
            setPlaying(true)
            claimPlayback(event.currentTarget)
          }}
          onPause={event => {
            setPlaying(false)
            releasePlayback(event.currentTarget)
          }}
          onEnded={event => {
            setPlaying(false)
            releasePlayback(event.currentTarget)
          }}
          onVolumeChange={event => setMuted(event.currentTarget.muted)}
          onLoadedMetadata={handleLoadedMetadata}
          onError={() => {
            setPlaying(false)
            setFailed(true)
          }}
        />
      )}

      {/*
        The overlay top row: duration | watermark slot | Mute . Expand. A flex row (not
        three absolute pins), so the watermark can never collide with the controls at any
        player width; the slot is `flex: 1` whether empty or filled, so toggling it moves
        nothing. Click-through except the buttons.
      */}
      <div className={styles.topBar}>
        {knownDuration !== undefined && (
          <time
            className={styles.duration}
            dateTime={`PT${Math.round(knownDuration)}S`}
            title="Video length"
            data-testid="video-duration"
          >
            {formatDuration(knownDuration)}
          </time>
        )}

        {/* NFR-008: ALWAYS present at a fixed position (no layout shift); text only when the
            chrome is off. */}
        <div
          className={styles.watermark}
          data-testid="media-watermark-slot"
          role={watermarkRequired ? 'note' : undefined}
          aria-label={watermarkRequired ? 'Exercise watermark' : undefined}
        >
          {watermarkRequired ? <span className={styles.watermarkText}>EXERCISE</span> : null}
        </div>

        {!failed && (
          <div className={styles.corner}>
            <button
              type="button"
              className={styles.control}
              aria-label="Mute"
              aria-pressed={muted}
              data-testid="video-mute-toggle"
              onClick={toggleMute}
            >
              <FontAwesomeIcon icon={muted ? faVolumeXmark : faVolumeHigh} aria-hidden="true" />
            </button>
            {variant === 'inline' && (
              <button
                type="button"
                className={styles.control}
                aria-label={fullscreen ? 'Exit full screen' : 'Expand'}
                data-testid="video-expand"
                onClick={() => void toggleFullscreen()}
              >
                <FontAwesomeIcon icon={fullscreen ? faCompress : faExpand} aria-hidden="true" />
              </button>
            )}
          </div>
        )}
      </div>

      {!failed && (
        <button
          type="button"
          className={`${styles.control} ${styles.playToggle}`}
          aria-label="Play"
          aria-pressed={playing}
          data-testid="video-play-toggle"
          onClick={togglePlay}
        >
          <FontAwesomeIcon icon={playing ? faPause : faPlay} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
