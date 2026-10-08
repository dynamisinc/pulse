/**
 * features/social/theme/SocialBrandScope.tsx
 * ---------------------------------------------------------------------------
 * The Social channel's brand ROOT (demo-polish F5, story 14; SOC-050, COR-030).
 *
 * THE DEFECT THIS FIXES. Every social stylesheet reads `var(--pulse-ac, #1e3a5f)`
 * — the Follow button, hashtags, the active tab underline, focus rings, the
 * "new posts" pill, the profile banner tint — but NOTHING ever set `--pulse-ac`,
 * so a rebranded exercise never reached the feed and every exercise rendered
 * Cadence navy. `BrandThemeProvider` (participant-shell) already resolves the
 * exercise's brand and publishes `--pulse-brand-accent` on its own wrapper; this
 * component is the missing bridge between that shell-level token and the social
 * channel's own variable.
 *
 * WHAT IT DOES. Reads the resolved brand through `useBrand()` and renders ONE
 * wrapper that sets, for every descendant:
 *   - `--pulse-ac`  = the brand accent, made WCAG-AA-safe on white by
 *                     `accessibleAccent()` (passed through unchanged when it
 *                     already clears 4.5:1, nudged darker only when it does not;
 *                     see `./accent.ts` for why);
 *   - `font-family` = {@link FONT_FAMILY} (Figtree), so text with no module rule
 *                     of its own still lands in the Pulse type face.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH. The verified-mark seal stays the FIXED
 * `SEAL_BLUE` (`#2D9CDB`): `VerifiedMark` paints it straight from `tokens.ts` as
 * an SVG fill and never reads `--pulse-ac`, so no brand — however it is set
 * here — can recolor the trust signal trainees are learning to read (SOC-052,
 * D1-003/R-001). The raw, unadjusted brand colour remains available to any
 * decoration that is not text (the profile banner tint) as `--pulse-brand-accent`.
 *
 * `display: contents` keeps the wrapper out of the box tree (the same device
 * `BrandThemeProvider` uses), so mounting this changes no layout. Custom
 * properties and inherited properties still flow through a `display: contents`
 * element. A portal rendered OUTSIDE this subtree (e.g. a modal mounted on
 * `document.body`) does not inherit the variable; mount such a portal inside the
 * scope or re-apply the variable on its root.
 *
 * FAILS CLOSED, like `useBrand()`: it must be rendered below a
 * `BrandThemeProvider`. There is no "default brand" invented here; the CSS
 * fallbacks (`DEFAULT_ACCENT`) only apply to a component rendered with no scope
 * at all (e.g. a unit test of a single card).
 *
 * World: participant. Plain React + an inline CSS variable. No COBRA, no MUI.
 */

import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { useBrand } from '@/features/participant-shell/brandTokens'
import { accessibleAccent } from './accent'
import { ACCENT_CSS_VAR, FONT_FAMILY } from './tokens'

export interface SocialBrandScopeProps {
  /** The Social channel (feed, thread, profile, hashtag views, frame chrome). */
  readonly children: ReactNode
}

/** Sets `--pulse-ac` (and the type face) for the Social channel from the resolved brand. */
export function SocialBrandScope({ children }: SocialBrandScopeProps) {
  const { colors } = useBrand()

  const style = useMemo(
    () => ({
      display: 'contents',
      fontFamily: FONT_FAMILY,
      [ACCENT_CSS_VAR]: accessibleAccent(colors.accent),
    }) as CSSProperties,
    [colors.accent],
  )

  return (
    <div data-testid="social-brand-scope" style={style}>
      {children}
    </div>
  )
}
