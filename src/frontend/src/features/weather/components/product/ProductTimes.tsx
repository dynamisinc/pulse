/**
 * features/weather/components/product/ProductTimes.tsx
 * ---------------------------------------------------------------------------
 * The Issued / Effective / Expires block (weather-source story 07, #758;
 * COR-053, D4-009):
 *
 *   Issued     Dec 2, 2026, 8:25 AM
 *   Effective  Dec 2, 2026, 8:30 AM
 *   Expires    Dec 2, 2026, 2:00 PM
 *
 * Every instant renders through F14's `ScenarioDateline`, so it is scenario
 * time in the exercise time zone and never says "scenario time". This module
 * never reads the wall clock or formats with `toLocale*` (an ESLint rule on
 * this folder and product.static.test.ts both enforce it).
 *
 * Participant world: CSS Module + skin variables, no COBRA, no MUI.
 */

import { ScenarioDateline } from '@/features/channels/primitives'
import styles from './ProductTimes.module.css'

export interface ProductTimesProps {
  /** `publishedScenarioTime`; absent or null (an unpublished preview) omits the Issued row. */
  readonly issuedScenarioTime?: string | null
  readonly effectiveScenarioTime: string
  readonly expiresScenarioTime: string
  /** The skin's `dateline.format` name (F14 registry); absent falls back to `standard`. */
  readonly format?: string | null
  /** Overrides the exercise time zone (previews, tests). */
  readonly timeZone?: string
  readonly className?: string
}

export function ProductTimes({
  issuedScenarioTime,
  effectiveScenarioTime,
  expiresScenarioTime,
  format,
  timeZone,
  className,
}: ProductTimesProps) {
  const rows: readonly (readonly [string, string | null | undefined])[] = [
    ['Issued', issuedScenarioTime],
    ['Effective', effectiveScenarioTime],
    ['Expires', expiresScenarioTime],
  ]

  return (
    <dl className={[styles.times, className].filter(Boolean).join(' ')} data-testid="weather-product-times">
      {rows.map(([label, instant]) => (instant === null || instant === undefined ? null : (
        <div key={label} className={styles.row}>
          <dt className={styles.label}>{label}</dt>
          <dd className={styles.value}>
            <ScenarioDateline scenarioTime={instant} format={format} timeZone={timeZone} />
          </dd>
        </div>
      )))}
    </dl>
  )
}
