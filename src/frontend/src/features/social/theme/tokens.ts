/**
 * features/social/theme/tokens.ts
 * ---------------------------------------------------------------------------
 * The Pulse "Social" (D1) design-token set, as typed JS/TS constants.
 *
 * Two things read these values:
 *  1. Component logic that needs a token as DATA, not CSS — chiefly
 *     `VerifiedMark` (its seal fill must be the fixed `SEAL_BLUE`, never the
 *     themed accent) and tests that assert on that fixed color.
 *  2. `./social.module.css`, which hand-mirrors the same light/dark palette
 *     values as CSS custom properties (a CSS Module cannot `import` a `.ts`
 *     file's values directly). If you change a color here, change the
 *     matching value in `social.module.css` too — the two are kept in sync by
 *     convention, not by tooling.
 *
 * Source: `docs/design/D1-social-app/README.md` "Design Tokens" +
 * `docs/design/DECISIONS.md` D1-003/R-001 (verified seal is FIXED, never
 * themed) and R-004 (avatar treatment). All colors here are copied verbatim
 * from that token set.
 *
 * World: participant (Pulse skin). Plain constants — no CSS-in-JS, no MUI, no
 * COBRA. `ACCENT_CSS_VAR` documents the var components read for the
 * per-exercise accent (COR-030); nothing in this module ever hardcodes an
 * accent color as a *default fallback other than DEFAULT_ACCENT* — components
 * must read `var(--pulse-ac, <fallback>)`, never a bare accent value.
 */

/**
 * The verified-mark seal color (SOC-052, D1-003, R-001). FIXED — independent
 * of the per-exercise accent theme. Rebranding an exercise must never alter
 * this trust signal. `VerifiedMark` uses this directly as an SVG `fill`, not
 * a CSS variable, so no ancestor styling can ever override it.
 */
export const SEAL_BLUE = '#2D9CDB'

/**
 * The CSS custom property components read for the per-exercise accent
 * (COR-030). Never hardcode an accent color directly — read
 * `var(${ACCENT_CSS_VAR}, ${DEFAULT_ACCENT})` so a later `BrandThemeProvider`
 * can rebrand the whole surface by setting this one variable.
 */
export const ACCENT_CSS_VAR = '--pulse-ac'

/** Default accent when no ancestor sets `--pulse-ac` — Cadence navy (D1-001). */
export const DEFAULT_ACCENT = '#1e3a5f'

/** Type stack: Figtree with a system-ui/sans-serif fallback chain. */
export const FONT_FAMILY = "'Figtree', system-ui, sans-serif"

/** Default avatar diameter, in px (R-004; matches the D1 42px post-card avatar). */
export const AVATAR_SIZE = 42

/** Default verified-mark size, in px, at the post-card scale. */
export const VERIFIED_MARK_SIZE = 16

/** Corner radii tokens (media/cards vs. pill-shaped controls). */
export const RADII = {
  media: '14px',
  pill: '999px',
} as const

/** Type-scale tokens for post-card copy. */
export const TYPE_SCALE = {
  postText: '15px',
  postLineHeight: 1.4,
  nameWeight: 700,
  metaSize: '14px',
} as const

/** One color mode's palette (light or dark). */
export interface SocialPalette {
  readonly bg: string
  readonly panel: string
  readonly line: string
  readonly ink: string
  readonly inkMuted: string
  readonly hover: string
}

/** Light-mode palette (default). */
export const LIGHT_PALETTE: SocialPalette = {
  bg: '#fff',
  panel: '#f3f5f6',
  line: '#e5e8ea',
  ink: '#0e1518',
  inkMuted: '#61707a',
  hover: 'rgba(14, 21, 24, .045)',
}

/** Dark-mode palette. */
export const DARK_PALETTE: SocialPalette = {
  bg: '#0c1116',
  panel: '#161e25',
  line: '#233039',
  ink: '#e9eef1',
  inkMuted: '#8aa0ac',
  hover: 'rgba(255, 255, 255, .05)',
}
