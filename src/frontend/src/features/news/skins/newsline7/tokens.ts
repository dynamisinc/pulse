/**
 * features/news/skins/newsline7/tokens.ts
 * ---------------------------------------------------------------------------
 * Skin token file `newsline7`: the local-TV register (news story 10, D3-P3).
 * F03 seeds it as the default news outlet, displayed as "Metro Desk 9"
 * (FIC-001); the outlet name is outlet data, never a token.
 *
 * Video-forward, condensed urgent headlines: Oswald (condensed, uppercase)
 * for masthead, heds and kickers; Source Sans 3 for dek and body; broadcast
 * red on a navy masthead band over a neutral light page.
 *
 * Data only. Refinement is a token edit, not a build. Every text/background
 * pair is AA (pinned by `tokens.test.ts`); a failing pair is fixed here by
 * tuning the token, never by exempting it.
 */

import type { OutletSkinTokens } from '@/features/channels'

export const NEWSLINE7_SKIN_KEY = 'newsline7'

/** Broadcast red: the accent, the breaking bar and link text. */
const BROADCAST_RED = '#c8102e'
/** The masthead band and the player chrome. */
const NAVY = '#0f2749'

/**
 * Fallbacks are chosen for width as well as look: Oswald is condensed, so
 * its stack tries the condensed system faces first, keeping the swap's line
 * breaks close; Source Sans 3 falls back to the humanist system sans.
 */
const OSWALD = "'Oswald', 'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', sans-serif"
const SOURCE_SANS = "'Source Sans 3', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

export const tokens: OutletSkinTokens = {
  schemaVersion: 1,
  type: {
    mastheadFamily: OSWALD,
    hedFamily: OSWALD,
    dekFamily: SOURCE_SANS,
    bodyFamily: SOURCE_SANS,
    kickerFamily: OSWALD,
    hedCase: 'uppercase',
  },
  palette: {
    accent: BROADCAST_RED,
    link: BROADCAST_RED,
    bg: '#ffffff',
    surface: '#f2f4f7',
    text: '#14171c',
    rule: '#d3d8df',
    breaking: BROADCAST_RED,
  },
  density: { spacingScale: 1, ruleWeight: 2, radius: 2 },
  media: { cropAggression: 'medium', captionStyle: 'plain', playerTint: NAVY },
  breaking: { style: 'bar', vocabulary: 'BREAKING NEWS' },
  byline: { format: '{name}' },
  dateline: { format: 'standard' },
  layout: { rail: true, homeLead: 'video-lead' },
  ext: {
    news: {
      masthead: 'tv-bar',
      mastheadFill: NAVY,
      liveChip: true,
    },
  },
}
