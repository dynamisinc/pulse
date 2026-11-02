/**
 * features/weather/components/product/SeverityChip.tsx
 * ---------------------------------------------------------------------------
 * The product-type chip (weather-source story 07, #758; WX-010, NFR-001,
 * D4-009): icon + WORD + hue.
 *
 *   [▲ WARNING]   [◉ WATCH]   [ⓘ ADVISORY]
 *
 * The word is a real text node and always present, so the chip reads the same
 * in greyscale, under forced colours and to a screen reader (the icon is
 * decorative). The hue comes from the skin's `ext.weather` key (`severity.ts`).
 *
 * Participant world: CSS Module + skin variables, no COBRA, no MUI.
 */

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { WeatherProductType } from '@/features/weather/contract'
import { WEATHER_SEVERITY, severityFillStyle } from './severity'
import styles from './SeverityChip.module.css'

export interface SeverityChipProps {
  readonly productType: WeatherProductType
  readonly className?: string
}

export function SeverityChip({ productType, className }: SeverityChipProps) {
  const severity = WEATHER_SEVERITY[productType]
  return (
    <span
      className={[styles.chip, className].filter(Boolean).join(' ')}
      style={severityFillStyle(productType)}
      data-testid="weather-severity-chip"
      data-product-type={productType}
    >
      <FontAwesomeIcon icon={severity.icon} className={styles.icon} aria-hidden="true" />
      <span className={styles.label}>{severity.label}</span>
    </span>
  )
}
