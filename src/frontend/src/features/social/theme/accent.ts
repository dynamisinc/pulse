/**
 * features/social/theme/accent.ts
 * ---------------------------------------------------------------------------
 * Contrast-safe brand accent for the Pulse "Social" skin (demo-polish F5,
 * COR-030 / NFR-001). Pure functions, no React, no theme.
 *
 * WHY THIS EXISTS. The social CSS paints the per-exercise accent (`--pulse-ac`)
 * as TEXT on the light surfaces (hashtags, "Back" links, the Following label,
 * action counts) and as a FILL carrying white text (the Follow button, the "new
 * posts" pill). WCAG 2.1 AA (1.4.3) wants >= 4.5:1 for each. An arbitrary brand
 * colour does not promise that: the unconfigured default brand's amber `#d97706`
 * is 3.2:1 on white and a "Millbrook yellow" is 1.8:1, so wiring the raw brand
 * accent into `--pulse-ac` would trade a legible navy for illegible text.
 *
 * THE BAR IS EVERY DERIVED STATE, NOT JUST "ON WHITE". Clearing 4.5:1 on white
 * leaves the accent short on the surfaces it is actually drawn on. So the accent
 * is measured against ALL of these, and each must be >= {@link MIN_ACCENT_CONTRAST}:
 *   - white canvas                                  (hashtags, links, tab text)
 *   - `--pc-panel`  #f3f5f6                         (accent text on a panel)
 *   - `--pc-hover`  over white  ~#f4f4f5            (action counts on hover/focus)
 *   - white text on the accent FILL after `filter: brightness(1.08)`
 *                                                   (FollowButton `:hover`)
 * A bare "4.5:1 on white" stop is what failed review: amber darkened to exactly
 * 4.5:1 on white (`#b26205`) is 4.14:1 on the panel, 4.12:1 on the hover tint and
 * 3.96:1 as the hovered Follow fill. The binding constraint is usually the
 * brightened fill, so the result lands at roughly 5.2:1 on white.
 *
 * WHAT IT DOES. `accessibleAccent(accent)` returns the accent UNCHANGED when it
 * already clears every state, and otherwise the smallest darkening of the SAME hue
 * (a straight blend toward black) that does. A brand that is already accessible is
 * therefore passed through byte-for-byte; only a failing one is nudged. The nudged
 * colour is what `--pulse-ac` carries everywhere in the social skin, INCLUDING the
 * profile banner tint (the banner reads `--pulse-ac`, so a rebrand recolours it from
 * the one variable). The raw, unadjusted brand colour is still published by the shell
 * as `--pulse-brand-accent` for any consumer that wants it.
 *
 * The verified-mark seal is NOT affected: `VerifiedMark` paints the fixed
 * `SEAL_BLUE` straight from `tokens.ts`, never `--pulse-ac` (D1-003/R-001).
 *
 * Only `#rgb` and `#rrggbb` are parsed (what brand config carries). Any other CSS
 * colour syntax (`rgb()`, `hsl()`, a named colour) cannot be measured here, and an
 * unmeasured accent could ship illegible text, so it FALLS BACK to
 * {@link DEFAULT_ACCENT} (Cadence navy, which clears every state) rather than being
 * passed through unchecked.
 *
 * World: participant. Plain functions.
 */

import { DEFAULT_ACCENT } from './tokens'

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
 * The surfaces accent TEXT is drawn on, as `#rrggbb` values mirroring the social
 * palette: `--pc-panel`, and `--pc-hover` (rgba(14, 21, 24, .045)) composited over
 * white (a hovered/focused action sits on the white canvas). If `social.module.css`
 * changes those, change these.
 */
const TEXT_SURFACES = {
  onWhite: WHITE,
  onPanel: [0xf3, 0xf5, 0xf6] as Rgb,
  onHover: [0xf4, 0xf4, 0xf5] as Rgb,
} as const

/**
 * The ONE hover brightening the social skin may apply to an accent FILL carrying white
 * text: `FollowButton`'s, `NewPostsPill`'s, the nav rail's Post button's and
 * `QuoteComposer`'s `:hover { filter: brightness(1.08) }` (CSS filters work in sRGB).
 * `accessibleAccent` certifies the accent at exactly this value, so a stylesheet that
 * brightens MORE (the nav rail's former 1.12 measured 4.26:1) falls outside the model;
 * `accentHover.guard.test.ts` fails on any `brightness(` above it. Exported for that
 * guard.
 */
export const HOVER_BRIGHTNESS = 1.08

/** The contrast of an accent in each state it is drawn in (see the module header). */
export interface AccentStateContrasts {
  /** Accent text on the white canvas. */
  readonly onWhite: number
  /** Accent text on `--pc-panel`. */
  readonly onPanel: number
  /** Accent text on the hover/focus tint over white. */
  readonly onHover: number
  /** White text on the accent fill once `filter: brightness(1.08)` is applied. */
  readonly hoverFill: number
}

function stateContrasts(rgb: Rgb): AccentStateContrasts {
  const brightened: Rgb = [
    Math.min(255, Math.round(rgb[0] * HOVER_BRIGHTNESS)),
    Math.min(255, Math.round(rgb[1] * HOVER_BRIGHTNESS)),
    Math.min(255, Math.round(rgb[2] * HOVER_BRIGHTNESS)),
  ]
  return {
    onWhite: contrast(rgb, TEXT_SURFACES.onWhite),
    onPanel: contrast(rgb, TEXT_SURFACES.onPanel),
    onHover: contrast(rgb, TEXT_SURFACES.onHover),
    hoverFill: contrast(brightened, WHITE),
  }
}

function worst(contrasts: AccentStateContrasts): number {
  return Math.min(
    contrasts.onWhite,
    contrasts.onPanel,
    contrasts.onHover,
    contrasts.hoverFill,
  )
}

/**
 * The contrast of a `#rgb`/`#rrggbb` accent in every derived state, or `undefined`
 * for syntax it cannot measure. Exported for tests and reporting.
 */
export function accentStateContrasts(color: string): AccentStateContrasts | undefined {
  const rgb = parseHex(color)
  return rgb === undefined ? undefined : stateContrasts(rgb)
}

/**
 * The accent to paint as `--pulse-ac`: `accent` itself when EVERY derived state
 * (see the module header) meets `minRatio`, else the least-darkened same-hue blend
 * toward black that does (lower-case `#rrggbb`). Syntax that cannot be measured
 * falls back to {@link DEFAULT_ACCENT}.
 */
export function accessibleAccent(accent: string, minRatio: number = MIN_ACCENT_CONTRAST): string {
  const rgb = parseHex(accent)
  if (rgb === undefined) return DEFAULT_ACCENT
  if (worst(stateContrasts(rgb)) >= minRatio) return accent

  // 1% steps toward black: fine enough to stay close to the brand hue, and
  // bounded (100 iterations) because pure black clears every state.
  for (let step = 1; step <= 100; step += 1) {
    const k = 1 - step / 100
    // Round BEFORE measuring: the hex we return is what the browser paints.
    const darker: Rgb = [Math.round(rgb[0] * k), Math.round(rgb[1] * k), Math.round(rgb[2] * k)]
    if (worst(stateContrasts(darker)) >= minRatio) return toHex(darker)
  }
  return '#000000'
}
