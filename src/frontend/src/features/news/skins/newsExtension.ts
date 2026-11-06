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
 * - `liveChip`: the skin's OWN live-chip word (e.g. `'LIVE'`); absent or empty
 *   means no chip. A string, not a boolean, so the platform never authors the
 *   word (story 03, D3-P4).
 * - `slugCode`: whether article heads show the wire slug code (story 12).
 * - `discussionLabel`: the discussion-footer copy (story 09).
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

export const NEWS_SKIN_EXTENSION: SkinExtensionSchema = {
  keys: {
    masthead: { type: 'enum', values: NEWS_MASTHEAD_VARIANTS },
    liveChip: { type: 'string', maxLength: 16 },
    slugCode: { type: 'boolean' },
    discussionLabel: { type: 'string', maxLength: 80 },
  },
}

registerSkinExtension('news', NEWS_SKIN_EXTENSION)
