/**
 * features/social/theme/accent.test.ts
 * ---------------------------------------------------------------------------
 * `accessibleAccent` keeps the brand accent legible (NFR-001, WCAG 2.1 AA 1.4.3):
 * an accent that already clears 4.5:1 on white is passed through untouched; one
 * that does not is darkened (same hue) just enough to clear it. The numbers below
 * are the real contrast ratios of the colours involved, so a regression in the
 * maths shows up as a wrong ratio, not just a wrong string.
 */
import { describe, expect, it } from 'vitest'
import { MIN_ACCENT_CONTRAST, accessibleAccent, contrastOnWhite } from './accent'

/** The ratio of a `#rrggbb`, asserted to exist so a bad literal fails loudly. */
function ratio(color: string): number {
  const value = contrastOnWhite(color)
  if (value === undefined) throw new Error(`expected a parseable hex colour, got ${color}`)
  return value
}

describe('contrastOnWhite', () => {
  it('reports the known WCAG ratios', () => {
    expect(ratio('#ffffff')).toBeCloseTo(1, 5)
    expect(ratio('#000000')).toBeCloseTo(21, 5)
    // The unconfigured default brand's amber: below AA for text (3.2:1).
    expect(ratio('#d97706')).toBeCloseTo(3.19, 1)
    // Cadence navy, the social default accent: comfortably AAA.
    expect(ratio('#1e3a5f')).toBeGreaterThan(10)
  })

  it('accepts #rgb shorthand and returns undefined for syntax it cannot measure', () => {
    expect(ratio('#000')).toBeCloseTo(21, 5)
    expect(contrastOnWhite('crimson')).toBeUndefined()
    expect(contrastOnWhite('rgb(0, 0, 0)')).toBeUndefined()
    expect(contrastOnWhite('#12345')).toBeUndefined()
  })
})

describe('accessibleAccent', () => {
  it('passes an already-accessible accent through byte-for-byte', () => {
    for (const accent of ['#1e3a5f', '#C9184A', '#0b6e4f', '#6d28d9']) {
      expect(ratio(accent)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST)
      expect(accessibleAccent(accent)).toBe(accent)
    }
  })

  it('darkens the default brand amber until it clears 4.5:1, staying amber', () => {
    const out = accessibleAccent('#d97706')

    expect(out).not.toBe('#d97706')
    expect(ratio(out)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST)
    // Same hue family: still red-dominant orange, not grey.
    const [r, g, b] = [1, 3, 5].map(i => parseInt(out.slice(i, i + 2), 16))
    expect(r).toBeGreaterThan(g ?? 0)
    expect(g).toBeGreaterThan(b ?? 0)
  })

  it('does not over-darken: the result sits just above the 4.5:1 bar', () => {
    // 1% steps toward black move the ratio by well under 0.2 here, so stopping at
    // the first passing step leaves the result within that margin of the bar.
    for (const accent of ['#d97706', '#DB3A54', '#f2b632']) {
      const out = ratio(accessibleAccent(accent))
      expect(out).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST)
      expect(out).toBeLessThan(MIN_ACCENT_CONTRAST + 0.2)
    }
  })

  it('fixes a very light brand colour (a yellow is 1.8:1 on white)', () => {
    expect(ratio('#f2b632')).toBeLessThan(2)
    expect(ratio(accessibleAccent('#f2b632'))).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST)
  })

  it('handles the curated crimson swatch (4.43:1, just under AA)', () => {
    expect(ratio('#DB3A54')).toBeLessThan(MIN_ACCENT_CONTRAST)
    expect(ratio(accessibleAccent('#DB3A54'))).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST)
  })

  it('terminates on white (nothing lighter exists) with a passing grey', () => {
    expect(ratio(accessibleAccent('#fff'))).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST)
  })

  it('returns syntax it cannot measure unchanged rather than guessing', () => {
    expect(accessibleAccent('crimson')).toBe('crimson')
    expect(accessibleAccent('hsl(10 80% 50%)')).toBe('hsl(10 80% 50%)')
  })
})
