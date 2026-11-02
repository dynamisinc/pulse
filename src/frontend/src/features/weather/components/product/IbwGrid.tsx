/**
 * features/weather/components/product/IbwGrid.tsx
 * ---------------------------------------------------------------------------
 * The impact-based warning block (weather-source story 07, #758; WX-010,
 * D4-009): WHAT / WHERE / WHEN / IMPACTS, in that order, as a semantic `<dl>`.
 *
 *   wide:   WHAT     Tornado.            narrow:  WHAT
 *           WHERE    Northern Kestrel…            Tornado.
 *                                                 WHERE
 *                                                 Northern Kestrel…
 *
 * Mobile-first: label over value by default, a two-column grid from 600px. The
 * values are plain sans (Q-30: monospace is `ProductText` only), wrap and keep
 * authored line breaks. A product without `ibw` (a watch or advisory may omit
 * it) renders nothing, never empty rows; a blank field drops its row.
 *
 * Participant world: CSS Module + skin variables, no COBRA, no MUI.
 */

import type { WeatherIbw } from '@/features/weather/contract'
import { IBW_ROWS } from './ibwRows'
import styles from './IbwGrid.module.css'

export interface IbwGridProps {
  readonly ibw: WeatherIbw | null | undefined
  readonly className?: string
}

export function IbwGrid({ ibw, className }: IbwGridProps) {
  if (ibw === null || ibw === undefined) return null
  // A blank field is skipped rather than shown as a label over nothing.
  const rows = IBW_ROWS.filter(({ key }) => ibw[key].trim() !== '')
  if (rows.length === 0) return null
  return (
    <dl className={[styles.grid, className].filter(Boolean).join(' ')} data-testid="weather-ibw-grid">
      {rows.map(({ key, label }) => (
        <div key={key} className={styles.row}>
          <dt className={styles.label}>{label}</dt>
          <dd className={styles.value}>{ibw[key]}</dd>
        </div>
      ))}
    </dl>
  )
}
