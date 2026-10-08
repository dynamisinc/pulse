/**
 * features/social/utils/safeImageUrl.ts
 * ---------------------------------------------------------------------------
 * The allow-list in front of every persona `<img src>` (`avatarUrl`, `bannerUrl`;
 * demo-polish F5; XC-009 "URLs are opaque", NFR-004).
 *
 * ONE ALLOW-LIST. This used to be its own, looser copy (any `http:` host, bare
 * relative paths refused). It now DELEGATES to F2's `resolveSafeMediaUrl`
 * (`components/media/safeMediaUrl.ts`), the single list every media `src` in the app
 * passes through, so an avatar and a post photo can never disagree about what is
 * renderable (Gate-1 M-2). That list admits: `https:` URLs (no credentials), same-origin
 * paths (root-relative or document-relative, never protocol-relative or backslash
 * tricks), SAME-ORIGIN `blob:` object URLs, and `http://localhost` / `http://127.0.0.1`
 * in a dev build only. It rejects `javascript:`, `data:`, `vbscript:`, `file:`, other
 * `http:` hosts, embedded credentials, control characters and blanks.
 *
 * A rejected URL yields `undefined`, and the caller renders its fallback (the monogram
 * or silhouette, or the accent-tint banner) instead of a broken or hostile image. An
 * accepted URL is returned unchanged (trimmed), so a SAS signature reaches the browser
 * byte-for-byte.
 *
 * `options` is the same test seam `resolveSafeMediaUrl` has (`allowDevHttp`, `baseUrl`)
 * so a test need not depend on the runner's origin or build mode.
 *
 * Pure function; participant-world safe (no React, no theme).
 */

import { resolveSafeMediaUrl, type SafeMediaUrlOptions } from '../components/media/safeMediaUrl'

/** The URL itself if it is safe to put in an `<img src>`, else `undefined`. */
export function safeImageUrl(
  url: string | undefined,
  options?: SafeMediaUrlOptions,
): string | undefined {
  return resolveSafeMediaUrl(url, options)
}
