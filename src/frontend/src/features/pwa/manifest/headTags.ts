/**
 * features/pwa/manifest/headTags.ts
 * ---------------------------------------------------------------------------
 * Mobile-tablet story 09. Imperative, reversible <head> mutation for the brand
 * PWA identity. Kept out of React so it is testable with plain DOM and so the
 * cleanup contract is one function: `applyBrandHead()` returns a `restore()`
 * that puts the head back EXACTLY as it was (brand-neutral `index.html`).
 *
 * Tags managed (all marked `data-brand-pwa` so we only ever remove our own):
 *   <link rel="manifest" href="blob:...">     (the generated manifest)
 *   <link rel="apple-touch-icon" href="data:image/png...">
 *   <meta name="apple-mobile-web-app-title">  (brand name)
 *   <meta name="apple-mobile-web-app-capable" content="yes">
 * And, because the static head carries Pulse identity (MT / story AC: no "Pulse"
 * or the Pulse favicon once a brand resolves), temporarily overridden then
 * restored:
 *   document.title, <meta name="theme-color">, <link rel="icon">.
 *
 * `restore()` also revokes the blob URL (no leaked object URLs when the exercise
 * switches or the participant signs out).
 */

const MARK = 'data-brand-pwa'

export interface BrandHeadSpec {
  readonly manifestJson: string
  readonly title: string
  readonly themeColor: string
  readonly touchIconHref: string
  /** Brand-neutral description/author (the brand name); never the static Pulse/Dynamis copy. */
  readonly description?: string
}

function ownedTags(): Element[] {
  return Array.from(document.head.querySelectorAll(`[${MARK}]`))
}

/** Removes any tags we added (idempotent); used by restore and as a safety net. */
export function removeBrandHeadTags(): void {
  ownedTags().forEach(el => el.remove())
}

function addTag(tag: 'link' | 'meta', attrs: Record<string, string>): void {
  const el = document.createElement(tag)
  el.setAttribute(MARK, '')
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v))
  document.head.appendChild(el)
}

/** Applies the brand head and returns the function that fully reverses it. */
export function applyBrandHead(spec: BrandHeadSpec): () => void {
  removeBrandHeadTags()

  const blobUrl = URL.createObjectURL(
    new Blob([spec.manifestJson], { type: 'application/manifest+json' }),
  )

  const previousTitle = document.title
  document.title = spec.title

  const themeMeta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  const previousTheme = themeMeta?.getAttribute('content') ?? null
  themeMeta?.setAttribute('content', spec.themeColor)
  if (!themeMeta) addTag('meta', { name: 'theme-color', content: spec.themeColor })

  // description + author carry static product copy: override while branded, restore after.
  const overridden = (['description', 'author'] as const).map(name => {
    const el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
    const prev = el?.getAttribute('content') ?? null
    el?.setAttribute('content', spec.description ?? spec.title)
    return { el, prev }
  })

  // Hide the neutral Pulse favicon behind the brand icon for the session.
  const iconLinks = Array.from(
    document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"]:not([data-brand-pwa])'),
  )
  const previousIconHrefs = iconLinks.map(l => l.getAttribute('href'))
  iconLinks.forEach(l => {
    l.setAttribute('href', spec.touchIconHref)
    l.setAttribute('type', 'image/png')
  })

  addTag('link', { rel: 'manifest', href: blobUrl })
  addTag('link', { rel: 'apple-touch-icon', href: spec.touchIconHref })
  addTag('meta', { name: 'apple-mobile-web-app-title', content: spec.title })
  addTag('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' })

  return () => {
    removeBrandHeadTags()
    URL.revokeObjectURL(blobUrl)
    document.title = previousTitle
    overridden.forEach(({ el, prev }) => {
      if (el && prev !== null) el.setAttribute('content', prev)
    })
    if (themeMeta && previousTheme !== null) themeMeta.setAttribute('content', previousTheme)
    iconLinks.forEach((l, i) => {
      const href = previousIconHrefs[i] ?? null
      if (href === null) l.removeAttribute('href')
      else l.setAttribute('href', href)
      l.setAttribute('type', 'image/svg+xml')
    })
  }
}
