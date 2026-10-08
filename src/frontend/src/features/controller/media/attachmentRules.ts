/**
 * features/controller/media/attachmentRules.ts
 * ---------------------------------------------------------------------------
 * The PURE rules of what a controller may attach to a persona post (demo-polish
 * C1, story 17; SOC-001 "0-4 images OR 1 video", NFR-001, NFR-004). STAFF world
 * (controller console) - no UI, no theme, no React. Shared by the attach tray
 * (`useAttachmentTray`), the library picker (`MediaLibraryPicker`) and the
 * composer hook so the three can never disagree about a limit.
 *
 * THE RULES (mirroring the server's `POST /api/posts` 400s, implementation.md
 * section 1.5.2, so the console refuses BEFORE a round trip):
 *   - at most {@link MAX_IMAGES} images, OR exactly {@link MAX_VIDEOS} video;
 *   - never mixed (image + video);
 *   - every item needs a NON-EMPTY alt text, measured AFTER sanitization (an alt
 *     of only markup counts as empty) and bounded to {@link ALT_MAX_LENGTH};
 *   - an uploaded file passes `validateMediaFile` (size / MIME; the server sniffs
 *     the real type) - its messages already carry the "MP4 (H.264)" hint.
 *
 * Wording is STAFF-facing (plain engineering vocabulary is fine here), unlike the
 * participant composer's in-fiction text. Nothing here reads a clock, a session or
 * the exercise context.
 */

import { validateMediaFile, type MediaKind } from '@/core/media'
import { sanitizeText } from '@/features/social/services/sanitize'

/** Max images per post (SOC-001: "0-4 images OR 1 video"). */
export const MAX_IMAGES = 4

/** Max videos per post. */
export const MAX_VIDEOS = 1

/** Longest accepted alt text (the server accepts 1..1000 after sanitization). */
export const ALT_MAX_LENGTH = 1000

/** Staff wording for the count rules. */
export const MIXED_MEDIA_MESSAGE = 'Attach up to 4 images or 1 video, not both.'
export const TOO_MANY_IMAGES_MESSAGE = `You can attach up to ${MAX_IMAGES} images.`
export const TOO_MANY_VIDEOS_MESSAGE = `You can attach only ${MAX_VIDEOS} video.`

/** How many items of `kind` one post may carry. */
export function kindLimit(kind: MediaKind): number {
  return kind === 'video' ? MAX_VIDEOS : MAX_IMAGES
}

/** The alt text that would actually be sent: sanitized, trimmed, bounded. */
export function effectiveAlt(alt: string): string {
  return sanitizeText(alt).trim().slice(0, ALT_MAX_LENGTH)
}

/**
 * Checks a set of kinds against the count rules; returns the refusal message, or
 * `undefined` when the set is allowed. An empty set is allowed.
 */
export function checkKinds(kinds: readonly MediaKind[]): string | undefined {
  const images = kinds.filter(kind => kind === 'image').length
  const videos = kinds.length - images
  if (images > 0 && videos > 0) return MIXED_MEDIA_MESSAGE
  if (videos > MAX_VIDEOS) return TOO_MANY_VIDEOS_MESSAGE
  if (images > MAX_IMAGES) return TOO_MANY_IMAGES_MESSAGE
  return undefined
}

/** Outcome of validating a picked batch of files. */
export type AttachBatchResult =
  | { readonly ok: true; readonly kinds: readonly MediaKind[] }
  | { readonly ok: false; readonly error: string }

/**
 * Validates a batch of newly picked files, given the kinds already in the tray.
 * Rejects the WHOLE batch on the first failure so a partial, surprising attach
 * never happens: a file that fails `validateMediaFile` (the message names the
 * file), then the count rules (mixed, second video, fifth image).
 *
 * @param files         the newly picked files
 * @param existingKinds the kinds of the items already in the tray
 */
export function validateAttachBatch(
  files: readonly File[],
  existingKinds: readonly MediaKind[],
): AttachBatchResult {
  const kinds: MediaKind[] = []
  for (const file of files) {
    const check = validateMediaFile(file)
    if (!check.ok) return { ok: false, error: `${file.name}: ${check.error}` }
    kinds.push(check.kind)
  }

  const refusal = checkKinds([...existingKinds, ...kinds])
  if (refusal !== undefined) return { ok: false, error: refusal }
  return { ok: true, kinds }
}
