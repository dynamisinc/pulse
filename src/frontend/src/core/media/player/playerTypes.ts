/**
 * core/media/player/playerTypes.ts
 * ---------------------------------------------------------------------------
 * The media shape the shared player reads (channels-foundation 14, news FU-9).
 * Structural on purpose: Social's `PostMedia` and a channel's `ContentMediaDto`
 * (mapped by `ContentMedia`) both satisfy it, so the player depends on neither
 * feature. Only the URLs on a contract are read; the player never builds one.
 */

export interface PlayerMedia {
  /** The media id, when the contract carries one (unused by the player). */
  readonly id?: string
  readonly kind: 'image' | 'video'
  readonly url: string
  readonly alt: string
  readonly posterUrl?: string
  readonly width?: number
  readonly height?: number
  readonly durationSec?: number
}

/**
 * What the player hands a host's own control row (`VideoPlayer` `renderControls`). A
 * channel that needs tinted, broadcast-style chrome (news story 05) draws its own buttons
 * from this state and these actions; the player keeps everything else (one-at-a-time
 * playback, wrapper fullscreen and its policing, the overlay pause, the EXERCISE bands).
 */
export interface PlayerControlsApi {
  readonly playing: boolean
  readonly muted: boolean
  /** Seconds played. */
  readonly currentTime: number
  /** Seconds, or `undefined` until known (contract `durationSec`, else the metadata). */
  readonly duration: number | undefined
  readonly fullscreen: boolean
  /** The video exposes at least one captions / subtitles text track. */
  readonly captionsAvailable: boolean
  readonly captionsOn: boolean
  readonly togglePlay: () => void
  readonly toggleMute: () => void
  /** Jumps to `seconds` (clamped to the video). */
  readonly seekTo: (seconds: number) => void
  readonly toggleFullscreen: () => void
  readonly toggleCaptions: () => void
}
