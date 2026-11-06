/**
 * core/media/player/VideoPlayer.tsx
 * ---------------------------------------------------------------------------
 * The inline video player (demo-polish F2 — the demo's headline feature;
 * SOC-001, NFR-001, NFR-004, NFR-008, COR-053). A news video plays RIGHT IN the
 * post, with the platform's own controls, and expands full-screen.
 *
 *   <div role="group" aria-label={alt} tabindex=0>      the focusable wrapper
 *     <video controls playsInline preload="metadata" poster>   native controls
 *     <ExerciseBands>   EXERCISE bands, top + bottom (when required / fullscreen)
 *     top row: duration badge · Mute · Expand   (above the bands, still clickable)
 *     centre: Play / Pause
 *   </div>
 *
 *  HOST CONTROLS (opt-in, news story 05): with `renderControls` set, the native controls,
 *  the top row and the centre button are NOT drawn; the host's own row (from
 *  `PlayerControlsApi`) renders inside the wrapper instead. Everything below still holds.
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
 *  - EXERCISE BANDS (NFR-008, demo-feedback 06 / DF-3 / DF-4): the shared
 *    `ExerciseBands` overlay draws `EXERCISE EXERCISE EXERCISE` across the top and the
 *    bottom of the frame when `isWatermarkRequired(useChromeConfig())` (the exercise's
 *    watermark switch is on, or the compliance chrome is off) AND ALSO whenever this
 *    player is fullscreen: fullscreen hides the compliance banners, so without that a
 *    watermark-off exercise would show a full-screen video with no EXERCISE marking
 *    anywhere (the invariant is "chrome and watermark are never BOTH off"). The bands
 *    replace the earlier single "EXERCISE" slot in the top row. They are click-through
 *    and sit BELOW the top controls row (duration, Mute, Expand) and the Play button,
 *    which stay visible and clickable; the bottom band is lifted clear of the native
 *    control bar. Absolutely positioned, so showing/hiding them shifts nothing. The
 *    unplayable-video message shows no footage and carries no bands.
 *  - NO PATH SHOWS THE BARE VIDEO. We fullscreen the WRAPPER (so the bands child
 *    is on screen), `controlsList="nofullscreen nodownload noremoteplayback"` +
 *    `disablePictureInPicture` + `disableRemotePlayback` remove Chromium's fullscreen,
 *    Download and Cast, and the rest is policed at runtime: a `fullscreenchange` whose
 *    element is the bare `<video>` (Firefox / desktop Safari ignore `controlsList`;
 *    double-click) is exited at once and routed to the in-app modal viewer, and on iOS
 *    (native `<video>`-only fullscreen, which cannot be overlaid) `webkitbeginfullscreen`
 *    triggers `webkitExitFullscreen()` and the same modal. RESIDUAL iOS RISK: the native
 *    player cannot be PREVENTED, only left immediately, so it can flash for a moment.
 *  - PAUSE/ENDEX/BREAK-FICTION: when the shell overlay becomes active
 *    (`useOverlayState`, the shell's own public state hook — social imports the shell,
 *    never the reverse) the playing video is paused, a `play` while it is active is
 *    paused straight away, and the player does not enter fullscreen (Expand / F are
 *    no-ops) — nothing plays or goes fullscreen behind the overlay. A fullscreen element
 *    paints ABOVE everything, so one that is already up when the overlay activates would
 *    hide break-fiction's "REAL-WORLD MESSAGE": the SHELL leaves any fullscreen itself
 *    (`useLeaveFullscreenWhileActive`, document APIs only, covering every channel), and
 *    this player also exits if its own wrapper holds it (belt and braces).
 *  - EXPAND: native fullscreen on the wrapper; when the API is missing or
 *    refuses it asks the owner (`onRequestModal`, with the playback position) to open
 *    the modal viewer, which resumes at that position (paused — it never autoplays).
 *  - UNPLAYABLE: the server cannot tell an MP4's codec, so a `<video>` `error`
 *    swaps the frame for "This video can't be played in this browser" plus the
 *    alt text — never a blank box. A URL the allow-list rejects
 *    (`safeMediaUrl.ts`) renders the alt-text placeholder instead.
 *  - DP-12: the contract carries NO caption track (an NFR-001 / WCAG 1.2.2 gap flagged in
 *    the contract); the alt text is the only text alternative. A host control row can
 *    toggle IN-BAND captions tracks when a video happens to expose them (rare for MP4).
 *
 * STACKING: the post card's open-the-thread overlay (`z-index: 1`) covers the
 * media; `PostMediaSlot` lifts this player to `z-index: 2` and the wrapper stops
 * click propagation, so clicking the player never opens the thread.
 *
 * Participant world — CSS Module, FontAwesome icons, no COBRA, no MUI. Reads only
 * the URLs on the contract; never builds one.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactNode, SyntheticEvent } from 'react'
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
import { useOverlayState } from '@/features/participant-shell/components/OverlayLayer'
import type { PlayerControlsApi, PlayerMedia } from './playerTypes'
import { ExerciseBands } from './ExerciseBands'
import { formatDuration } from './formatDuration'
import {
  FULLSCREEN_CHANGE_EVENTS,
  exitFullscreen,
  exitVideoFullscreenIOS,
  getFullscreenElement,
  requestElementFullscreen,
} from './fullscreen'
import { MediaFallbackTile } from './MediaFallbackTile'
import { ParticipantTooltip } from './ParticipantTooltip'
import { UNPLAYABLE_VIDEO_MESSAGE } from './mediaCopy'
import { SEEK_STEP_SECONDS, mediaAlt, singleMediaAspectRatio } from './mediaLayout'
import { claimPlayback, pauseActivePlayback, releasePlayback } from './playbackCoordinator'
import { resolveSafeMediaUrl, withFirstFrameHint, withStartTime } from './safeMediaUrl'
import styles from './VideoPlayer.module.css'

export interface VideoPlayerProps {
  /** The video attachment (`kind: 'video'`). */
  readonly media: PlayerMedia
  /**
   * `inline` (default): the in-feed player, with an Expand button. `expanded`: the
   * player inside the modal viewer — sized to the stage, no Expand button.
   */
  readonly variant?: 'inline' | 'expanded'
  /**
   * Called (with the player wrapper, for focus return, and — when it had started — the
   * playback position) when fullscreen has to happen IN THE APP instead: the browser has
   * no element-fullscreen API, refused it, or took the bare `<video>` fullscreen by its
   * own route (which would drop the EXERCISE bands). The owner opens the modal viewer.
   */
  readonly onRequestModal?: (trigger: HTMLElement, startAt?: number) => void
  /** Resume position in seconds (the modal fallback carries it over). Default: the start. */
  readonly startAt?: number
  /**
   * Extra overlay drawn INSIDE the wrapper that is fullscreened (e.g. a channel's EXERCISE
   * chip), so it stays on screen in fullscreen. Not drawn over the unplayable message.
   */
  readonly overlay?: ReactNode
  /**
   * OPT-IN host control row (news story 05's broadcast player). When set, the native
   * `<video>` controls and the default top row / centre Play button are NOT drawn; this is
   * rendered inside the fullscreened wrapper instead, from the player's own state and
   * actions. Everything else (no autoplay, one-at-a-time, wrapper-only fullscreen, the
   * overlay pause, the EXERCISE bands) is unchanged. Unset (Social): behaviour unchanged.
   */
  readonly renderControls?: (api: PlayerControlsApi) => ReactNode
  /** Extra class on the wrapper (a host's frame shape: radius, border). */
  readonly className?: string
  /** Id of an element that describes the video (e.g. its caption), for `aria-describedby`. */
  readonly describedBy?: string
}

