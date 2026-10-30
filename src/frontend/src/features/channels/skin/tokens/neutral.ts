/**
 * features/channels/skin/tokens/neutral.ts
 * ---------------------------------------------------------------------------
 * The neutral fallback skin (story 13). Used when an outlet's `skinKey` is
 * not registered, and as the source of the colours the a11y floor clamps a
 * violating pair to. It is never replaceable.
 *
 * Deliberately plain: system font stacks (no font files), a screened palette
 * (every `CONTRAST_PAIRS` pair is AA; a test pins it), no rail, no clutter, and
 * an EMPTY breaking vocabulary so the platform never authors a "breaking"
 * label (D3-P4: the outlet screams BREAKING, Pulse never does).
 */

import type { OutletSkinTokens } from '../schema'

export const NEUTRAL_SKIN_TOKENS: OutletSkinTokens = {
  schemaVersion: 1,
  type: {
    mastheadFamily: 'system-ui, sans-serif',
    hedFamily: 'system-ui, sans-serif',
    dekFamily: 'system-ui, sans-serif',
    bodyFamily: 'system-ui, sans-serif',
    kickerFamily: 'system-ui, sans-serif',
    hedCase: 'none',
  },
  palette: {
    accent: '#1f4e79',
    link: '#1a4f8b',
    bg: '#ffffff',
    surface: '#f5f6f7',
    text: '#1c1c1c',
    rule: '#c9ced4',
    breaking: '#a4161a',
  },
  density: { spacingScale: 1, ruleWeight: 1, radius: 4 },
  media: { cropAggression: 'low', captionStyle: 'plain', playerTint: '#1c1c1c' },
  breaking: { style: 'bar', vocabulary: '' },
  byline: { format: '{name}' },
  dateline: { format: 'standard' },
  layout: { rail: false, homeLead: 'text-lead' },
}
