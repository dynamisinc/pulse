/**
 * core/media/mediaErrors.ts
 * ---------------------------------------------------------------------------
 * The ONE place the upload client's user-facing error text lives, so the
 * pre-flight checks (`validateMediaFile`), the mock upload adapter and the live
 * adapter's HTTP-status mapping can never drift apart (demo-polish F0, AC
 * "mock adapter: ... same error text as the server's 413/415").
 *
 *   - 413 (too large)        -> `tooLargeImage` / `tooLargeVideo`
 *   - 415 (type/sniff/kind)  -> `unsupported`
 *   - 429 (rate limited)     -> `rateLimited`
 *   - 503 (store unconfigured)-> `unavailable`
 *   - 400 / 401 / 403 (the request was refused: bad form field, expired or
 *     missing session, no persona / read-only) -> `refused`, a generic message
 *     that deliberately does not say why (never a raw server body)
 *
 * World-neutral (`core/`): plain strings and one Error subclass, no UI, no theme.
 * The video format hint is the product's guidance that Safari will not play a
 * non-H.264 MP4 (BM story, plan §7), so every "unsupported" message carries it.
 */

import type { MediaKind } from './types'

/** Images: <= 5 MiB (jpeg/png/gif/webp). Mirrors the server's streamed limits. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024

/** Videos: <= 100 MiB (mp4/webm). Mirrors the server's streamed limits. */
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024

/**
 * The server's accepted range for the client's size hints: `width` / `height` are
 * integers 1..{@link MEDIA_MAX_DIMENSION} (implementation.md §1.5.1). Shared by the
 * response guard (`mediaGuards`) so the two can never disagree.
 */
export const MEDIA_MAX_DIMENSION = 16384

/**
 * The server rejects durations over an hour: `durationSec` is a double with
 * 0 < x <= {@link MEDIA_MAX_DURATION_SEC} (fractional seconds are valid — it is
 * `video.duration`). Shared by `captureVideoPoster` and the response guard.
 */
export const MEDIA_MAX_DURATION_SEC = 3600

/** Shown wherever a video is requested — Safari will not play non-H.264 MP4. */
export const VIDEO_FORMAT_HINT = 'MP4 (H.264)'

/** The exact user-facing messages (see the module header for the status mapping). */
export const MEDIA_ERROR_TEXT = {
  empty: 'That file is empty.',
  unsupported:
    "That file type isn't supported. Attach a JPEG, PNG, GIF or WebP image, " +
    `or a ${VIDEO_FORMAT_HINT} video.`,
  tooLargeImage: 'That image is too large (5 MB max).',
  tooLargeVideo: 'That video is too large (100 MB max).',
  rateLimited: 'Too many uploads right now. Wait a moment and try again.',
  refused:
    'That upload was not accepted. Try a different file, or sign in again if this keeps happening.',
  unavailable: 'Uploads are not available right now.',
  failed: 'The upload failed. Check your connection and try again.',
} as const

/**
 * Maps an upload HTTP status (and, when known, the kind being uploaded) to the
 * user-facing message. Unknown statuses fall through to the generic `failed`
 * text — never a raw server body (a 4xx body is a plain string the server
 * controls; we do not render it).
 */
export function mediaUploadErrorMessage(status: number | undefined, kind?: MediaKind): string {
  switch (status) {
    case 413:
      return kind === 'video' ? MEDIA_ERROR_TEXT.tooLargeVideo : MEDIA_ERROR_TEXT.tooLargeImage
    case 415:
      return MEDIA_ERROR_TEXT.unsupported
    case 429:
      return MEDIA_ERROR_TEXT.rateLimited
    case 400:
    case 401:
    case 403:
      return MEDIA_ERROR_TEXT.refused
    case 503:
      return MEDIA_ERROR_TEXT.unavailable
    default:
      return MEDIA_ERROR_TEXT.failed
  }
}

/** A failed upload. `status` is the HTTP status when the failure came from the server. */
export class MediaUploadError extends Error {
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'MediaUploadError'
    this.status = status
  }
}

/** The rejection an aborted upload settles with (`DOMException` `AbortError`). */
export function createAbortError(): DOMException {
  return new DOMException('The upload was cancelled.', 'AbortError')
}

/** True for an `AbortError` (our own, the platform's, or axios' `CanceledError`). */
export function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const named = error as { name?: unknown; code?: unknown }
  return named.name === 'AbortError' || named.name === 'CanceledError' || named.code === 'ERR_CANCELED'
}
