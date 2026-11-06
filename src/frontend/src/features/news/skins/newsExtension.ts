/**
 * features/news/skins/newsExtension.ts
 * ---------------------------------------------------------------------------
 * The `ext.news` skin extension schema (E4-C3, news FU-3), registered ONCE
 * with F13's `registerSkinExtension`. Every news skin's `ext.news` bag is
 * checked against it at resolve time: undeclared keys are dropped, `color`
 * keys enter the AA contrast check. Mirror any key added here in F03's
 * `ISkinOverridesValidator` allowlist.
 *
 * Keys:
 *  - `masthead`           the masthead variant story 03 renders.
 *  - `mastheadFill`       the masthead band colour (a fill: 3:1 on `bg`).
 *                         Text on it is the layout's job (black or white,
 *                         whichever reads, like `--pulse-skin-on-accent`).
 *  - `mastheadDoubleRule` a double rule under the nameplate (broadsheet).
 *  - `liveChip`           the "● LIVE" chip on the masthead (local TV).
 *  - `slugCode`           show the wire slug code (wire register).
 *  - `discussionLabel`, `correctionLabel`, `updatedLabel`, `retractedLabel`
 *                         outlet-voice label copy for stories 08 / 09; each
 *                         layout keeps its own neutral default.
 *
 * World: participant. Data only.
 */

import { registerSkinExtension, type SkinExtensionSchema } from '@/features/channels'

export const NEWS_MASTHEAD_VARIANTS = [
  'tv-bar',
  'centered-nameplate',
  'wire-strip',
  'tabloid-flag',
] as const

export type NewsMastheadVariant = (typeof NEWS_MASTHEAD_VARIANTS)[number]

export const NEWS_SKIN_EXTENSION: SkinExtensionSchema = {
  keys: {
    masthead: { type: 'enum', values: NEWS_MASTHEAD_VARIANTS },
    mastheadFill: { type: 'color', against: 'bg', large: true },
    mastheadDoubleRule: { type: 'boolean' },
    liveChip: { type: 'boolean' },
    slugCode: { type: 'boolean' },
    discussionLabel: { type: 'string', maxLength: 80 },
    correctionLabel: { type: 'string', maxLength: 80 },
    updatedLabel: { type: 'string', maxLength: 80 },
    retractedLabel: { type: 'string', maxLength: 80 },
  },
}

registerSkinExtension('news', NEWS_SKIN_EXTENSION)
