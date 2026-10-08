/**
 * features/social/services/narrowMedia.ts
 * ---------------------------------------------------------------------------
 * The ONE definition of how a wire media item becomes a participant-safe
 * `PostMedia` (XC-002 defence in depth), shared by `postService.toParticipantView`
 * and `ownPostStore.narrowCreatedPost`. A LEAF module (type-only imports) on purpose:
 * `ownPostStore` is reset by `core/auth/endSession`, so it must not pull
 * `postService`'s dependency graph (telemetry, personas, ...) into `core/auth`.
 * Participant world - pure data, no UI.
 */

import type { PostMedia } from '../types/post'

/**
 * Rebuilds one media item from its contract keys only (XC-002 defence in depth).
 * An optional member that is `null` on the wire is DROPPED (treated as absent).
 */
export function narrowMedia(item: PostMedia): PostMedia {
  return {
    id: item.id,
    kind: item.kind,
    url: item.url,
    alt: item.alt,
    ...(item.posterUrl != null ? { posterUrl: item.posterUrl } : {}),
    ...(item.width != null ? { width: item.width } : {}),
    ...(item.height != null ? { height: item.height } : {}),
    ...(item.durationSec != null ? { durationSec: item.durationSec } : {}),
  }
}
