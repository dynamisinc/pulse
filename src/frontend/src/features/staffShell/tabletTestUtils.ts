/**
 * features/staffShell/tabletTestUtils.ts
 * ---------------------------------------------------------------------------
 * TEST-ONLY helpers for the story 13 (mobile-tablet, staff shell at tablet sizes) suites. Never
 * imported by production code.
 *
 *  - {@link setViewport} installs a `window.matchMedia` that answers the `(max-width: Npx)` and
 *    `(pointer: coarse)` queries the shell's `useMediaQuery` calls ask, for a given width. jsdom
 *    has
 *    no `matchMedia`, which is why the un-mocked header renders the DESKTOP layout (the existing
 *    desktop tests rely on that).
 *  - {@link mediaRuleDeclarations} is the "CSS contract" half of the coarse-pointer tests: jsdom
 *    does
 *    not evaluate media queries, so instead of asking "is it 44px right now" we read the stylesheet
 *    Emotion injected and assert that, INSIDE the `@media (pointer: coarse)` block, the element's
 *    own rule declares the 44px size. That proves the real-layout-space contract (a width/height
 *    on the element, not a `::before` slop) and that it is gated on the pointer, not on width.
 */

/** Installs a matchMedia stub for `width` (optionally a coarse pointer). Returns a restore fn. */
export function setViewport(width: number, opts: { coarse?: boolean } = {}): () => void {
  const original = window.matchMedia
  window.matchMedia = ((query: string): MediaQueryList => {
    const max = /\(max-width:\s*([\d.]+)px\)/.exec(query)
    const min = /\(min-width:\s*([\d.]+)px\)/.exec(query)
    let matches = true
    if (max) matches = matches && width <= Number(max[1])
    if (min) matches = matches && width >= Number(min[1])
    if (/pointer:\s*coarse/.test(query)) matches = matches && opts.coarse === true
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    } as MediaQueryList
  }) as typeof window.matchMedia
  return () => {
    window.matchMedia = original
  }
}

/** `el.matches` that treats a selector jsdom cannot parse as a non-match. */
function safeMatches(el: Element, selector: string): boolean {
  try {
    return el.matches(selector)
  } catch {
    return false
  }
}

/**
 * The declarations that apply to `el` inside any `@media` block whose condition contains
 * `mediaFragment` (e.g. `'pointer: coarse'`), flattened to `{ property: value }`.
 */
export function mediaRuleDeclarations(el: Element, mediaFragment: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (!(rule instanceof CSSMediaRule)) continue
      if (!rule.media.mediaText.includes(mediaFragment)) continue
      for (const inner of Array.from(rule.cssRules)) {
        if (!(inner instanceof CSSStyleRule)) continue
        if (!safeMatches(el, inner.selectorText)) continue
        for (let i = 0; i < inner.style.length; i += 1) {
          const prop = inner.style.item(i)
          out[prop] = inner.style.getPropertyValue(prop)
        }
      }
    }
  }
  return out
}

/** The declarations from top-level (non-@media) rules that match `el`, flattened (later wins). */
export function ruleDeclarations(el: Element): Record<string, string> {
  const out: Record<string, string> = {}
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (!(rule instanceof CSSStyleRule)) continue
      if (!safeMatches(el, rule.selectorText)) continue
      for (let i = 0; i < rule.style.length; i += 1) {
        const prop = rule.style.item(i)
        out[prop] = rule.style.getPropertyValue(prop)
      }
    }
  }
  return out
}

/** True when an Emotion class on `el` has a `::before` / `::after` rule (a hit-slop pseudo-element). */
export function hasPseudoHitSlop(el: Element): boolean {
  const classes = Array.from(el.classList).filter(c => c.startsWith('css-'))
  const css = Array.from(document.styleSheets)
    .flatMap(sheet => Array.from(sheet.cssRules))
    .map(rule => rule.cssText)
    .join('\n')
  return classes.some(c => new RegExp(`\\.${c}[^{]*::?(before|after)`).test(css))
}
