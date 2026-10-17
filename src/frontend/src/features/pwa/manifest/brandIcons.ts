/**
 * features/pwa/manifest/brandIcons.ts
 * ---------------------------------------------------------------------------
 * Mobile-tablet story 09. Produces the 192 / 512 PNG icons for the brand
 * manifest, entirely client-side (no backend route).
 *
 * Strategy:
 *   1. If the brand has a `logo`, load it (`crossOrigin = "anonymous"`) and draw it
 *      onto a canvas on the brand `surface` color, then export `toDataURL`. A
 *      same-origin logo always works; a cross-origin logo works only if the host
 *      sends CORS headers. If the image fails to load OR the canvas is tainted
 *      (toDataURL throws) we FALL BACK to (2). This is the "same-origin / CORS-safe"
 *      AC; a cross-origin logo without CORS can never be used (NOTE: that case
 *      is what would need a backend proxy route, a Brief C1 rule 1 item).
 *   2. Generated icon: the brand name's first letter on `colors.primary`, text color
 *      chosen by WCAG contrast (white vs near-black, whichever is higher).
 *
 * Icons are data: URLs so they resolve from inside a blob manifest with no
 * origin dependency. Pure helpers (`pickInitial`, `readableTextColor`) are
 * exported for tests; the canvas drawing is behind `IconRenderer` so tests can
 * inject a fake (jsdom has no canvas).
 */
import type { BrandTokens } from '@/features/participant-shell/brandTokens'
import type { ManifestIcon } from './buildManifest'

export const ICON_SIZES = [192, 512] as const

/** First letter/digit of the brand name, upper-cased; "?"-free fallback "E". */
export function pickInitial(name: string): string {
  const match = name.trim().match(/[\p{L}\p{N}]/u)
  return match?.[0] ? match[0].toUpperCase() : 'E'
}

function parseHex(color: string): [number, number, number] | undefined {
  const m = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return undefined
  const digits = m[1] ?? ''
  const h = digits.length === 3 ? digits.split('').map(c => c + c).join('') : digits
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** White or near-black, whichever has the higher WCAG contrast on `background`. */
export function readableTextColor(background: string): string {
  const rgb = parseHex(background)
  if (!rgb) return '#ffffff'
  const l = luminance(rgb)
  const contrastWhite = 1.05 / (l + 0.05)
  const contrastDark = (l + 0.05) / (luminance([28, 28, 28]) + 0.05)
  return contrastWhite >= contrastDark ? '#ffffff' : '#1c1c1c'
}

/** Renders PNG data URLs; injectable so tests need no canvas. */
export interface IconRenderer {
  /** Resolves a data URL, or rejects if the logo is unusable (404, CORS, tainted). */
  renderLogo(src: string, size: number, background: string): Promise<string>
  renderInitial(initial: string, size: number, background: string, foreground: string): string
}

export const canvasIconRenderer: IconRenderer = {
  renderLogo(src, size, background) {
    return new Promise<string>((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = size
          canvas.height = size
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('no 2d context')
          ctx.fillStyle = background
          ctx.fillRect(0, 0, size, size)
          // "contain" inside a 10% safe-zone padding so maskable crops never clip it.
          const box = size * 0.8
          const scale = Math.min(box / img.naturalWidth, box / img.naturalHeight)
          const w = img.naturalWidth * scale
          const h = img.naturalHeight * scale
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
          resolve(canvas.toDataURL('image/png')) // throws SecurityError if tainted
        } catch (err) {
          reject(err instanceof Error ? err : new Error('logo render failed'))
        }
      }
      img.onerror = () => reject(new Error('logo failed to load'))
      img.src = src
    })
  },
  renderInitial(initial, size, background, foreground) {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no 2d context')
    ctx.fillStyle = background
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = foreground
    ctx.font = `700 ${Math.round(size * 0.55)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(initial, size / 2, size / 2 + size * 0.03)
    return canvas.toDataURL('image/png')
  },
}

export interface BrandIconSet {
  readonly icons: readonly ManifestIcon[]
  /** Which source won - useful for tests and the README's cross-origin note. */
  readonly source: 'logo' | 'generated'
  /** The 192px data URL, for `apple-touch-icon` / the tab icon. */
  readonly touchIconHref: string
}

function toIcons(urls: readonly string[]): ManifestIcon[] {
  return urls.map((src, i) => ({
    src,
    sizes: `${ICON_SIZES[i]}x${ICON_SIZES[i]}`,
    type: 'image/png',
    purpose: 'any',
  }))
}

/**
 * Renders the 192 + 512 icons for `brand`. Never throws: logo failure falls back
 * to the generated initial icon; a failed generation (no canvas at all) rejects
 * so the caller can fail closed (no manifest) rather than ship a Pulse icon.
 */
export async function renderBrandIcons(
  brand: BrandTokens,
  renderer: IconRenderer = canvasIconRenderer,
): Promise<BrandIconSet> {
  const logo = brand.logo
  if (logo) {
    try {
      const urls = await Promise.all(
        ICON_SIZES.map(size => renderer.renderLogo(logo.src, size, brand.colors.surface)),
      )
      return { icons: toIcons(urls), source: 'logo', touchIconHref: urls[0] ?? '' }
    } catch {
      // fall through to the generated icon
    }
  }
  const initial = pickInitial(brand.name)
  const fg = readableTextColor(brand.colors.primary)
  const urls = ICON_SIZES.map(size =>
    renderer.renderInitial(initial, size, brand.colors.primary, fg))
  return { icons: toIcons(urls), source: 'generated', touchIconHref: urls[0] ?? '' }
}
