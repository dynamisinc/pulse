/**
 * features/participantAdmin/cards/safeQrDataUri.ts
 * ---------------------------------------------------------------------------
 * The allow-list in front of every card QR `<img src>` (NFR-004 content security,
 * EL-12). The card sheet's only image is the QR the SERVER rendered, handed back as an
 * SVG data URI; this module decides whether that string may reach the DOM at all.
 *
 * WHY NOT `resolveSafeMediaUrl`. The app's one media allow-list
 * (`features/social/components/media/safeMediaUrl.ts`) rejects `data:` URLs outright,
 * on purpose: the media pipeline serves files and `blob:` URLs, so a `data:` URL there
 * is always hostile. The QR is the one legitimate `data:` image in the product, and
 * widening that shared list would re-open it for every post and avatar. So this is a
 * deliberately NARROW second gate, scoped to this folder, that admits exactly one shape
 * and nothing else:
 *
 *     data:image/svg+xml;base64,<base64 alphabet only>
 *
 * REJECTED: any other scheme (`javascript:`, `https:`, `blob:`, `file:`), any other
 * media type (`text/html`, `image/png`), a non-base64 payload (`;utf8,<svg ...>` or
 * percent-encoded markup, which is the form most likely to carry a stray `<script>`
 * through a lazy copy/paste), embedded whitespace or control characters, an empty
 * payload, and anything over {@link MAX_QR_DATA_URI_LENGTH}.
 *
 * AN SVG IS NEVER INJECTED AS MARKUP. The accepted string only ever becomes an `<img>`
 * `src`. A browser renders an SVG loaded through `<img>` in a sandbox: no script, no
 * external fetches, no DOM access. There is no `dangerouslySetInnerHTML` anywhere in
 * this folder.
 *
 * The accepted string is returned UNCHANGED: it must reach the browser byte-for-byte
 * as the server minted it, or the QR no longer encodes the link.
 *
 * Pure function. World-neutral: no React, no theme.
 */

/**
 * Upper bound on one QR data URI, in characters. A QRCoder SVG for a ~70-character join
 * URL is a few KB to a few tens of KB; 512 KB is generous headroom and still stops a
 * hostile or broken response from pinning 500 cards of megabytes each in memory.
 */
export const MAX_QR_DATA_URI_LENGTH = 512 * 1024

/** The single accepted shape: an SVG data URI whose payload is base64 and nothing else. */
const QR_DATA_URI = /^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}$/

/**
 * Returns `raw` unchanged when it is a base64 SVG data URI within the size bound, else
 * `undefined`. See the module header for what is admitted and why.
 */
export function resolveSafeQrDataUri(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  if (raw.length === 0 || raw.length > MAX_QR_DATA_URI_LENGTH) return undefined
  return QR_DATA_URI.test(raw) ? raw : undefined
}
