/**
 * features/weather/components/product/ibwRows.ts
 * ---------------------------------------------------------------------------
 * The IBW rows in NWS order, with their labels as NWS writes them (weather-source
 * story 07, #758). Kept out of `IbwGrid.tsx` so that file exports only components.
 */

import type { WeatherIbw } from '@/features/weather/contract'

export const IBW_ROWS: readonly { readonly key: keyof WeatherIbw, readonly label: string }[] = [
  { key: 'what', label: 'WHAT' },
  { key: 'where', label: 'WHERE' },
  { key: 'when', label: 'WHEN' },
  { key: 'impacts', label: 'IMPACTS' },
]