/** Captions / subtitles tracks the `<video>` exposes (in-band or `<track>`). */
function captionTracks(video: HTMLVideoElement | null): TextTrack[] {
  const list = video?.textTracks
  if (list === undefined || list === null) return []
  const tracks: TextTrack[] = []
  for (let index = 0; index < list.length; index += 1) {
    const track = list[index]
    if (track !== undefined && (track.kind === 'captions' || track.kind === 'subtitles')) {
      tracks.push(track)
    }
  }
  return tracks
}

/** Starts playback without leaking a rejected promise (autoplay policy, abort). */
function safePlay(video: HTMLVideoElement): void {
  void Promise.resolve(video.play()).catch(() => undefined)
}

export function VideoPlayer({
  media,
  variant = 'inline',
  onRequestModal,
  startAt,
  overlay,
  renderControls,
  className,
  describedBy,
}: VideoPlayerProps) {
  const customControls = renderControls !== undefined
  const alt = mediaAlt(media)
  // A shell Pause / EndEx / break-fiction overlay covers the channel: media must stop.
  const overlayActive = useOverlayState().state !== 'none'

  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  // The URL that errored (not a boolean): a re-minted SAS URL is a different `src` and retries.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [metadataDuration, setMetadataDuration] = useState<number | undefined>(undefined)
  // Host control-row state (only read when `renderControls` is set).
  const [currentTime, setCurrentTime] = useState(0)
  const [captionsAvailable, setCaptionsAvailable] = useState(false)
  const [captionsOn, setCaptionsOn] = useState(false)

  // The latest fullscreen-fallback inputs, read from event handlers that must not re-subscribe.
  const latestRef = useRef({ variant, onRequestModal, overlayActive })
  useEffect(() => {
    latestRef.current = { variant, onRequestModal, overlayActive }
  })

  /**
   * Fullscreen has to happen IN THE APP (the modal viewer keeps the EXERCISE bands;
   * a native fullscreen of the bare `<video>` cannot). Pauses the inline video and hands
   * its position over. A no-op in the already-expanded variant or without an owner.
   */
  const openInModal = useCallback(() => {
    const latest = latestRef.current
    const { variant: currentVariant, onRequestModal: open, overlayActive: covered } = latest
    const wrapper = wrapperRef.current
    // Never open a modal under (or fullscreen over) a Pause / EndEx / break-fiction overlay.
    if (covered || currentVariant !== 'inline' || open === undefined || wrapper === null) return
    const video = videoRef.current
    const at = video !== null && Number.isFinite(video.currentTime) ? video.currentTime : 0
    video?.pause()
    if (at > 0) open(wrapper, at)
    else open(wrapper)
  }, [])

  // Ref callback (not an effect that captured the element once): the `<video>` element is
  // replaced when a failed URL is retried, so the "one at a time" claim and the iOS
  // listener must follow the element, not the component. React 19 runs the returned cleanup
  // when the element goes away.
  const attachVideo = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video
    if (video === null) return undefined
    // Re-attached while playing (the callback identity changed): keep the one-at-a-time claim.
    if (!video.paused) claimPlayback(video)
    // iOS Safari presents its own native fullscreen for a `<video>` (no page overlay, so no
    // watermark): leave it the instant it begins and use the in-app viewer instead.
    const handleBeginFullscreen = () => {
      exitVideoFullscreenIOS(video)
      openInModal()
    }
    video.addEventListener('webkitbeginfullscreen', handleBeginFullscreen)
    // Captions toggle (host control row only; Social pays nothing): follow the video's tracks.
    const tracks: TextTrackList | undefined = customControls
      ? video.textTracks ?? undefined
      : undefined
    const syncTracks = () => {
      const found = captionTracks(video)
      setCaptionsAvailable(found.length > 0)
      setCaptionsOn(found.some(track => track.mode === 'showing'))
    }
    if (customControls) syncTracks()
    if (typeof tracks?.addEventListener === 'function') {
      tracks.addEventListener('addtrack', syncTracks)
      tracks.addEventListener('removetrack', syncTracks)
      tracks.addEventListener('change', syncTracks)
    }
    return () => {
      video.removeEventListener('webkitbeginfullscreen', handleBeginFullscreen)
      if (typeof tracks?.removeEventListener === 'function') {
        tracks.removeEventListener('addtrack', syncTracks)
        tracks.removeEventListener('removetrack', syncTracks)
        tracks.removeEventListener('change', syncTracks)
      }
      releasePlayback(video)
    }
  }, [openInModal, customControls])

  // The shell overlay takes over the screen: pause whatever is playing, and — belt and braces
  // beside the shell's own `useLeaveFullscreenWhileActive` — leave fullscreen if THIS player's
  // wrapper holds it (a fullscreen element paints above the overlay, hiding break-fiction).
  useEffect(() => {
    if (!overlayActive) return
    pauseActivePlayback()
    const fullscreenElement = getFullscreenElement()
    if (fullscreenElement !== null && fullscreenElement === wrapperRef.current) {
      void exitFullscreen()
    }
  }, [overlayActive])

  // Track THIS player's fullscreen state, and police how it got there.
  useEffect(() => {
    const sync = () => {
      const current = getFullscreenElement()
      setFullscreen(current !== null && current === wrapperRef.current)
      if (current !== null && current === videoRef.current) {
        // The browser's own fullscreen path (Firefox / desktop Safari ignore `controlsList`;
        // so does a double-click) took the BARE <video> — no watermark, no overlay. Leave it
        // and route to the in-app viewer. There is no user activation in this handler, so
        // re-requesting fullscreen on the wrapper here would be refused.
        void exitFullscreen()
        openInModal()
      }
    }
    for (const name of FULLSCREEN_CHANGE_EVENTS) document.addEventListener(name, sync)
    return () => {
      for (const name of FULLSCREEN_CHANGE_EVENTS) document.removeEventListener(name, sync)
    }
  }, [openInModal])

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

  const seekTo = useCallback((seconds: number) => {
    const video = videoRef.current
    if (video === null || !Number.isFinite(seconds)) return
    const end = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY
    video.currentTime = Math.min(end, Math.max(0, seconds))
    setCurrentTime(video.currentTime)
  }, [])

  const toggleCaptions = useCallback(() => {
    const found = captionTracks(videoRef.current)
    if (found.length === 0) return
    const turnOn = !found.some(track => track.mode === 'showing')
    // On: show the first track only (the contract carries no language / default yet).
    // Off: `hidden`, not `disabled`, so cues stay loaded for the next toggle.
    found.forEach((track, index) => {
      track.mode = turnOn && index === 0 ? 'showing' : 'hidden'
    })
    setCaptionsOn(turnOn)
  }, [])

  const toggleFullscreen = useCallback(async () => {
    const wrapper = wrapperRef.current
    if (wrapper === null) return
    if (getFullscreenElement() === wrapper) {
      await exitFullscreen()
      return
    }
    // A Pause / EndEx / break-fiction overlay is up: do not enter fullscreen over it.
    if (latestRef.current.overlayActive) return
    const entered = await requestElementFullscreen(wrapper)
    // No usable native fullscreen (e.g. iPhone Safari): fall back to the modal viewer.
    if (!entered) openInModal()
  }, [openInModal])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    // The native <video> already implements these keys while it has focus; handling them
    // here too would toggle twice. Only the wrapper and our own buttons are ours.
    if (event.target instanceof HTMLVideoElement) return
    // A host control row's scrub slider owns its own arrow keys (a second seek would double).
    if (event.target instanceof HTMLInputElement) return
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
        className={[styles.player, className].filter(Boolean).join(' ')}
        style={{ aspectRatio: singleMediaAspectRatio(media.width, media.height) }}
        data-testid="video-player-fallback"
      >
        <MediaFallbackTile alt={alt} kind="video" />
      </div>
    )
  }

  const failed = failedSrc === src
  const posterSrc = resolveSafeMediaUrl(media.posterUrl)
  // Resuming (the modal fallback) seeks to the hand-over position; with no poster, ask for
  // the frame at 0.1 s so Safari has something to paint.
  const videoSrc = startAt !== undefined && startAt > 0
    ? withStartTime(src, startAt)
    : posterSrc === undefined ? withFirstFrameHint(src) : src

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
      className={[styles.player, variant === 'expanded' ? styles.expanded : '', className]
        .filter(Boolean).join(' ')}
      style={frameStyle}
      role="group"
      aria-label={alt}
      aria-describedby={describedBy}
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
          ref={attachVideo}
          className={styles.video}
          src={videoSrc}
          poster={posterSrc}
          controls={!customControls}
          controlsList="nofullscreen nodownload noremoteplayback"
          disablePictureInPicture
          disableRemotePlayback
          playsInline
          preload="metadata"
          onPlay={event => {
            if (overlayActive) {
              // Nothing plays behind a Pause / EndEx / break-fiction overlay.
              event.currentTarget.pause()
              return
            }
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
          onTimeUpdate={customControls
            ? event => setCurrentTime(event.currentTarget.currentTime)
            : undefined}
          // No native controls: a click on the picture play-pauses (the host row has the button).
          onClick={customControls ? togglePlay : undefined}
          onError={() => {
            setPlaying(false)
            setFailedSrc(src)
          }}
        />
      )}

      {/*
        NFR-008 / DF-4: the EXERCISE bands, when the exercise requires them and ALWAYS while
        this player is fullscreen (the compliance banners are hidden then). A child of the
        wrapper that is fullscreened, so they stay on screen; below the controls in z-order.
      */}
      {/* No bands over the unplayable message: it shows no footage (Gate-1 L-5). */}
      {!failed && <ExerciseBands force={fullscreen} clearNativeControls />}
      {!failed && overlay}

      {renderControls !== undefined && !failed && <HostControls
        render={renderControls}
        api={{
          playing,
          muted,
          currentTime,
          duration: knownDuration,
          fullscreen,
          captionsAvailable,
          captionsOn,
          togglePlay,
          toggleMute,
          seekTo,
          toggleFullscreen: () => void toggleFullscreen(),
          toggleCaptions,
        }}
      />}

      {/*
        The overlay top row: duration | Mute . Expand. Painted ABOVE the bands, so the
        controls stay visible and clickable. Click-through except the buttons.
      */}
      {!customControls && <div className={styles.topBar}>
        {knownDuration !== undefined && (
          <time
            className={styles.duration}
            dateTime={`PT${Math.round(knownDuration)}S`}
            data-testid="video-duration"
          >
            <span className={styles.srOnly}>Video length </span>
            {formatDuration(knownDuration)}
          </time>
        )}

        {!failed && (
          <div className={styles.corner}>
            <ParticipantTooltip label="Mute">
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
            </ParticipantTooltip>
            {variant === 'inline' && (
              <ParticipantTooltip label={fullscreen ? 'Exit full screen' : 'Expand'}>
                <button
                  type="button"
                  className={styles.control}
                  aria-label={fullscreen ? 'Exit full screen' : 'Expand'}
                  data-testid="video-expand"
                  onClick={() => void toggleFullscreen()}
                >
                  <FontAwesomeIcon icon={fullscreen ? faCompress : faExpand} aria-hidden="true" />
                </button>
              </ParticipantTooltip>
            )}
          </div>
        )}
      </div>}

      {!failed && !customControls && (
        <ParticipantTooltip label="Play">
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
        </ParticipantTooltip>
      )}
    </div>
  )
}

/**
 * Renders a host's control row (`renderControls`) from the player's state and actions.
 * A component boundary on purpose: the host row may use hooks, and calling the render
 * prop inline would run them as the PLAYER's hooks (and trips the React compiler's
 * "refs during render" rule, since the actions close over the player's refs).
 */
function HostControls({
  render,
  api,
}: {
  readonly render: (api: PlayerControlsApi) => ReactNode
  readonly api: PlayerControlsApi
}) {
  return render(api)
}
