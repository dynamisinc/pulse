/**
 * features/channels/skin/tokens/weather-desk.ts
 * ---------------------------------------------------------------------------
 * REPLACEABLE STUB for The Weather Desk (weather, E6). It exists so the
 * weather channel mounts before its final values land; weather story 06
 * registers the final `weather-desk` tokens (and the `ext.weather` severity
 * schema) from `features/weather/skin/`, which replaces this stub. Do not add
 * the final values here.
 */

import type { OutletSkinTokens } from '../schema'
import { NEUTRAL_SKIN_TOKENS } from './neutral'

export const WEATHER_DESK_STUB_TOKENS: OutletSkinTokens = {
  ...NEUTRAL_SKIN_TOKENS,
  type: {
    ...NEUTRAL_SKIN_TOKENS.type,
    kickerFamily: 'ui-monospace, monospace',
  },
  dateline: { format: 'compact' },
}
