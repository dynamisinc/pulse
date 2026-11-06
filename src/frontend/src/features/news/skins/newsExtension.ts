/**
 * features/news/skins/newsExtension.ts
 * ---------------------------------------------------------------------------
 * The ONE `ext.news` schema (E4-C3, news FU-3). F13's registry errors on a
 * second, different schema for a namespace, so every news story declares its
 * `ext.news` keys HERE (an additive edit) and nothing else in the app calls
 * `registerSkinExtension('news', …)`. Importing this module registers it; an
 * identical re-registration is a no-op, so any number of importers is safe.
 *
 * Keys:
 * - `masthead`: which masthead variant the skin draws (story 03).
 * - `mastheadFill`: the masthead band colour, a fill (3:1 on `bg`). Text on it
 *   is the layout's job: black or white via `onColor` (story 03, skin 10).
 * - `mastheadDoubleRule`: a double rule under the nameplate (skin 11).
 * - `liveChip`: the skin's OWN live-chip word (e.g. `'LIVE'`); absent or empty
 *   means no chip. A string, not a boolean, so the platform never authors the
 *   word (story 03, D3-P4).
 * - `slugCode`: whether article heads show the wire slug code (story 12).
 * - `discussionLabel`: the discussion-footer copy (story 09).
 * - `metaColor`: muted meta text (byline, dateline, timestamp), body-size AA
 *   on `bg` (skin 11).
 * - `kickerCase`: kicker letter case; `type.hedCase` covers heds only (skin 11).
 *
 * Mirror new keys in F03's `ISkinOverridesValidator` when it starts checking
 * `ext.news` per key.
 *
 * World: participant. Data only.
 */

import { registerSkinExtension, type SkinExtensionSchema } from '@/features/channels'

/** The masthead variants (D3-P1 slot 2). */
export const NEWS_MASTHEAD_VARIANTS = [
  'tv-bar',
  'centered-nameplate',
  'wire-strip',
  'tabloid-flag',
] as const
export type NewsMastheadVariant = (typeof NEWS_MASTHEAD_VARIANTS)[number]

/** The variant drawn when a skin declares none (the plainest). */
export const DEFAULT_NEWS_MASTHEAD: NewsMastheadVariant = 'centered-nameplate'

/** Kicker letter cases (mirrors F13's `HED_CASES`). */
export const NEWS_KICKER_CASES = ['none', 'uppercase', 'small-caps'] as const

export const NEWS_SKIN_EXTENSION: SkinExtensionSchema = {
  keys: {
    masthead: { type: 'enum', values: NEWS_MASTHEAD_VARIANTS },
    mastheadFill: { type: 'color', against: 'bg', large: true },
    mastheadDoubleRule: { type: 'boolean' },
    liveChip: { type: 'string', maxLength: 16 },
    slugCode: { type: 'boolean' },
    discussionLabel: { type: 'string', maxLength: 80 },
    metaColor: { type: 'color', against: 'bg' },
    kickerCase: { type: 'enum', values: NEWS_KICKER_CASES },
  },
}

registerSkinExtension('news', NEWS_SKIN_EXTENSION)
