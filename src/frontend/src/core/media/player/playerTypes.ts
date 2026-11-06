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
