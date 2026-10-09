/**
 * src/test/contrast.ts
 * ---------------------------------------------------------------------------
 * TEST-ONLY helper: WCAG 2.1 contrast arithmetic for `#rrggbb` colours, so a
 * stylesheet guard can COMPUTE a ratio from the colour it just read off disk instead
 * of asserting a hand-typed number (an "eyeballed" ratio is how 4.24:1 shipped as
 * "amber, fine"). Pure functions; no DOM, no theme.
 *
 * Thresholds, for callers: normal text 4.5 (1.4.3); non-text UI components and
 * graphical objects 3 (1.4.11).
 *
 * Never import this from non-test code. (`features/social/theme/accent.ts` keeps its own
 * private copy of this arithmetic: it is production code and must not depend on `test/`.)
 */

export type Rgb = readonly [number, number, number]

/** `#rrggbb` -> [r, g, b]; throws on anything else (a guard must not guess). */
export function hexToRgb(hex: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  const digits = match?.[1]
  if (digits === undefined) throw new Error(`contrast: expected #rrggbb, got "${hex}"`)
  return [
    parseInt(digits.slice(0, 2), 16),
    parseInt(digits.slice(2, 4), 16),
    parseInt(digits.slice(4, 6), 16),
  ]
}

/** WCAG relative luminance. */
export function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** WCAG contrast ratio between two `#rrggbb` colours (order does not matter). */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(hexToRgb(a))
  const lb = luminance(hexToRgb(b))
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** The colour after CSS `filter: brightness(factor)` (sRGB channels scaled and clamped). */
export function brightened(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex).map(c => Math.min(255, Math.round(c * factor)))
  return '#' + [r, g, b].map(c => (c ?? 0).toString(16).padStart(2, '0')).join('')
}
