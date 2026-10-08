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
 * media LENGTH, not a clock — COR-053 is unaffected).
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
 * World-neutral (`core/`): DOM APIs only, no React, no theme.
 */

/** What {@link captureVideoPoster} resolves with. */
export interface CapturedVideoPoster {
  /** The poster frame, JPEG. */
  readonly poster: Blob
  /** The VIDEO's natural width (not the poster's, which may be downscaled). */
  readonly width: number
  /** The VIDEO's natural height. */
  readonly height: number
  /** Media length in seconds (0 < x <= 3600, the server's accepted range). */
  readonly durationSec: number
}

/** The widest poster we export; larger frames are scaled down proportionally. */
export const POSTER_MAX_WIDTH = 1280

/** Seconds into the clip to take the frame from (clamped for very short clips). */
const POSTER_SEEK_SECONDS = 0.5

/** The server rejects durations over an hour. */
const MAX_DURATION_SEC = 3600

/** JPEG quality of the exported poster. */
const POSTER_JPEG_QUALITY = 0.82

/** Captures a poster frame and the video's dimensions/duration. */
export function captureVideoPoster(file: File): Promise<CapturedVideoPoster> {
  return new Promise<CapturedVideoPoster>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true

    const release = () => {
      video.onloadedmetadata = null
      video.onseeked = null
      video.onerror = null
      video.removeAttribute('src')
      URL.revokeObjectURL(objectUrl)
    }
    const fail = (message: string) => {
      release()
      reject(new Error(message))
    }

    video.onerror = () => fail('That video could not be read.')

    video.onloadedmetadata = () => {
      const duration = video.duration
      if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION_SEC) {
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
          release()
          if (blob === null) {
            reject(new Error('A poster frame could not be captured.'))
            return
          }
          resolve({ poster: blob, width, height, durationSec })
        },
        'image/jpeg',
        POSTER_JPEG_QUALITY,
      )
    }

    video.src = objectUrl
  })
}
