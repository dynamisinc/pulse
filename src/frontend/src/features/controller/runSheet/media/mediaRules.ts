/**
 * features/controller/runSheet/media/mediaRules.ts
 * ---------------------------------------------------------------------------
 * The attachment rule of a scripted post, applied CLIENT-SIDE from the asset KIND
 * the media library reports (inject-queue story 07; story 06: "<= 4 images OR
 * exactly 1 video, never mixed"). STAFF world, no UI, no React.
 *
 *   - up to `INJECT_LIMITS.mediaMax` (4) images; or
 *   - exactly ONE video, on its own.
 *
 * A pasted media id that is not in the library has an `unknown` kind: it counts
 * toward the limit and cannot be added next to a video, but whether it IS an image
 * or a video is the server's call (it answers a mix with a 400 on the field).
 */

import { INJECT_LIMITS } from '../injectRules'

/** What an attached (or candidate) asset is, as far as the console can tell. */
export type AttachKind = 'image' | 'video' | 'unknown'

/**
 * Why `candidate` cannot be attached next to `attached`, or `undefined` when it can.
 * The text is shown beside the control (never colour alone, NFR-001).
 */
export function attachReason(
  candidate: AttachKind,
  attached: readonly AttachKind[],
): string | undefined {
  if (attached.includes('video')) return 'A video must be the only attachment'
  if (candidate === 'video' && attached.length > 0) {
    return "A video can't be mixed with other media"
  }
  if (attached.length >= INJECT_LIMITS.mediaMax) {
    return `Limit of ${INJECT_LIMITS.mediaMax} reached`
  }
  return undefined
}

/**
 * A URL safe to put in an `<img src>`: http(s), a same-origin path, or a blob (a mock
 * upload's object URL). Anything else (`javascript:`, `data:` ...) is not rendered.
 */
export function safeImageUrl(url: string | undefined): string | undefined {
  return url !== undefined && /^(https?:\/\/|\/(?!\/)|blob:)/i.test(url) ? url : undefined
}
