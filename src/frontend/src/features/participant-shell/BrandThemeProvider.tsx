/**
 * features/participant-shell/BrandThemeProvider.tsx
 * ---------------------------------------------------------------------------
 * Per-exercise brand-theming provider (feature: participant-shell, story 07;
 * COR-066/030; see docs/features/participant-shell/07-brand-theming-hooks.md
 * and docs/design/D7-application-shells/SHELL-CONTRACT.md §1 "Theming
 * hooks").
 *
 * `<BrandThemeProvider>` is the mount point every participant channel (social
 * now; portal/news/press/weather later) renders below, somewhere in the
 * participant route subtree. It resolves the current exercise's brand tokens
 * itself — via `useBrandConfig()` (`./brandTokens.ts`) — and exposes them to
 * descendants through a React context (`useBrandTokens()` / its `useBrand()`
 * alias, both in `./brandTokens.ts`). SELF-CONTAINED by design (mirrors
 * `ComplianceChrome` reading its own `useChromeConfig()`): callers never pass
 * tokens in as a prop, so dropping this provider into the shell tree needs no
 * prop-threading.
 *
 * The shell hardcodes ZERO brand name, color, or logo: every token this
 * module hands out comes from `useBrandConfig()`'s config seam. Swapping that
 * exercise's brand config reskins every mounted channel with no change to
 * this file, `ShellLayout`, or any other shell module (the story's AC).
 *
 * Deliberately a plain React context, NOT an MUI `ThemeProvider` (D0 §2 / this
 * story's technical notes): an MUI theme would drag in MUI's default
 * component look, and this shell must never impose one on the participant
 * world. Channels that want MUI can build their OWN brand-skinned MUI theme
 * FROM these tokens in their own route subtree; that is their concern, not
 * this provider's.
 *
 * CSS-var publication (optional per the story, provided here for
 * convenience): the provider also publishes `--pulse-brand-*` custom
 * properties (`./brandTokens.ts`), SCOPED to the wrapper element it renders —
 * never `document.documentElement` / `:root`. This is a deliberate departure
 * from `ComplianceChrome`'s `:root` publication: that component IS the
 * shell's global chrome contract (one pair of insets, ref-counted across the
 * whole page). Brand tokens are the opposite — a channel-facing skin that
 * must stay exercise-scoped and must never bleed into the shell's OWN chrome
 * (the compliance banners, alert-bar palettes, overlay treatments all render
 * OUTSIDE this provider's subtree and never read `--pulse-brand-*`; this
 * module never reads or feeds `chromeConfig.ts` either — XC-002/003). Scoping
 * to the wrapper keeps that separation structural, not a matter of
 * convention. `display: contents` keeps the wrapper out of the box/layout
 * tree — a channel's own layout CSS sees no extra element to account for —
 * while the custom properties still inherit to every descendant, because
 * custom-property inheritance follows the DOM/cascade tree, not box
 * generation.
 *
 * This file exports ONLY the provider component — the context, the
 * `useBrandTokens()`/`useBrand()` consumer hooks, and the `BRAND_*_VAR`
 * constant names live in `./brandTokens.ts` (a plain `.ts` module, no JSX
 * needed to create a context or call `useContext`) so this `.tsx` file stays
 * a single-component-export file (`react-refresh/only-export-components`).
 *
 * World: participant. No COBRA, no `@/theme/styledComponents`, no MUI, no
 * default MUI look (D0 §2) — plain React + inline style/CSS vars, exactly
 * like the `ComplianceChrome` precedent.
 */

import { useMemo, type CSSProperties, type ReactNode } from 'react'
import {
  BRAND_ACCENT_VAR,
  BRAND_ON_SURFACE_VAR,
  BRAND_PRIMARY_VAR,
  BRAND_SURFACE_VAR,
  BrandTokensContext,
  useBrandConfig,
  type BrandTokens,
} from './brandTokens'

export interface BrandThemeProviderProps {
  /** The channel(s) mounted below this provider in the participant route subtree. */
  children: ReactNode
}

/**
 * Builds the scoped CSS-var style object for the current tokens. `display:
 * contents` is the mechanism that keeps the wrapper `<div>` out of the
 * rendered box tree (see module header) — it is a layout fact of this
 * wrapper, not brand config, so it lives here rather than in `brandTokens.ts`.
 */
function brandCssVarStyle(tokens: BrandTokens): CSSProperties {
  return {
    display: 'contents',
    [BRAND_PRIMARY_VAR]: tokens.colors.primary,
    [BRAND_ACCENT_VAR]: tokens.colors.accent,
    [BRAND_SURFACE_VAR]: tokens.colors.surface,
    [BRAND_ON_SURFACE_VAR]: tokens.colors.onSurface,
  } as CSSProperties
}

/**
 * Resolves the current exercise's brand tokens and provides them to every
 * mounted channel below it, both via context (`useBrandTokens()`/`useBrand()`)
 * and via scoped `--pulse-brand-*` CSS custom properties.
 *
 * Mount once in the participant route subtree, above the channel(s) it
 * covers (e.g. inside `ShellLayout`'s content region, or wrapping it — the
 * shell-integration point is the orchestrator's concern, not this file's;
 * this component does not import or modify `ShellLayout`).
 */
export function BrandThemeProvider({ children }: BrandThemeProviderProps) {
  const tokens = useBrandConfig()
  const style = useMemo(() => brandCssVarStyle(tokens), [tokens])

  return (
    <BrandTokensContext.Provider value={tokens}>
      <div data-testid="pulse-brand-theme-scope" style={style}>
        {children}
      </div>
    </BrandTokensContext.Provider>
  )
}
