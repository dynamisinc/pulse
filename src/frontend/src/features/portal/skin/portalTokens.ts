/**
 * features/portal/skin/portalTokens.ts
 * ---------------------------------------------------------------------------
 * The portal's token set (exercise-portal story 06, #771; FC-3b, D2-001, D2-002
 * broadcast direction). The portal is an AGGREGATOR brand, distinct from Pulse
 * (D1) and from every outlet (D3): Libre Franklin, a station-blue masthead, a
 * gold "TODAY" and a red accent rule.
 *
 * Registered with F13 from this folder, as a side effect of importing it
 * (`registerSkinTokens('portal', …)` + `registerSkinExtension('portal', …)`);
 * F13's `features/channels/skin/**` is never edited. The face is self-hosted
 * from the `@fontsource-variable/libre-franklin` package (a same-origin `.woff2`
 * emitted by the build; no font CDN, CSP `font-src 'self'`), and every stack
 * ends in a generic family, so a blocked face falls back cleanly.
 *
 * Every pair the masthead draws is AA in these defaults (`portalSkin.contrast.test.ts`);
 * F13's floor clamps any override that breaks a palette pair.
 *
 * World: participant. No COBRA import.
 */

import {
  registerSkinExtension,
  registerSkinTokens,
  type OutletSkinTokens,
  type SkinExtensionSchema,
  type SkinFontFace,
} from '@/features/channels'
import libreFranklinUrl from '@fontsource-variable/libre-franklin/files/libre-franklin-latin-wght-normal.woff2?url'

/** The registry key and `SkinScope` id of the portal skin (not an outlet, FU-4a). */
export const PORTAL_SKIN_KEY = 'portal'

const FRANKLIN = "'Libre Franklin Variable', 'Libre Franklin', 'Franklin Gothic Medium', Arial, sans-serif"

/** The default "TODAY" gold. ≥ 4.5:1 on the default station blue (pinned by a test). */
export const PORTAL_TODAY_GOLD = '#f2b705'

/**
 * `ext.portal`: the portal-only keys an exercise may override. `todayColor` is
 * declared a STRING, not a `color`, on purpose: F13 checks `color` keys against
 * `bg`/`surface`, but the gold is drawn on the station-blue ACCENT band, a pair F13
 * cannot express. The masthead applies its own AA guard instead (`mastheadTone.ts`).
 */
export const PORTAL_SKIN_EXTENSION: SkinExtensionSchema = {
  keys: {
    todayColor: { type: 'string', maxLength: 7 },
  },
}

export const portalTokens: OutletSkinTokens = {
  schemaVersion: 1,
  type: {
    mastheadFamily: FRANKLIN,
    hedFamily: FRANKLIN,
    dekFamily: FRANKLIN,
    bodyFamily: FRANKLIN,
    kickerFamily: FRANKLIN,
    hedCase: 'none',
  },
  palette: {
    accent: '#0b3d91',
    link: '#0b3d91',
    bg: '#ffffff',
    surface: '#f3f5f9',
    text: '#14171f',
    rule: '#c5ccd8',
    breaking: '#c8102e',
  },
  density: { spacingScale: 1, ruleWeight: 2, radius: 2 },
  media: { cropAggression: 'medium', captionStyle: 'plain', playerTint: '#0b1f3f' },
  // The portal authors no "breaking" label of its own: the outlets do (D3-P4).
  breaking: { style: 'bar', vocabulary: '' },
  byline: { format: '{name}' },
  dateline: { format: 'standard' },
  layout: { rail: true, homeLead: 'text-lead' },
  ext: { portal: { todayColor: PORTAL_TODAY_GOLD } },
}

const portalFonts: SkinFontFace[] = [
  { family: 'Libre Franklin Variable', src: libreFranklinUrl, weight: '100 900' },
]

// The `ext` NAMESPACE (F13's fixed list); it shares the skin key's name by design.
registerSkinExtension('portal', PORTAL_SKIN_EXTENSION)
registerSkinTokens(PORTAL_SKIN_KEY, portalTokens, { fonts: portalFonts })
