/**
 * features/channels/skin/contrast.ts
 * ---------------------------------------------------------------------------
 * The a11y floor for skin palettes (NFR-001, D3-P2 CANNOT list): WCAG 2.1
 * relative luminance and contrast ratio, the palette pairs every skin must
 * meet, and the clamp that enforces them.
 *
 * The floor is applied by `SkinScope` to EVERY token set it mounts (a token
 * file, a token file plus overrides, or a token object handed straight in),
 * so no registration, override or caller can opt out of it. A violating pair
 * is clamped to the neutral fallback's colours and reported in dev; the
 * clamped palette is what renders.
 *
 * World: participant. Pure functions.
 */

import type { OutletSkinPalette, PaletteKey } from './schema'

/** WCAG 2.1 AA thresholds. */
export const AA_BODY = 4.5
export const AA_LARGE = 3

/** Parses `#rgb` / `#rrggbb` into 0..255 channels, or `null`. */
export function parseHex(color: string): [number, number, number] | null {
  const digits = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1]
  if (digits === undefined) return null
  const hex = digits.length === 3 ? digits.split('').map(c => c + c).join('') : digits
  const channel = (i: number) => parseInt(hex.slice(i, i + 2), 16)
  return [channel(0), channel(2), channel(4)]
}

/** WCAG 2.1 relative luminance of a hex colour (0..1); `NaN` when unparseable. */
export function relativeLuminance(color: string): number {
  const rgb = parseHex(color)
  if (!rgb) return Number.NaN
  const linear = (channel: number) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2])
}

/** WCAG 2.1 contrast ratio (1..21); `0` when either colour is unparseable. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  if (Number.isNaN(la) || Number.isNaN(lb)) return 0
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Black or white, whichever reads better on `background`. Either one always
 * clears 4.5:1 against some colour (the worse case is ~4.58:1), so text on an
 * accent or breaking fill is AA by construction and no token can break it.
 */
export function onColor(background: string): '#000000' | '#ffffff' {
  return contrastRatio('#000000', background) >= contrastRatio('#ffffff', background)
    ? '#000000'
    : '#ffffff'
}

/** One foreground/background pair the floor checks. */
export interface ContrastPair {
  readonly fg: PaletteKey
  readonly bg: PaletteKey
  readonly min: number
  readonly why: string
}

/**
 * Every palette pair a layout may render. Background-first order, so a clamp
 * of `bg` happens before the pairs that depend on it. `accent` and
 * `breaking` are fills and large/UI marks (3:1, WCAG 1.4.11 / 1.4.3 large);
 * text on them uses the derived `onColor`, never a token. `rule` is a
 * decorative separator and is not checked.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { fg: 'text', bg: 'bg', min: AA_BODY, why: 'body text on the page' },
  { fg: 'link', bg: 'bg', min: AA_BODY, why: 'links on the page' },
  { fg: 'accent', bg: 'bg', min: AA_LARGE, why: 'accent marks and large text on the page' },
  { fg: 'breaking', bg: 'bg', min: AA_LARGE, why: 'the breaking banner fill on the page' },
  { fg: 'text', bg: 'surface', min: AA_BODY, why: 'body text on a surface' },
  { fg: 'link', bg: 'surface', min: AA_BODY, why: 'links on a surface' },
]

/** The result of applying the floor to a palette. */
export interface ContrastFloorResult {
  readonly palette: OutletSkinPalette
  /** One line per pair that was clamped (empty when the palette was already AA). */
  readonly violations: readonly string[]
}

function failing(palette: OutletSkinPalette): ContrastPair[] {
  return CONTRAST_PAIRS.filter(p => contrastRatio(palette[p.fg], palette[p.bg]) < p.min)
}

/**
 * Clamps `palette` to the AA floor using `fallback` (the screened neutral
 * palette): a failing pair first takes the fallback's foreground, then, if it
 * still fails, the fallback's background too. If the clamped palette still
 * fails anywhere (a bg clamp can break an earlier pair), the whole fallback
 * palette is used. The fallback must itself pass every pair.
 */
export function applyContrastFloor(
  palette: OutletSkinPalette,
  fallback: OutletSkinPalette,
): ContrastFloorResult {
  const violations: string[] = []
  const next: Record<PaletteKey, string> = { ...palette }

  for (const pair of CONTRAST_PAIRS) {
    const ratio = contrastRatio(next[pair.fg], next[pair.bg])
    if (ratio >= pair.min) continue
    violations.push(
      `${pair.fg} ${next[pair.fg]} on ${pair.bg} ${next[pair.bg]} is ${ratio.toFixed(2)}:1, ` +
      `below ${pair.min}:1 (${pair.why})`,
    )
    next[pair.fg] = fallback[pair.fg]
    if (contrastRatio(next[pair.fg], next[pair.bg]) < pair.min) next[pair.bg] = fallback[pair.bg]
  }

  if (failing(next).length > 0) {
    violations.push('the clamped palette still failed; using the neutral palette')
    return { palette: fallback, violations }
  }
  return { palette: next, violations }
}
