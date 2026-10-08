/**
 * features/social/components/media/safeMediaUrl.ts
 * ---------------------------------------------------------------------------
 * The ONE allow-list every media `src` passes through before it reaches the DOM
 * (demo-polish F2; NFR-004 content security, COR-002, XC-009). A `PostMedia.url`
 * / `posterUrl` / `linkPreview.imageUrl` is an opaque string that arrived over
 * the wire (or from a mock); this module decides whether it may be rendered as
 * an `<img src>` / `<video src>` / `poster`. Anything it rejects is DROPPED and
 * the caller shows the accessible alt-text placeholder instead — a hostile or
 * malformed URL never becomes a request, and never a script.
 *
 * ALLOWED
 *   - `https:` absolute URLs (the SAS read URLs the media pipeline mints);
 *   - same-origin paths (`/mock-media/...`, `media/x.png`) — but NOT
 *     protocol-relative (`//host/x`) or backslash tricks (`/\host/x`), which
 *     resolve to another origin and are caught by the origin comparison;
 *   - `blob:` object URLs (the mock upload adapter / optimistic previews);
 *   - `http://localhost` and `http://127.0.0.1` ONLY in a dev build (Azurite,
 *     the Vite dev server) — never in production.
 *
 * REJECTED (non-exhaustive): `javascript:`, `data:` (the mock set is served as
 * files under `/mock-media` + `blob:`, so there is no legitimate `data:` URL),
 * `vbscript:`, `file:`, `ftp:`, plain `http:` to any other host, URLs with
 * embedded credentials (`https://user:pw@host`), URLs containing control
 * characters (the `java\tscript:` trick — browsers strip tabs/newlines inside
 * a URL, so we refuse them outright), empty/non-string input.
 *
 * The accepted string is returned UNCHANGED (trimmed only): a SAS URL's signature
 * must reach the browser byte-for-byte as the server minted it.
 *
 * World-neutral, pure functions: no React, no theme.
 */

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
const DEV_HTTP_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1'])

/** Test seam: overrides for the environment-derived inputs. */
export interface SafeMediaUrlOptions {
  /** Whether `http://localhost` / `http://127.0.0.1` are allowed. Defaults to a dev build. */
  readonly allowDevHttp?: boolean
  /** The page origin same-origin paths resolve against. Defaults to `window.location`. */
  readonly baseUrl?: string
}

/**
 * Returns `raw` (trimmed) when it is safe to render as a media `src`, else
 * `undefined`. See the module header for the allow-list.
 */
export function resolveSafeMediaUrl(
  raw: unknown,
  options: SafeMediaUrlOptions = {},
): string | undefined {
  if (typeof raw !== 'string') return undefined
  const candidate = raw.trim()
  if (candidate.length === 0 || CONTROL_CHARS.test(candidate)) return undefined

  const allowDevHttp = options.allowDevHttp ?? import.meta.env.DEV
  const baseUrl = options.baseUrl ?? window.location.href

  let parsed: URL
  let base: URL
  try {
    base = new URL(baseUrl)
    parsed = new URL(candidate, base)
  } catch {
    return undefined
  }

  if (HAS_SCHEME.test(candidate)) {
    // An absolute URL. The credentials check applies to the network schemes only.
    switch (parsed.protocol) {
      case 'https:':
        return parsed.username === '' && parsed.password === '' ? candidate : undefined
      case 'blob:':
        return candidate
      case 'http:':
        return allowDevHttp && DEV_HTTP_HOSTS.has(parsed.hostname)
          && parsed.username === '' && parsed.password === ''
          ? candidate
          : undefined
      default:
        return undefined
    }
  }

  // Scheme-less: only a genuine same-origin path qualifies. `//host/x` and `/\host/x`
  // parse to a different origin, so the comparison rejects them.
  return parsed.origin === base.origin ? candidate : undefined
}

/** True when {@link resolveSafeMediaUrl} accepts `raw`. */
export function isSafeMediaUrl(raw: unknown, options?: SafeMediaUrlOptions): boolean {
  return resolveSafeMediaUrl(raw, options) !== undefined
}

/**
 * Appends the media-fragment `#t=0.1` so a poster-less `<video preload="metadata">`
 * paints its first frame (Safari shows nothing for a metadata-only video without a
 * time hint). Leaves a URL that already carries a fragment untouched.
 */
export function withFirstFrameHint(url: string): string {
  return url.includes('#') ? url : `${url}#t=0.1`
}
