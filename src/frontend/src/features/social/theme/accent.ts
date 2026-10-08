/**
 * features/social/theme/accent.ts
 * ---------------------------------------------------------------------------
 * Contrast-safe brand accent for the Pulse "Social" skin (demo-polish F5,
 * COR-030 / NFR-001). Pure functions, no React, no theme.
 *
 * WHY THIS EXISTS. The social CSS paints the per-exercise accent (`--pulse-ac`)
 * in two ways that WCAG 2.1 AA constrains: as TEXT on the white canvas (hashtags,
 * "Back" links, the Following button label) and as a FILL carrying white text
 * (the Follow button, the "new posts" pill). Both are the same number: the
 * contrast ratio between the accent and white must be >= 4.5:1 (1.4.3). An
 * arbitrary brand colour does not promise that. The unconfigured default brand's
 * amber `#d97706` is 3.2:1 and a "Millbrook yellow" is 1.8:1, so wiring the raw
 * brand accent into `--pulse-ac` would trade a legible navy for illegible text.
 *
 * WHAT IT DOES. `accessibleAccent(accent)` returns the accent UNCHANGED when it
 * already clears {@link MIN_ACCENT_CONTRAST} against white, and otherwise the
 * smallest darkening of the SAME hue (a straight blend toward black) that does.
 * A brand that is already accessible is therefore passed through byte-for-byte;
 * only a failing one is nudged. The raw brand colour stays available untouched
 * as `--pulse-brand-accent` (published by `BrandThemeProvider`), which is the
 * right input for non-text decoration such as the profile banner tint.
 *
 * The verified-mark seal is NOT affected: `VerifiedMark` paints the fixed
 * `SEAL_BLUE` straight from `tokens.ts`, never `--pulse-ac` (D1-003/R-001).
 *
 * Only `#rgb` and `#rrggbb` are parsed (what brand config carries). Any other
 * CSS colour syntax cannot be measured here, so it is returned as given rather
 * than guessed at.
 *
 * World: participant. Plain functions.
 */

/** WCAG 2.1 AA minimum contrast for normal-size text (1.4.3). */
export const MIN_ACCENT_CONTRAST = 4.5

/** The canvas the accent sits on / the text colour that sits on the accent. */
const WHITE: Rgb = [255, 255, 255]

type Rgb = readonly [number, number, number]

/** `#rgb` / `#rrggbb` -> [r, g, b] (0..255), or `undefined` for anything else. */
function parseHex(value: string): Rgb | undefined {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  const digits = match?.[1]
  if (digits === undefined) return undefined
  const full = digits.length === 3
    ? digits.split('').map(d => d + d).join('')
    : digits
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

function toHex([r, g, b]: Rgb): string {
  return '#' + [r, g, b].map(c => Math.round(c).toString(16).padStart(2, '0')).join('')
}

/** WCAG relative luminance of an sRGB colour. */
function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * WCAG contrast ratio between a `#rgb`/`#rrggbb` colour and white, or `undefined`
 * if the colour is not in that syntax. Exported for tests and for any caller that
 * needs to report on a brand colour.
 */
export function contrastOnWhite(color: string): number | undefined {
  const rgb = parseHex(color)
  return rgb === undefined ? undefined : contrast(rgb, WHITE)
}

/**
 * The accent to paint as `--pulse-ac`: `accent` itself when it already meets
 * `minRatio` against white, else the least-darkened same-hue blend toward black
 * that does (lower-case `#rrggbb`). Unparseable input is returned unchanged.
 */
export function accessibleAccent(accent: string, minRatio: number = MIN_ACCENT_CONTRAST): string {
  const rgb = parseHex(accent)
  if (rgb === undefined) return accent
  if (contrast(rgb, WHITE) >= minRatio) return accent

  // 1% steps toward black: fine enough to stay close to the brand hue, and
  // bounded (100 iterations) because pure black is 21:1.
  for (let step = 1; step <= 100; step += 1) {
    const k = 1 - step / 100
    // Round BEFORE measuring: the hex we return is what the browser paints.
    const darker: Rgb = [Math.round(rgb[0] * k), Math.round(rgb[1] * k), Math.round(rgb[2] * k)]
    if (contrast(darker, WHITE) >= minRatio) return toHex(darker)
  }
  return '#000000'
}
