/**
 * core/media/captureVideoPoster.ts
 * ---------------------------------------------------------------------------
 * Grabs a poster frame + the basic facts of a video file IN THE BROWSER
 * (demo-polish F0; plan §7 "poster-less Safari mitigation"). There is no
 * server-side transcoding or thumbnailing this push, so the client produces the
 * poster: it loads the file into an off-DOM `<video>`, seeks a little way in,
 * draws that frame to a canvas and exports a JPEG `Blob`.
 *
 * It also reports `width`/`height`/`durationSec` — the hints the upload sends so
 * the player can reserve the right aspect ratio and show a duration badge (a
 * media LENGTH, not a clock — COR-053 is unaffected). `width`/`height` are the
 * VIDEO's natural size; the poster JPEG may be smaller, so its own size is
 * reported separately as `posterWidth`/`posterHeight` (the poster upload's hints).
 *
 * Rejects when the browser cannot decode the file (for instance an HEVC MP4 on
 * a browser without an HEVC decoder). The caller (`uploadVideoWithPoster`)
 * treats that as "upload the video without a poster" — the F2 player has a
 * poster-less fallback path — rather than blocking the post.
 *
 * Uses a TEMPORARY object URL, revoked once the frame is captured. The exported
 * poster is downscaled to at most {@link POSTER_MAX_WIDTH} px wide so it stays a
 * small JPEG (well under the 5 MiB image limit).
 *
 * NEVER HANGS: a file that neither decodes nor errors (some containers/codecs in
 * some browsers fire neither `loadedmetadata` nor `error`) used to leave the
 * returned promise pending forever, wedging `uploadVideoWithPoster` and the
 * composer's "uploading" state. The capture now races a timeout
 * ({@link POSTER_CAPTURE_TIMEOUT_MS}) that REJECTS — which `uploadVideoWithPoster`
 * already treats as "upload the video without a poster" — and honours an
 * `AbortSignal` (rejecting with an `AbortError`). On success, error, timeout or
 * abort alike the `<video>` element's source is detached and the object URL
 * revoked exactly once.
 *
 * World-neutral (`core/`): DOM APIs only, no React, no theme.
 */

import { MEDIA_MAX_DURATION_SEC, createAbortError } from './mediaErrors'

/** What {@link captureVideoPoster} resolves with. */
export interface CapturedVideoPoster {
  /** The poster frame, JPEG. */
  readonly poster: Blob
  /**
   * The VIDEO's natural width — the hint the VIDEO upload sends. NOT the poster's:
   * the poster is downscaled to at most {@link POSTER_MAX_WIDTH} px (see
   * {@link CapturedVideoPoster.posterWidth}).
   */
  readonly width: number
  /** The VIDEO's natural height (the video upload's hint; see `width`). */
  readonly height: number
  /**
   * The POSTER JPEG's actual width in px (the canvas it was drawn to), which is
   * `width` scaled down to at most {@link POSTER_MAX_WIDTH}. The POSTER upload
   * must send this, never the video's `width`, or the recorded size would not
   * match the stored image.
   */
  readonly posterWidth: number
  /** The POSTER JPEG's actual height in px (the canvas it was drawn to). */
  readonly posterHeight: number
  /** Media length in seconds (0 < x <= 3600, the server's accepted range). */
  readonly durationSec: number
}

/** The widest poster we export; larger frames are scaled down proportionally. */
export const POSTER_MAX_WIDTH = 1280

/** Seconds into the clip to take the frame from (clamped for very short clips). */
const POSTER_SEEK_SECONDS = 0.5

/** JPEG quality of the exported poster. */
const POSTER_JPEG_QUALITY = 0.82

/** How long to wait for the browser to decode a frame before giving up (ms). */
export const POSTER_CAPTURE_TIMEOUT_MS = 8000

/** Options for {@link captureVideoPoster}. */
export interface CaptureVideoPosterOptions {
  /** Aborting rejects with an `AbortError` and releases the element + object URL. */
  readonly signal?: AbortSignal
  /** Override {@link POSTER_CAPTURE_TIMEOUT_MS} (tests; slow-network tuning). */
  readonly timeoutMs?: number
}

/**
 * Captures a poster frame and the video's dimensions/duration. Rejects on a
 * decode failure, an unsupported length, a timeout or an abort (see the module
 * header); never leaves the returned promise pending.
 */
export function captureVideoPoster(
  file: File,
  options: CaptureVideoPosterOptions = {},
): Promise<CapturedVideoPoster> {
  const { signal, timeoutMs = POSTER_CAPTURE_TIMEOUT_MS } = options

  return new Promise<CapturedVideoPoster>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError())
      return
    }

    const objectUrl = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true

    let settled = false

    // Detach everything exactly once: handlers, the timer, the abort listener, the
    // element's source (and stop its in-flight load), and the temporary object URL.
    const release = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      video.onloadedmetadata = null
      video.onseeked = null
      video.onerror = null
      try {
        video.removeAttribute('src')
        video.load()
      } finally {
        // Revoke even if stopping the element's load throws, so the blob is never retained.
        URL.revokeObjectURL(objectUrl)
      }
    }
    // Settles the promise AT MOST once, releasing resources first.
    const finish = (settle: () => void) => {
      if (settled) return
      settled = true
      try {
        release()
      } catch {
        // Teardown is best-effort: even if detaching the element throws, the
        // promise MUST still settle (a hang here would wedge the upload flow).
      }
      settle()
    }
    const fail = (message: string) => finish(() => reject(new Error(message)))
    function onAbort() {
      finish(() => reject(createAbortError()))
    }

    // Declared after the closures that read it, but before anything can call them.
    const timer = setTimeout(() => fail('That video took too long to read.'), timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })

    video.onerror = () => fail('That video could not be read.')

    video.onloadedmetadata = () => {
      const duration = video.duration
      if (!Number.isFinite(duration) || duration <= 0 || duration > MEDIA_MAX_DURATION_SEC) {
        fail('That video has an unsupported length.')
        return
      }
      // Seeking fires `seeked` once a frame is decodable; clamp so a very short
      // clip still seeks inside its own length.
      video.currentTime = Math.min(POSTER_SEEK_SECONDS, duration / 2)
    }

    video.onseeked = () => {
      const width = video.videoWidth
      const height = video.videoHeight
      if (width <= 0 || height <= 0) {
        fail('That video has no readable size.')
        return
      }

      const scale = width > POSTER_MAX_WIDTH ? POSTER_MAX_WIDTH / width : 1
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(width * scale)
      canvas.height = Math.round(height * scale)

      const context = canvas.getContext('2d')
      if (context === null) {
        fail('A poster frame could not be captured.')
        return
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height)

      const durationSec = video.duration
      canvas.toBlob(
        blob => {
          if (blob === null) {
            fail('A poster frame could not be captured.')
            return
          }
          finish(() =>
            resolve({
              poster: blob,
              width,
              height,
              posterWidth: canvas.width,
              posterHeight: canvas.height,
              durationSec,
            }),
          )
        },
        'image/jpeg',
        POSTER_JPEG_QUALITY,
      )
    }

    video.src = objectUrl
  })
}
