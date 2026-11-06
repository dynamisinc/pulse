/**
 * features/channels/primitives/dateline/ScenarioDateline.tsx
 * ---------------------------------------------------------------------------
 * The scenario-time dateline every channel page shows (channels-foundation 14;
 * COR-053 / XC-008, D3-P1 slot 5).
 *
 *   <span class="dateline">
 *     <time dateTime="2026-10-29T18:32:00Z">Oct 29, 2026, 2:32 PM</time>
 *     <span> · Updated <time dateTime="…">3:05 PM</time></span>   (FC-1 stamp rule)
 *   </span>
 *
 *  - The time zone is the EXERCISE zone (`useExerciseContext().timeZone`); a `timeZone`
 *    prop overrides it (previews, tests).
 *  - The text comes from the skin's `dateline.format`, passed in as `format` and resolved
 *    through the registry (`datelineFormats.ts`). This component does not import the skin.
 *  - "2h ago" comes off the shared scenario-time ticker (`useRelativeScenarioTime`), so it
 *    is relative to `scenarioNow()`, never `Date.now()`, and a list of datelines costs one
 *    timer (NFR-002).
 *  - The "Updated" stamp shows when `updatedScenarioTime` passes the FC-1 rule
 *    (`updatedStamp.ts`); the channel supplies the value, so the marker comes from data.
 *  - Nothing here says "scenario time": inside the fiction it is simply the time.
 *
 * Participant world: CSS Module over skin variables, no COBRA, no MUI.
 */

import { useMemo } from 'react'
import { useRelativeScenarioTime } from '@/core/clock'
import { useExerciseContext } from '@/core/exerciseContext'
import { createScenarioTimeFormatter, resolveDatelineFormat } from './datelineFormats'
import { shouldShowUpdatedStamp } from './updatedStamp'
import styles from './ScenarioDateline.module.css'

export interface ScenarioDatelineProps {
  /** The instant to show (ISO; normally `publishedScenarioTime`). */
  readonly scenarioTime: string
  /** The FC-1 Updated stamp (`updatedScenarioTime`); null/absent shows none. */
  readonly updatedScenarioTime?: string | null
  /** The skin's `dateline.format` name; unknown or absent falls back to `standard`. */
  readonly format?: string | null
  /** Overrides the exercise time zone (previews and tests). */
  readonly timeZone?: string
  readonly className?: string
}

export function ScenarioDateline({
  scenarioTime,
  updatedScenarioTime,
  format,
  timeZone: timeZoneOverride,
  className,
}: ScenarioDatelineProps) {
  const exerciseZone = useExerciseContext().timeZone
  const timeZone = timeZoneOverride ?? exerciseZone
  const relative = useRelativeScenarioTime(scenarioTime, timeZone)

  const text = useMemo(
    () => resolveDatelineFormat(format)(
      createScenarioTimeFormatter(scenarioTime, timeZone, () => relative),
    ),
    [format, scenarioTime, timeZone, relative],
  )

  const showUpdated = shouldShowUpdatedStamp(scenarioTime, updatedScenarioTime)
  const updatedText = useMemo(
    () => (showUpdated && updatedScenarioTime
      ? updatedStampText(scenarioTime, updatedScenarioTime, timeZone)
      : ''),
    [showUpdated, scenarioTime, updatedScenarioTime, timeZone],
  )

  if (text === '') return null

  return (
    <span
      className={className ? `${styles.dateline} ${className}` : styles.dateline}
      data-testid="scenario-dateline"
    >
      <time dateTime={scenarioTime}>{text}</time>
      {updatedText !== '' && updatedScenarioTime && (
        <span className={styles.updated} data-testid="scenario-dateline-updated">
          {' · Updated '}
          <time dateTime={updatedScenarioTime}>{updatedText}</time>
        </span>
      )}
    </span>
  )
}

/**
 * "3:05 PM" when the update falls on the same exercise-zone day as the publish,
 * otherwise "Oct 30 · 3:05 PM", so a next-day update never reads as same-day.
 */
function updatedStampText(published: string, updated: string, timeZone: string): string {
  const none = () => ''
  const pub = createScenarioTimeFormatter(published, timeZone, none)
  const upd = createScenarioTimeFormatter(updated, timeZone, none)
  const sameDay = pub.dateline() !== '' && pub.dateline() === upd.dateline()
  return sameDay ? upd.time() : [upd.shortDate(), upd.time()].filter(Boolean).join(' · ')
}
