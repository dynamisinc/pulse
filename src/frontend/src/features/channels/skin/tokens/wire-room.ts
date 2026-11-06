/**
 * features/channels/skin/tokens/wire-room.ts
 * ---------------------------------------------------------------------------
 * REPLACEABLE STUB for The Wire Room (press, E5). It exists so the press
 * channel mounts before its final values land; press story 09 registers the
 * final `wire-room` tokens from `features/press/skin/` with
 * `registerSkinTokens('wire-room', …)`, which replaces this stub. Do not
 * add the final values here.
 */

import type { OutletSkinTokens } from '../schema'
import { NEUTRAL_SKIN_TOKENS } from './neutral'

export const WIRE_ROOM_STUB_TOKENS: OutletSkinTokens = {
  ...NEUTRAL_SKIN_TOKENS,
  palette: { ...NEUTRAL_SKIN_TOKENS.palette, accent: '#2f3e4e' },
  density: { spacingScale: 0.875, ruleWeight: 1, radius: 2 },
  breaking: { style: 'slug', vocabulary: '' },
}
