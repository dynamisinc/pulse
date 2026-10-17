/**
 * features/pwa/manifest/ManifestHead.tsx
 * ---------------------------------------------------------------------------
 * Mobile-tablet story 09. Renders nothing; while `brand` is defined it keeps the
 * document head carrying the exercise's installable identity (manifest blob link,
 * apple-* tags, theme-color, title, icon), and tears it down - revoking the blob
 * URL and restoring the neutral head - when `brand` becomes undefined, changes
 * (exercise switch) or the component unmounts (sign-out).
 *
 * FAIL CLOSED: `brand === undefined` (not yet resolved / fetch failed / staff
 * route) => head untouched. Icons render asynchronously; the head is only
 * touched once they are ready, and a stale async result (brand changed meanwhile)
 * is discarded. If icon rendering fails outright we install NOTHING rather than a
 * half-branded or Pulse-branded head.
 *
 * World: participant (document head only; no UI, no COBRA, no MUI).
 */
import { useEffect } from 'react'
import type { BrandTokens } from '@/features/participant-shell/brandTokens'
import { buildManifest } from './buildManifest'
import { renderBrandIcons, type IconRenderer, canvasIconRenderer } from './brandIcons'
import { applyBrandHead } from './headTags'

export interface ManifestHeadProps {
  /** The RESOLVED brand, or undefined to keep the head brand-neutral. */
  brand: BrandTokens | undefined
  /** Active exercise id; makes the manifest `id` per exercise. */
  exerciseId?: string | undefined
  /** Test seam; defaults to the canvas renderer. */
  renderer?: IconRenderer
}

export function ManifestHead({
  brand,
  exerciseId,
  renderer = canvasIconRenderer,
}: ManifestHeadProps) {
  // Primitive deps so a re-created-but-equal token object does not churn blob URLs.
  const name = brand?.name
  const primary = brand?.colors.primary
  const accent = brand?.colors.accent
  const surface = brand?.colors.surface
  const onSurface = brand?.colors.onSurface
  const logoSrc = brand?.logo?.src
  const logoAlt = brand?.logo?.alt

  useEffect(() => {
    if (
      name === undefined || primary === undefined || accent === undefined ||
      surface === undefined || onSurface === undefined
    ) return undefined

    const resolved: BrandTokens = {
      name,
      colors: { primary, accent, surface, onSurface },
      ...(logoSrc !== undefined ? { logo: { src: logoSrc, alt: logoAlt ?? '' } } : {}),
    }
    let cancelled = false
    let restore: (() => void) | undefined

    renderBrandIcons(resolved, renderer)
      .then(iconSet => {
        if (cancelled) return
        const manifest = buildManifest(resolved, window.location.origin, iconSet.icons, exerciseId)
        restore = applyBrandHead({
          manifestJson: JSON.stringify(manifest),
          title: manifest.name,
          themeColor: manifest.theme_color,
          touchIconHref: iconSet.touchIconHref,
        })
      })
      .catch(() => {
        // Icon generation impossible (no canvas): fail closed, install nothing.
      })

    return () => {
      cancelled = true
      restore?.()
    }
  }, [name, primary, accent, surface, onSurface, logoSrc, logoAlt, renderer, exerciseId])

  return null
}
