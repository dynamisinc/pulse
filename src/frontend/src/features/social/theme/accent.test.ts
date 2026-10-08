/**
 * features/social/theme/accent.test.ts
 * ---------------------------------------------------------------------------
 * `accessibleAccent` keeps the brand accent legible (NFR-001, WCAG 2.1 AA 1.4.3)
 * in EVERY state the social skin draws it in, not just "on white": an accent that
 * already clears 4.5:1 everywhere is passed through untouched; one that does not is
 * darkened (same hue) just enough to clear every state. The numbers are the real
 * contrast ratios of the colours involved, so a regression in the maths shows up as
 * a wrong ratio, not just a wrong string.
 *
 * Gate-1 H-1: the first version stopped at exactly 4.5:1 ON WHITE, so the default
 * amber `#d97706` -> `#b26205` failed AA in its derived states (3.96:1 as the
 * hovered Follow fill, 4.12:1 for an action count on the hover tint, 4.14:1 on a
 * panel). The derived-state table below is the regression test for that.
 */
import { describe, expect, it } from 'vitest'
import {
  MIN_ACCENT_CONTRAST,
  accentStateContrasts,
  accessibleAccent,
  contrastOnWhite,
  type AccentStateContrasts,
} from './accent'
import { DEFAULT_ACCENT } from './tokens'

/** The ratio of a `#rrggbb` on white, asserted to exist so a bad literal fails loudly. */
function ratio(color: string): number {
  const value = contrastOnWhite(color)
  if (value === undefined) throw new Error(`expected a parseable hex colour, got ${color}`)
  return value
}

/** Every derived state of a colour, asserted to exist. */
function states(color: string): AccentStateContrasts {
  const value = accentStateContrasts(color)
  if (value === undefined) throw new Error(`expected a parseable hex colour, got ${color}`)
  return value
}

/** The weakest of the four derived-state contrasts. */
function worst(color: string): number {
  return Math.min(...Object.values(states(color)))
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

describe('accentStateContrasts', () => {
  it('measures all four states, and the plain-white one agrees with contrastOnWhite', () => {
    const s = states('#1e3a5f')

    expect(Object.keys(s).sort()).toEqual(['hoverFill', 'onHover', 'onPanel', 'onWhite'])
    expect(s.onWhite).toBeCloseTo(ratio('#1e3a5f'), 10)
    // Darker surfaces always read lower than white for a dark accent.
    expect(s.onPanel).toBeLessThan(s.onWhite)
    expect(s.onHover).toBeLessThan(s.onWhite)
  })

  it('reproduces the Gate-1 H-1 numbers for the old "4.5:1 on white" amber (#b26205)', () => {
    const s = states('#b26205')

    expect(s.onWhite).toBeGreaterThanOrEqual(4.5)
    expect(s.onPanel).toBeCloseTo(4.14, 1)
    expect(s.onHover).toBeCloseTo(4.12, 1)
    expect(s.hoverFill).toBeCloseTo(3.96, 1)
    expect(worst('#b26205')).toBeLessThan(MIN_ACCENT_CONTRAST)
  })

  it('returns undefined for syntax it cannot measure', () => {
    expect(accentStateContrasts('crimson')).toBeUndefined()
  })
})

describe('accessibleAccent — every derived state clears 4.5:1', () => {
  // The brands that matter: the demo default (amber), the D1 crimson swatch, a blue like
  // the seal, a light yellow, a vivid magenta, and one that already passes.
  const BRANDS: readonly (readonly [name: string, accent: string])[] = [
    ['amber (the demo default brand)', '#d97706'],
    ['crimson (D1-003 swatch)', '#DB3A54'],
    ['seal-like blue', '#2D9CDB'],
    ['yellow', '#f2b632'],
    ['magenta', '#d946ef'],
    ['teal', '#14b8a6'],
    ['near-white', '#fafafa'],
    ['Cadence navy (already passes)', '#1e3a5f'],
  ]

  it.each(BRANDS)('%s: all four states are >= 4.5:1 after the nudge', (_name, accent) => {
    const out = accessibleAccent(accent)
    const s = states(out)

    expect(s.onWhite).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST)
    expect(s.onPanel).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST)
    expect(s.onHover).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST)
    expect(s.hoverFill).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST)
  })

  it('the demo default amber lands around 5.2:1 on white, not the old 4.5:1', () => {
    const out = accessibleAccent('#d97706')

    expect(out).not.toBe('#d97706')
    expect(out).not.toBe('#b26205') // the Gate-1 H-1 value that failed in its states
    expect(ratio(out)).toBeGreaterThan(5)
    expect(ratio(out)).toBeLessThan(6.5)
    expect(states(out).hoverFill).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST)
  })

  it('keeps the hue: darker amber is still red-dominant orange, not grey', () => {
    const out = accessibleAccent('#d97706')
    const [r, g, b] = [1, 3, 5].map(i => parseInt(out.slice(i, i + 2), 16))

    expect(r).toBeGreaterThan(g ?? 0)
    expect(g).toBeGreaterThan(b ?? 0)
  })

  it('does not over-darken: the weakest state sits just above the bar', () => {
    // 1% steps toward black move the weakest state by well under 0.3 here, so stopping at the
    // first passing step leaves it within that margin of 4.5.
    for (const [, accent] of BRANDS.filter(([, a]) => worst(a) < MIN_ACCENT_CONTRAST)) {
      const out = accessibleAccent(accent)
      expect(worst(out)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST)
      expect(worst(out)).toBeLessThan(MIN_ACCENT_CONTRAST + 0.3)
    }
  })

  it('passes an accent that already clears every state through byte-for-byte', () => {
    for (const accent of ['#1e3a5f', '#0b6e4f', '#6d28d9', '#7a1f3d', '#0b5394']) {
      expect(worst(accent), accent).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST)
      expect(accessibleAccent(accent)).toBe(accent)
    }
  })

  it('also nudges an accent that clears white but fails a derived state', () => {
    // 4.5:1+ on plain white, yet the hovered fill / panel text is short of the bar.
    const borderline = '#b26205'
    expect(ratio(borderline)).toBeGreaterThanOrEqual(4.5)
    expect(worst(borderline)).toBeLessThan(MIN_ACCENT_CONTRAST)

    const out = accessibleAccent(borderline)
    expect(out).not.toBe(borderline)
    expect(worst(out)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST)
  })

  it('fixes a very light brand colour (a yellow is 1.8:1 on white)', () => {
    expect(ratio('#f2b632')).toBeLessThan(2)
    expect(worst(accessibleAccent('#f2b632'))).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST)
  })

  it('terminates on white (nothing lighter exists) with a passing grey', () => {
    expect(worst(accessibleAccent('#fff'))).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST)
  })

  it('accepts #rgb shorthand', () => {
    expect(worst(accessibleAccent('#f80'))).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST)
  })
})

describe('accessibleAccent — unmeasurable syntax falls back to the safe default (L-1)', () => {
  it('uses DEFAULT_ACCENT instead of passing rgb(), hsl() or a named colour through unchecked', () => {
    for (const unmeasurable of ['crimson', 'hsl(10 80% 50%)', 'rgb(255, 255, 0)', '#12345', '']) {
      expect(accessibleAccent(unmeasurable), unmeasurable).toBe(DEFAULT_ACCENT)
    }
  })

  it('and that default clears every state itself', () => {
    expect(worst(DEFAULT_ACCENT)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST)
  })
})
