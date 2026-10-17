/**
 * features/controller/consoleTouchTestUtils.ts
 * ---------------------------------------------------------------------------
 * TEST-ONLY helpers for the story 14 coarse-pointer contracts. Never imported by production code.
 *
 * jsdom does not evaluate media queries, so a "is it 44px under a coarse pointer" test reads the
 * stylesheet Emotion injected and asserts that, INSIDE `@media (pointer: coarse)`, the element's
 * own rule declares the size. That proves the real-layout-space contract (min-width/min-height on
 * the control, not a `::before` slop) and that it is gated on the pointer, not on a width.
 *
 * NOTE: a deliberate small duplicate of `staffShell/tabletTestUtils.ts` (story 13's branch, not
 * mine to import). Unify once #621 merges.
 */

import { vi } from 'vitest'

function safeMatches(el: Element, selector: string): boolean {
  try {
    return el.matches(selector)
  } catch {
    return false
  }
}

/** Declarations that apply to `el` inside any `@media` block containing `mediaFragment`. */
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

/** True when the element's own rules (any media) use a `::before` / `::after` pseudo-element. */
export function hasPseudoHitSlop(el: Element): boolean {
  const cls = Array.from(el.classList).filter(c => c.startsWith('css-'))
  const css = Array.from(document.styleSheets)
    .flatMap(sheet => Array.from(sheet.cssRules))
    .map(rule => rule.cssText)
    .join('\n')
  return cls.some(c => new RegExp(`\\.${c}[^{]*::?(before|after)`).test(css))
}

/** Makes `window.matchMedia` answer `(pointer: coarse)` with `coarse`. Returns a restore fn. */
export function setPointer(coarse: boolean): () => void {
  const original = window.matchMedia
  window.matchMedia = ((query: string): MediaQueryList => ({
    matches: /pointer:\s*coarse/.test(query) ? coarse : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => false,
  } as MediaQueryList)) as typeof window.matchMedia
  return () => {
    window.matchMedia = original
  }
}
