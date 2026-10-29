/**
 * features/channels/skin/SkinResetBoundary.tsx
 * ---------------------------------------------------------------------------
 * The reset boundary (story 13, news FU-6b). Inside any skin scope, it
 * re-applies the EXERCISE brand so an embedded Social `PostCard` renders to
 * D1 anatomy verbatim, immune to the outlet skin around it (SOC-002/004: the
 * embed and its verified seal never take an outlet's colours or type).
 *
 * What it undoes, on its own wrapper element:
 *  - every `--pulse-skin-*` custom property any enclosing scope set (ext
 *    colours included) → `initial` (the guaranteed-invalid value, so
 *    `var(--pulse-skin-x, fallback)` takes its fallback);
 *  - the inherited type and colour the scope set (family, size, case, caps,
 *    colour) → the participant base;
 *  - the MUI theme → the theme from outside every skin scope;
 *  - the skin context → none (`useSkin()` throws inside, by design).
 *
 * What it re-applies: the exercise brand tokens as `--pulse-brand-*`
 * (`BrandThemeProvider`'s names and values). It must render below a
 * `BrandThemeProvider`; it fails closed otherwise, like `useBrand()`.
 *
 * World: participant. No COBRA import.
 */

import { useContext, useMemo, type CSSProperties, type ReactNode } from 'react'
import { ThemeProvider, useTheme } from '@mui/material/styles'
import {
  BRAND_ACCENT_VAR,
  BRAND_ON_SURFACE_VAR,
  BRAND_PRIMARY_VAR,
  BRAND_SURFACE_VAR,
  useBrandTokens,
} from '@/features/participant-shell/brandTokens'
import { SkinContext } from './skinContext'
import { PARTICIPANT_BASE_FONT, SKIN_CSS_VARS } from './theme'

export interface SkinResetBoundaryProps {
  /** The embedded content that must not wear the outlet skin (a Social `PostCard`). */
  readonly children: ReactNode
}

/** Re-applies the exercise brand inside a skin scope. */
export function SkinResetBoundary({ children }: SkinResetBoundaryProps) {
  const brand = useBrandTokens()
  const skin = useContext(SkinContext)
  const theme = useTheme()
  const outerTheme = skin?.outerTheme ?? theme
  const varNames = skin?.cssVarNames

  const style = useMemo(() => {
    const reset: Record<string, string> = {}
    for (const name of [...Object.values(SKIN_CSS_VARS), ...(varNames ?? [])]) reset[name] = 'initial'
    return {
      display: 'contents',
      ...reset,
      [BRAND_PRIMARY_VAR]: brand.colors.primary,
      [BRAND_ACCENT_VAR]: brand.colors.accent,
      [BRAND_SURFACE_VAR]: brand.colors.surface,
      [BRAND_ON_SURFACE_VAR]: brand.colors.onSurface,
      color: brand.colors.onSurface,
      fontFamily: PARTICIPANT_BASE_FONT,
      fontSize: '1rem',
      fontStyle: 'normal',
      fontWeight: 'normal',
      fontVariantCaps: 'normal',
      letterSpacing: 'normal',
      lineHeight: 'normal',
      textTransform: 'none',
    } as CSSProperties
  }, [brand, varNames])

  return (
    <SkinContext.Provider value={undefined}>
      <ThemeProvider theme={outerTheme}>
        <div data-skin-reset="" style={style}>
          {children}
        </div>
      </ThemeProvider>
    </SkinContext.Provider>
  )
}
