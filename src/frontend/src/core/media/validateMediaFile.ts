/**
 * core/media/validateMediaFile.ts
 * ---------------------------------------------------------------------------
 * Pre-flight validation of a picked file (demo-polish F0; NFR-004 partial,
 * SOC-001). SIZE and MIME only — the server is the real gate and SNIFFS magic
 * bytes (a PNG renamed `.mp4` passes here and is rejected there with a 415).
 * This exists so a participant/controller gets an instant, specific message
 * instead of waiting on a 100 MB upload to be refused.
 *
 * World-neutral (`core/`): pure, synchronous, no React, no theme.
 *
 * The messages come from `mediaErrors.ts` — the same text the live adapter maps
 * the server's 413/415 to — and every "unsupported" message carries the video
 * format hint "MP4 (H.264)" (Safari will not play a non-H.264 MP4).
 */

import { IMAGE_MAX_BYTES, MEDIA_ERROR_TEXT, VIDEO_MAX_BYTES } from './mediaErrors'
import type { MediaKind } from './types'

/** Image MIME types the server accepts (sniffed server-side). */
export const ACCEPTED_IMAGE_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]

/** Video MIME types the server accepts (sniffed server-side). */
export const ACCEPTED_VIDEO_MIME_TYPES: readonly string[] = ['video/mp4', 'video/webm']

/** Value for an `<input type="file" accept>` that allows images and videos. */
export const ACCEPT_ANY_MEDIA = [...ACCEPTED_IMAGE_MIME_TYPES, ...ACCEPTED_VIDEO_MIME_TYPES].join(',')

/** Value for an `<input type="file" accept>` that allows images only. */
export const ACCEPT_IMAGES_ONLY = ACCEPTED_IMAGE_MIME_TYPES.join(',')

/** The result of {@link validateMediaFile}. */
export type MediaValidationResult =
  | { readonly ok: true; readonly kind: MediaKind }
  | { readonly ok: false; readonly error: string }

/**
 * Checks `file`'s MIME type and size against the product limits.
 *
 * - empty file          -> `error` (the server answers 415 for these too)
 * - unknown/blank MIME  -> `error` ("MP4 (H.264)" hint included)
 * - image > 5 MiB       -> `error`
 * - video > 100 MiB     -> `error`
 * - otherwise           -> `{ ok: true, kind }`
 */
export function validateMediaFile(file: File): MediaValidationResult {
  const type = file.type.toLowerCase()

  let kind: MediaKind
  if (ACCEPTED_IMAGE_MIME_TYPES.includes(type)) {
    kind = 'image'
  } else if (ACCEPTED_VIDEO_MIME_TYPES.includes(type)) {
    kind = 'video'
  } else {
    return { ok: false, error: MEDIA_ERROR_TEXT.unsupported }
  }

  if (file.size <= 0) return { ok: false, error: MEDIA_ERROR_TEXT.empty }

  if (kind === 'image' && file.size > IMAGE_MAX_BYTES) {
    return { ok: false, error: MEDIA_ERROR_TEXT.tooLargeImage }
  }
  if (kind === 'video' && file.size > VIDEO_MAX_BYTES) {
    return { ok: false, error: MEDIA_ERROR_TEXT.tooLargeVideo }
  }

  return { ok: true, kind }
}
