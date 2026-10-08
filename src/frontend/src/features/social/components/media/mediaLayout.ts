/**
 * features/social/components/media/mediaLayout.ts
 * ---------------------------------------------------------------------------
 * Pure layout helpers shared by the image grid, the video player and the
 * profile media tab (demo-polish F2). No React, no DOM.
 *
 * The aspect ratio is derived from the contract's `width`/`height` BEFORE the
 * bytes arrive, so the box is reserved up front and nothing shifts when the
 * image/poster loads (no layout shift in a 120-posts/min feed, SOC-071).
 */

/** Fallback when the contract carries no (valid) dimensions: 16:9. */
export const DEFAULT_ASPECT_RATIO = 16 / 9

/** The narrowest a single media box may get: 4:5 portrait (the X clamp). */
export const MIN_ASPECT_RATIO = 4 / 5

/** The widest a single media box may get: 16:9. */
export const MAX_ASPECT_RATIO = 16 / 9

/** Skip-forward / skip-back step for the player's ←/→ keys, in seconds. */
export const SEEK_STEP_SECONDS = 5

/** Most images a post shows in the grid (contract: <=4 images OR exactly 1 video). */
export const MAX_GRID_IMAGES = 4

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * The CSS `aspect-ratio` (width / height) for ONE image or video: the natural
 * ratio clamped to 4:5 ... 16:9, or 16:9 when the dimensions are missing/invalid.
 */
export function singleMediaAspectRatio(width?: number, height?: number): number {
  if (!isPositiveFinite(width) || !isPositiveFinite(height)) return DEFAULT_ASPECT_RATIO
  return Math.min(MAX_ASPECT_RATIO, Math.max(MIN_ASPECT_RATIO, width / height))
}

/**
 * The accessible text for a media item. The contract makes `alt` REQUIRED (NFR-001),
 * but a legacy entry or a malformed one must never yield an EMPTY `alt` attribute —
 * so this falls back to a neutral description of the kind.
 */
export function mediaAlt(item: { readonly alt?: unknown; readonly kind?: unknown }): string {
  if (typeof item.alt === 'string' && item.alt.trim() !== '') return item.alt
  return item.kind === 'video' ? 'Video attached to this post' : 'Photo attached to this post'
}
