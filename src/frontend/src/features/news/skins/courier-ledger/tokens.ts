/**
 * features/news/skins/courier-ledger/tokens.ts
 * ---------------------------------------------------------------------------
 * The Courier-Ledger skin: the city paper (news story 11, #728; D3-P3).
 *
 * Register: newspaper. Serif, measured, text-forward, traditional grid. It must
 * NOT read as the portal (D2-002 "print" risk: the portal stays broadcast, a
 * station-blue sans band), nor as Metro Desk 9's TV bar. The difference is
 * structural, not only a palette swap: a centred serif nameplate over a double rule
 * (`ext.news.masthead: 'centered-nameplate'` + `mastheadDoubleRule`, story 03 draws it).
 *
 * DATA ONLY. No layout code lives here; refinement is a token edit. The values are
 * a subset of what F13's schema and F03's server allowlist (`SkinOverridesValidator`)
 * accept, so an exercise may override any of them.
 *
 * World: participant. No COBRA, no MUI, no React.
 */

import type { OutletSkinTokens } from '@/features/channels'

/** The registry key; equals the `skinKey` foundation 03 seeds for the city paper. */
export const COURIER_LEDGER_SKIN_KEY = 'courier-ledger'

/**
 * Serif stack. Newsreader first, then Times New Roman and its metric twins (Times on
 * macOS, Liberation Serif on Linux), then Georgia, then the generic. Times is the
 * closest installed width match to Newsreader: measured in a 360 / 680 / 1140 px column
 * (masthead, hed, dek, body, caption), the `font-display: swap` rewrapped one block by
 * one line at 360 px and nothing at 680 or 1140 px, where a Georgia-first stack moved
 * two blocks. The masthead never rewrapped and nothing overflowed at 360 px.
 */
export const COURIER_LEDGER_SERIF =
  "'Newsreader', 'Times New Roman', Times, 'Liberation Serif', Georgia, serif"

/** Sans stack for kicker and meta: Source Sans 3, then common humanist/grotesque sans. */
export const COURIER_LEDGER_SANS =
  "'Source Sans 3', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif"

/**
 * Muted gray for meta text (byline, dateline, timestamps). Restrained palettes
 * usually fail here; this one is 6.75:1 on `bg` and 6.13:1 on `surface`
 * (pinned by `courierLedger.test.ts`).
 */
export const COURIER_LEDGER_META = '#5c574f'

export const tokens: OutletSkinTokens = {
  schemaVersion: 1,
  type: {
    mastheadFamily: COURIER_LEDGER_SERIF,
    hedFamily: COURIER_LEDGER_SERIF,
    dekFamily: COURIER_LEDGER_SERIF,
    bodyFamily: COURIER_LEDGER_SERIF,
    kickerFamily: COURIER_LEDGER_SANS,
    // Newspaper heads are sentence case; the kicker's small caps are `ext.news.kickerCase`.
    hedCase: 'none',
  },
  palette: {
    // Restrained gray: near-black ink on warm newsprint, a hairline rule, a muted oxblood accent.
    accent: '#7a2a25',
    link: '#2b4a6f',
    bg: '#faf8f3',
    surface: '#f1ede4',
    text: '#1c1b19',
    rule: '#d9d4c7',
    breaking: '#9b1c14',
  },
  // Measured: generous spacing, hairline rules, square corners.
  density: { spacingScale: 1.125, ruleWeight: 1, radius: 0 },
  media: { cropAggression: 'low', captionStyle: 'italic-serif', playerTint: '#2a2825' },
  // Understated: a rule, never a bar. The outlet's own word, not the platform's.
  breaking: { style: 'rule', vocabulary: 'News Alert' },
  byline: { format: 'By {name}, Staff Writer' },
  dateline: { format: 'standard' },
  layout: { rail: true, homeLead: 'text-lead' },
  ext: {
    news: {
      // A centred serif nameplate over a double rule (story 03 draws the variant).
      masthead: 'centered-nameplate',
      mastheadDoubleRule: true,
      kickerCase: 'small-caps',
      metaColor: COURIER_LEDGER_META,
    },
  },
}
