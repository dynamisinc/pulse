/**
 * features/pwa/manifest/buildManifest.ts
 * ---------------------------------------------------------------------------
 * Mobile-tablet story 09 (PWA: per-exercise brand manifest; COR-066/030, XC-002).
 *
 * PURE: turns the resolved exercise brand tokens (+ the app origin + already-
 * rendered icons) into a Web App Manifest object. No DOM, no canvas, no network,
 * so it is trivially unit-testable (see buildManifest.test.ts).
 *
 * Why the origin is a parameter: the manifest is served from a `blob:` URL, and a
 * blob manifest cannot resolve RELATIVE urls, so `start_url` / `scope` (and `id`)
 * MUST be absolute same-origin URLs.
 *
 * Fiction rule (D0 / XC-002): every string in the output comes from the brand
 * (name, colors) or is structural (display mode, urls, icon types). Nothing here
 * says "Pulse" or "Dynamis"; the caller owns the no-leak guarantee for the icons
 * it passes in, and the test asserts it over the serialized JSON.
 *
 * MT-D5: no install telemetry anywhere in this feature.
 */
import type { BrandTokens } from '@/features/participant-shell/brandTokens'

/** One manifest icon entry (already rendered; `src` is a data: or same-origin URL). */
export interface ManifestIcon {
  readonly src: string
  readonly sizes: string
  readonly type: string
  readonly purpose?: string
}

export interface WebAppManifest {
  readonly id: string
  readonly name: string
  readonly short_name: string
  readonly start_url: string
  readonly scope: string
  readonly display: 'standalone'
  readonly theme_color: string
  readonly background_color: string
  readonly icons: readonly ManifestIcon[]
}

/** Installed-app short names truncate around 12 chars on most home screens. */
const SHORT_NAME_MAX = 12

/** Home-screen label: the brand name, trimmed to fit at a word boundary where possible. */
export function shortNameFor(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length <= SHORT_NAME_MAX) return trimmed
  const cut = trimmed.slice(0, SHORT_NAME_MAX)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace >= 4 ? cut.slice(0, lastSpace) : cut).trim()
}

/**
 * Builds the manifest. `origin` is `window.location.origin` (e.g.
 * `https://pulse.example`), without a trailing slash.
 */
export function buildManifest(
  brand: BrandTokens,
  origin: string,
  icons: readonly ManifestIcon[],
): WebAppManifest {
  const root = `${origin.replace(/\/+$/, '')}/`
  const name = brand.name.trim()
  return {
    id: root,
    name,
    short_name: shortNameFor(name),
    start_url: root,
    scope: root,
    display: 'standalone',
    theme_color: brand.colors.primary,
    background_color: brand.colors.surface,
    icons,
  }
}
