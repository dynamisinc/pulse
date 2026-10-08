/**
 * features/social/utils/safeImageUrl.ts
 * ---------------------------------------------------------------------------
 * Allow-list for persona image URLs (`avatarUrl`, `bannerUrl`) before they reach
 * an `<img src>` (demo-polish F5; XC-009 "URLs are opaque").
 *
 * The URLs arrive from `GET /api/personas` (live: an https read SAS; mock: a
 * root-relative `/mock-media/...` path). They are treated as opaque, but an
 * opaque string is still untrusted input, so only these shapes are rendered:
 *   - `https:` / `http:` absolute URLs (local dev serves blobs over http),
 *   - `blob:` object URLs,
 *   - root-relative paths (`/x`), but NOT protocol-relative (`//host/x`).
 * Anything else (`javascript:`, `data:`, `vbscript:`, bare relative, empty) yields
 * `undefined`, and the caller renders its fallback (the monogram/silhouette, or
 * the accent-tint banner) instead of a broken or hostile image.
 *
 * Pure function; participant-world safe (no React, no theme).
 */

/** The URL itself if it is safe to put in an `<img src>`, else `undefined`. */
export function safeImageUrl(url: string | undefined): string | undefined {
  if (url === undefined) return undefined
  const trimmed = url.trim()
  if (trimmed.length === 0) return undefined
  if (/^(https?:|blob:)/i.test(trimmed)) return trimmed
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/\\')) {
    return trimmed
  }
  return undefined
}
