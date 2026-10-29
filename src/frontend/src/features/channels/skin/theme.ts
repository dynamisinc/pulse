/**
 * features/channels/skin/theme.ts
 * ---------------------------------------------------------------------------
 * What a mounted skin publishes (story 13): the `--pulse-skin-*` CSS custom
 * properties and the per-scope MUI theme, both built from FINALIZED tokens
 * (`./resolve.ts`), so the a11y floor is already in the values.
 *
 * The MUI theme is built from the tokens alone (never `cobraTheme`, never
 * MUI's default look): palette, type stacks, radius and spacing come from the
 * skin; ripples, elevation shadows and button upper-casing are switched off so
 * a stray MUI component does not read as an enterprise app. The body size is
 * fixed at `max(1rem, 16px)`: it is the a11y floor (≥16px mobile body), not a
 * token, so no skin can lower it.
 *
 * World: participant. No COBRA import.
 */

import { createTheme, type Theme } from '@mui/material/styles'
import { onColor, textSafeAccent } from './contrast'
import { getSkinExtension } from './registry'
import type { OutletSkinTokens } from './schema'

/** The fixed body size (NFR-001 floor; not a token). */
export const SKIN_BODY_SIZE = 'max(1rem, 16px)'

/**
 * The participant base type stack, which `SkinResetBoundary` restores. It is
 * the same stack the Social channel and the shell chrome use
 * (`features/social/theme/tokens.ts` `FONT_FAMILY`).
 */
export const PARTICIPANT_BASE_FONT = "'Figtree Variable', 'Figtree', system-ui, sans-serif"

/** The custom properties a skin scope sets. Layouts read these, never raw token values. */
export const SKIN_CSS_VARS = {
  fontMasthead: '--pulse-skin-font-masthead',
  fontHed: '--pulse-skin-font-hed',
  fontDek: '--pulse-skin-font-dek',
  fontBody: '--pulse-skin-font-body',
  fontKicker: '--pulse-skin-font-kicker',
  hedTransform: '--pulse-skin-hed-transform',
  hedCaps: '--pulse-skin-hed-caps',
  bodySize: '--pulse-skin-body-size',
  accent: '--pulse-skin-accent',
  onAccent: '--pulse-skin-on-accent',
  link: '--pulse-skin-link',
  bg: '--pulse-skin-bg',
  surface: '--pulse-skin-surface',
  text: '--pulse-skin-text',
  rule: '--pulse-skin-rule',
  breaking: '--pulse-skin-breaking',
  onBreaking: '--pulse-skin-on-breaking',
  space: '--pulse-skin-space',
  ruleWeight: '--pulse-skin-rule-weight',
  radius: '--pulse-skin-radius',
  playerTint: '--pulse-skin-player-tint',
  onPlayerTint: '--pulse-skin-on-player-tint',
} as const

/** `ext.<ns>.<key>` colour → `--pulse-skin-ext-<ns>-<key-kebab>`. */
export function skinExtColorVar(ns: string, key: string): string {
  return `--pulse-skin-ext-${ns}-${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** The custom-property map for a finalized token set. */
export function buildSkinCssVars(tokens: OutletSkinTokens): Record<string, string> {
  const { type, palette, density, media } = tokens
  const vars: Record<string, string> = {
    [SKIN_CSS_VARS.fontMasthead]: type.mastheadFamily,
    [SKIN_CSS_VARS.fontHed]: type.hedFamily,
    [SKIN_CSS_VARS.fontDek]: type.dekFamily,
    [SKIN_CSS_VARS.fontBody]: type.bodyFamily,
    [SKIN_CSS_VARS.fontKicker]: type.kickerFamily,
    [SKIN_CSS_VARS.hedTransform]: type.hedCase === 'uppercase' ? 'uppercase' : 'none',
    [SKIN_CSS_VARS.hedCaps]: type.hedCase === 'small-caps' ? 'small-caps' : 'normal',
    [SKIN_CSS_VARS.bodySize]: SKIN_BODY_SIZE,
    [SKIN_CSS_VARS.accent]: palette.accent,
    [SKIN_CSS_VARS.onAccent]: onColor(palette.accent),
    [SKIN_CSS_VARS.link]: palette.link,
    [SKIN_CSS_VARS.bg]: palette.bg,
    [SKIN_CSS_VARS.surface]: palette.surface,
    [SKIN_CSS_VARS.text]: palette.text,
    [SKIN_CSS_VARS.rule]: palette.rule,
    [SKIN_CSS_VARS.breaking]: palette.breaking,
    [SKIN_CSS_VARS.onBreaking]: onColor(palette.breaking),
    [SKIN_CSS_VARS.space]: `${8 * density.spacingScale}px`,
    [SKIN_CSS_VARS.ruleWeight]: `${density.ruleWeight}px`,
    [SKIN_CSS_VARS.radius]: `${density.radius}px`,
    [SKIN_CSS_VARS.playerTint]: media.playerTint,
    [SKIN_CSS_VARS.onPlayerTint]: onColor(media.playerTint),
  }
  // Only keys the namespace schema declares `color` (and so AA-checked by `finalizeSkinTokens`).
  for (const [ns, bag] of Object.entries(tokens.ext ?? {})) {
    const keys = getSkinExtension(ns)?.keys
    for (const [key, value] of Object.entries(bag)) {
      const isColorKey = keys !== undefined && Object.hasOwn(keys, key) && keys[key]?.type === 'color'
      if (isColorKey && typeof value === 'string' && HEX.test(value)) {
        vars[skinExtColorVar(ns, key)] = value
      }
    }
  }
  return vars
}

/** The per-scope MUI theme for a finalized token set. */
export function buildSkinMuiTheme(tokens: OutletSkinTokens): Theme {
  const { type, palette, density } = tokens
  const textAccent = textSafeAccent(palette)
  const hedTransform = type.hedCase === 'uppercase' ? 'uppercase' : 'none'
  const hedCaps = type.hedCase === 'small-caps' ? 'small-caps' : 'normal'
  const heading = {
    fontFamily: type.hedFamily,
    textTransform: hedTransform,
    fontVariantCaps: hedCaps,
  } as const
  return createTheme({
    palette: {
      mode: 'light',
      // MUI draws primary/secondary as body-size text, so both use the text-safe accent;
      // the raw accent is the `--pulse-skin-accent` fill. Neither is MUI's stock palette.
      primary: { main: textAccent, contrastText: onColor(textAccent) },
      secondary: { main: textAccent, contrastText: onColor(textAccent) },
      background: { default: palette.bg, paper: palette.surface },
      text: { primary: palette.text, secondary: palette.text },
      divider: palette.rule,
      // Required by the app-wide palette augmentation in `theme/cobraTheme.ts` (a type, not
      // the COBRA look); filled from the skin's own tokens.
      grid: { light: palette.surface, main: palette.rule },
    },
    typography: {
      fontFamily: type.bodyFamily,
      fontSize: 16,
      body1: { fontSize: SKIN_BODY_SIZE },
      body2: { fontSize: SKIN_BODY_SIZE },
      h1: heading,
      h2: heading,
      h3: heading,
      h4: heading,
      h5: heading,
      h6: heading,
      subtitle1: { fontFamily: type.dekFamily },
      overline: { fontFamily: type.kickerFamily },
      button: { textTransform: 'none' },
    },
    shape: { borderRadius: density.radius },
    spacing: 8 * density.spacingScale,
    components: {
      MuiButtonBase: { defaultProps: { disableRipple: true } },
      MuiPaper: { defaultProps: { elevation: 0 } },
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiLink: { styleOverrides: { root: { color: palette.link } } },
    },
  })
}
