/**
 * features/channels/skin/SkinScope.tsx
 * ---------------------------------------------------------------------------
 * The token-object skin scope (story 13, FC-8a; portal FU-4a). Mounts one
 * token set INSIDE ITS SUBTREE ONLY:
 *
 *  - the `--pulse-skin-*` custom properties, on its own wrapper element
 *    (never `:root`; `display: contents` keeps the wrapper out of layout,
 *    custom properties still inherit; the `BrandThemeProvider` precedent);
 *  - a per-scope MUI theme built from the tokens (never COBRA, never MUI's
 *    default look), through a nested `ThemeProvider` given a function theme,
 *    so it replaces, not merges with, any outer theme;
 *  - the skin's self-hosted fonts, loaded lazily on mount (`./fonts.ts`).
 *
 * Every token set passes `finalizeSkinTokens` first, so the a11y floor and
 * the clutter guard hold whatever the caller hands in. Two scopes on a page,
 * siblings or nested, do not bleed: each publishes on its own element and
 * its own theme context.
 *
 * Use it directly for a scope that is not an outlet (the portal:
 * `<SkinScope scopeId="portal" tokens={…} skinKey="portal">`); outlets use
 * `OutletSkinScope`, a thin wrapper over this. It never wraps the shell: a
 * channel mounts it in its own route subtree.
 *
 * World: participant. No COBRA import.
 */

import { useContext, useEffect, useMemo, type CSSProperties, type ReactNode } from 'react'
import { ThemeProvider, useTheme } from '@mui/material/styles'
import { getSkinFonts } from './registry'
import { finalizeSkinTokens } from './resolve'
import type { OutletSkinTokens } from './schema'
import { SkinContext, useSkinRegistryVersion, type SkinContextValue } from './skinContext'
import { loadSkinFonts } from './fonts'
import { SKIN_BODY_SIZE, buildSkinCssVars, buildSkinMuiTheme } from './theme'

export interface SkinScopeProps {
  /** A stable id for this scope (`"portal"`, `"outlet-newsline-7"`); set as `data-skin-scope`. */
  readonly scopeId: string
  /** The token set to mount (a token file, or a file merged with overrides). */
  readonly tokens: OutletSkinTokens
  /**
   * The registered key these tokens belong to: it selects the fonts to load
   * and decides the clutter guard. Omit for a keyless token object.
   */
  readonly skinKey?: string
  readonly children: ReactNode
}

/** Mounts `tokens` as CSS custom properties + an MUI theme inside its subtree. */
export function SkinScope({ scopeId, tokens, skinKey, children }: SkinScopeProps) {
  const registryVersion = useSkinRegistryVersion()
  const parent = useContext(SkinContext)
  const theme = useTheme()
  const outerTheme = parent?.outerTheme ?? theme

  // Keyed on the token VALUES, not the object identity, so a caller passing an inline
  // literal does not rebuild the theme every render. `registryVersion` is a dependency on
  // purpose: ext schemas registered after mount change what `finalizeSkinTokens` keeps.
  const tokensKey = JSON.stringify(tokens)
  const finalTokens = useMemo(
    () => finalizeSkinTokens(tokens, skinKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tokensKey, skinKey, registryVersion],
  )
  // A function theme: MUI shallow-merges an OBJECT theme over the outer one, which would
  // carry an outer theme's custom keys (COBRA's) into the skin. A function replaces it.
  const muiTheme = useMemo(() => {
    const theme = buildSkinMuiTheme(finalTokens)
    return () => theme
  }, [finalTokens])
  const cssVars = useMemo(() => buildSkinCssVars(finalTokens), [finalTokens])
  const parentVarNames = parent?.cssVarNames
  const cssVarNames = useMemo(
    () => [...new Set([...(parentVarNames ?? []), ...Object.keys(cssVars)])],
    [parentVarNames, cssVars],
  )
  const style = useMemo(
    () => ({
      display: 'contents',
      ...cssVars,
      color: finalTokens.palette.text,
      fontFamily: finalTokens.type.bodyFamily,
      fontSize: SKIN_BODY_SIZE,
    }) as CSSProperties,
    [cssVars, finalTokens],
  )
  const value = useMemo<SkinContextValue>(
    () => ({ scopeId, skinKey, tokens: finalTokens, outerTheme, cssVarNames }),
    [scopeId, skinKey, finalTokens, outerTheme, cssVarNames],
  )

  useEffect(() => {
    if (skinKey) loadSkinFonts(getSkinFonts(skinKey))
  }, [skinKey, registryVersion])

  return (
    <SkinContext.Provider value={value}>
      <ThemeProvider theme={muiTheme}>
        <div data-skin-scope={scopeId} data-skin-key={skinKey} style={style}>
          {children}
        </div>
      </ThemeProvider>
    </SkinContext.Provider>
  )
}
