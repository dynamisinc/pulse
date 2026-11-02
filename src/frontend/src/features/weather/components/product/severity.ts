/**
 * features/weather/components/product/severity.ts
 * ---------------------------------------------------------------------------
 * The product-severity presentation table (weather-source story 07, #758;
 * WX-010, NFR-001, D4-009). One row per product type: the visible WORD, the
 * FontAwesome icon and the hue. Severity is never colour-only: every surface
 * that reads this table renders the word AND the icon AND the hue.
 *
 * Hues come from the Weather Desk skin's `ext.weather` colour keys (decided:
 * severity hues are `ext.weather` keys, never base palette tokens), read as
 * CSS variables with these defaults as fallbacks, so the components render
 * correctly before story 06 mounts the channel and registers the skin.
 *
 *   ext.weather.warning   -> var(--pulse-skin-ext-weather-warning,  #8b0000)
 *   ext.weather.watch     -> var(--pulse-skin-ext-weather-watch,    #2e6b4f)
 *   ext.weather.advisory  -> var(--pulse-skin-ext-weather-advisory, #8a4b00)
 *
 * Text on a hue is fixed white: every default clears 4.5:1 against it
 * (pinned by SeverityChip.test.tsx). Story 06 owns the `ext.weather` schema
 * (`registerSkinExtension('weather', …)`): it declares these three keys as
 * `color` so an outlet override is AA-checked.
 *
 * World: participant. No React, no MUI.
 */

import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { faCircleInfo, faEye, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import type { CSSProperties } from 'react'
import { skinExtColorVar } from '@/features/channels/skin'
import type { WeatherProductType } from '@/features/weather/contract'

/** The `ext.weather` namespace the severity hues live in. */
export const WEATHER_SKIN_EXT_NAMESPACE = 'weather'

/** Text drawn on a severity hue. Fixed: skins cannot reach it. */
export const WEATHER_SEVERITY_ON_COLOR = '#ffffff'

export interface WeatherSeverityPresentation {
  /** The visible word, exactly as rendered (no CSS text-transform). */
  readonly label: string
  readonly icon: IconDefinition
  /** The `ext.weather` colour key that overrides the hue. */
  readonly extKey: string
  /** The default hue (D4-009; advisory per Q-27's proposed AA amber). */
  readonly defaultHue: string
}

export const WEATHER_SEVERITY: Readonly<Record<WeatherProductType, WeatherSeverityPresentation>> = {
  warning: { label: 'WARNING', icon: faTriangleExclamation, extKey: 'warning', defaultHue: '#8b0000' },
  watch: { label: 'WATCH', icon: faEye, extKey: 'watch', defaultHue: '#2e6b4f' },
  advisory: { label: 'ADVISORY', icon: faCircleInfo, extKey: 'advisory', defaultHue: '#8a4b00' },
}

/** The CSS colour expression for a product type's hue: skin `ext.weather` key, else default. */
export function severityHue(productType: WeatherProductType): string {
  const row = WEATHER_SEVERITY[productType]
  return `var(${skinExtColorVar(WEATHER_SKIN_EXT_NAMESPACE, row.extKey)}, ${row.defaultHue})`
}

/** Fill + text colours for a severity surface (chip). */
export function severityFillStyle(productType: WeatherProductType): CSSProperties {
  return { backgroundColor: severityHue(productType), color: WEATHER_SEVERITY_ON_COLOR }
}
