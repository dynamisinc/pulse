/**
 * features/channels/skin/fonts.ts
 * ---------------------------------------------------------------------------
 * The skin font contract (news FU-4, FC-8a, story 13).
 *
 * A channel supplies its faces from its OWN folder as self-hosted `woff2`
 * files, imported with Vite's `?url` suffix so the build emits them as files
 * under `/assets/` (story 23 keeps fonts out of `data:` URIs):
 *
 *   import oswaldUrl from './fonts/oswald-latin-wght.woff2?url'
 *   registerSkinTokens('newsline7', tokens, {
 *     fonts: [{ family: 'Oswald', src: oswaldUrl, weight: '200 700' }],
 *   })
 *
 * The rules this module enforces:
 *  - **Same origin only.** A `src` must resolve to this page's origin and end
 *    in `.woff2`: no `data:`/`blob:` URI, no third-party CDN. That is what
 *    the CSP `font-src 'self'` (story 23, PP-3) allows, so a face that
 *    passes here is a face the browser will fetch.
 *  - **Lazy.** Registering a face loads nothing. A face is added to
 *    `document.fonts` (and fetched) only when a `SkinScope` using that skin
 *    mounts, once per page.
 *  - **`font-display: swap`.** Text renders in the stack's fallback at once and
 *    swaps when the face arrives; a missing or blocked face simply never
 *    swaps, leaving the generic family every token stack must end with.
 *
 * Token files name font STACKS only (`'Oswald', 'Arial Narrow', sans-serif`);
 * the faces live here.
 */

import { reportSkinIssue } from './report'

/** One self-hosted font face. */
export interface SkinFontFace {
  /** The family name the token stacks use (`'Oswald'`). */
  readonly family: string
  /** The woff2 URL, from `import url from './face.woff2?url'`. */
  readonly src: string
  /** A weight or a variable range (`400`, `'200 700'`). */
  readonly weight?: number | string
  readonly style?: 'normal' | 'italic'
  /** A CSS `unicode-range` (`'U+0000-00FF, U+0131'`). */
  readonly unicodeRange?: string
}

const FAMILY = /^[A-Za-z0-9][A-Za-z0-9 -]{0,63}$/
const WEIGHT = /^\d{1,4}(?: \d{1,4})?$/
const UNICODE_RANGE_PART = /[Uu]\+[0-9A-Fa-f?]{1,6}(?:-[0-9A-Fa-f]{1,6})?/.source
const UNICODE_RANGE = new RegExp(`^${UNICODE_RANGE_PART}(?:\\s*,\\s*${UNICODE_RANGE_PART})*$`)

function pageOrigin(): string {
  return typeof window === 'undefined' ? 'http://localhost' : window.location.origin
}

/**
 * Validates one face. Returns `null` when it is acceptable, or the reason it
 * is not. `origin` defaults to the page's own origin.
 */
export function fontFaceProblem(face: SkinFontFace, origin: string = pageOrigin()): string | null {
  if (!FAMILY.test(face.family)) return `font family "${face.family}" is not a plain family name`
  const src = face.src
  if (/^(data|blob):/i.test(src)) {
    return `font "${face.family}" is a ${src.slice(0, src.indexOf(':'))}: URI; ` +
      'fonts must be self-hosted files (CSP font-src \'self\')'
  }
  if (/[\s"'()\\]/.test(src)) {
    return `font "${face.family}" src contains whitespace, quotes, parentheses or backslashes`
  }
  let url: URL
  try {
    url = new URL(src, origin)
  } catch {
    return `font "${face.family}" has an unparseable src`
  }
  if (url.origin !== origin) {
    return `font "${face.family}" is served from ${url.origin}; fonts must come from this origin ` +
      '(no third-party CDN, CSP font-src \'self\')'
  }
  if (!url.pathname.toLowerCase().endsWith('.woff2')) {
    return `font "${face.family}" is not a .woff2 file`
  }
  if (face.weight !== undefined && !WEIGHT.test(String(face.weight))) {
    return `font "${face.family}" has an invalid weight "${face.weight}"`
  }
  if (face.unicodeRange !== undefined && !UNICODE_RANGE.test(face.unicodeRange.trim())) {
    return `font "${face.family}" has an invalid unicode-range`
  }
  return null
}

/** Faces already handed to `document.fonts`, by identity key. */
const added = new Map<string, FontFace>()

function faceKey(face: SkinFontFace): string {
  return [face.family, face.src, face.weight ?? '', face.style ?? '', face.unicodeRange ?? ''].join('|')
}

/**
 * Adds `faces` to `document.fonts` (once per page) and starts loading them.
 * Called by `SkinScope` on mount, never at registration. A face that fails
 * to load (missing file, blocked by CSP) is reported in dev; the text keeps
 * its fallback family.
 */
export function loadSkinFonts(faces: readonly SkinFontFace[]): void {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return
  for (const face of faces) {
    const key = faceKey(face)
    if (added.has(key)) continue
    const fontFace = new FontFace(face.family, `url("${face.src}") format("woff2")`, {
      display: 'swap',
      ...(face.weight !== undefined ? { weight: String(face.weight) } : {}),
      ...(face.style !== undefined ? { style: face.style } : {}),
      ...(face.unicodeRange !== undefined ? { unicodeRange: face.unicodeRange } : {}),
    })
    added.set(key, fontFace)
    document.fonts.add(fontFace)
    fontFace.load().catch(() => {
      // Free it so a later scope mount can retry (e.g. after a transient network failure).
      added.delete(key)
      document.fonts.delete(fontFace)
      reportSkinIssue(`font-load:${key}`, `font "${face.family}" (${face.src}) failed to load; ` +
        'the stack falls back to its generic family')
    })
  }
}

/** Test-only: forget which faces were added. */
export function resetSkinFontsForTests(): void {
  added.clear()
}
