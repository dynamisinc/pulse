/**
 * features/weather/components/product/severity.ts
 * ---------------------------------------------------------------------------
 * The product-severity presentation table (weather-source story 07, #758;
 * WX-010, NFR-001, D4-009). One row per product type: the visible WORD, the
 * FontAwesome icon and the hue. Severity is never colour-only: every surface
 * that reads this table renders the word AND the icon AND the hue.
 *
 * Hues come from the Weather Desk skin's `ext.weather` colour keys (decided:
 * severity hues are `ext.weather` keys, never base palette tokens), with these
 * defaults when no mounted skin sets one, so the components render correctly
 * before story 06 mounts the channel and registers the skin:
 *
 *   ext.weather.warning   (default #8b0000)
 *   ext.weather.watch     (default #2e6b4f)
 *   ext.weather.advisory  (default #8a4b00)
 *
 * The fill AND its text colour are both derived from ONE resolved hue (the
 * nearest skin scope's finalized `ext.weather` value, else the default), so
 * they can never disagree. The scope's inherited CSS variable is deliberately
 * not used for the fill: an outer scope's variable leaks through an inner
 * scope that does not set the key, while the context reports the inner scope.
 * The text is the AA-safe black or white for that hue: white for every default
 * (pinned by SeverityChip.test.tsx), black for a light override. Story 06 owns
 * the `ext.weather` schema (`registerSkinExtension('weather', …)`) and
 * declares these three keys as `color`.
 *
 * `SkinContext` is read directly (not `useSkin()`, which throws outside a
 * scope) because the chip must also render outside any scope, on the default.
 *
 * World: participant. No MUI.
 */

import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { faCircleInfo, faEye, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { useContext, type CSSProperties } from 'react'
import { onColor } from '@/features/channels/skin'
import { SkinContext } from '@/features/channels/skin/skinContext'
import type { WeatherProductType } from '@/features/weather/contract'

/** The `ext.weather` namespace the severity hues live in. */
export const WEATHER_SKIN_EXT_NAMESPACE = 'weather'

/** Text drawn on every DEFAULT severity hue. */
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

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/**
 * The hue in force for a product type: the mounted skin's finalized
 * `ext.weather` value when it has one (the same value the scope publishes as
 * the CSS variable), else the default. Outside a skin scope, the default.
 */
export function resolveSeverityHue(
  productType: WeatherProductType,
  ext: Readonly<Record<string, unknown>> | undefined,
): string {
  const row = WEATHER_SEVERITY[productType]
  const value = ext?.[row.extKey]
  return typeof value === 'string' && HEX.test(value) ? value : row.defaultHue
}

/**
 * Fill + text colours for a severity surface (chip), given the RESOLVED hue in
 * force (`resolveSeverityHue`): the fill is that hue, the text its AA-safe
 * black or white.
 */
export function severityFillStyle(resolvedHue: string): CSSProperties {
  return { backgroundColor: resolvedHue, color: onColor(resolvedHue) }
}

/** Fill + text colours, reading the hue in force from the nearest mounted skin (if any). */
export function useSeverityFill(productType: WeatherProductType): CSSProperties {
  const ext = useContext(SkinContext)?.tokens.ext?.[WEATHER_SKIN_EXT_NAMESPACE]
  return severityFillStyle(resolveSeverityHue(productType, ext))
}
