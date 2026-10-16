/**
 * features/controller/report/components/ActivityChart.tsx
 * ---------------------------------------------------------------------------
 * The "Activity over time" chart of the printed exercise report (story 29): posts per 5 scenario
 * minutes, stacked by source with background noise at the BOTTOM (so participant posts sit on
 * top where they are easiest to see), key injects as dashed vertical lines topped by small
 * NUMBERED badges (story 31). Inline SVG, no chart library.
 *
 * INJECT BADGES (story 31). The chart carries only a number per inject (1, 2, 3 ... left to
 * right); the words live in a real-text KEY under the chart ("1 · 06:39 · #2 Boil-water
 * advisory", with the date when the report spans days). `layoutMarkerBadges` merges badges that
 * would collide ("2-4") and offsets the rest in rows, so nothing overprints at any density.
 *
 * Reads like the mockup: viewBox 680x190, plot from x=34 to x=676, baseline y=150, top gridline
 * y=22. The y-axis maximum is the tallest bin rounded UP (`niceMax`). Never color-only: the SVG
 * carries an `aria-label` summary and a visible legend names every series. Times are the
 * server's scenario-time strings, sliced, never converted.
 */

import { BADGE_HEIGHT, layoutMarkerBadges } from '../services/markerLayout'
import {
  addMinutesToStamp,
  axisLabel,
  axisLabelMode,
  chartSummary,
  formatStamp,
  injectName,
  niceMax,
  type SeriesKey,
} from '../services/reportFormat'
import type { ExerciseReport } from '../types/report'
import styles from './report.module.css'

const X0 = 34
const X1 = 676
const VIEW_WIDTH = 680
const Y_BASE = 150
const Y_TOP = 22

/** Bottom-to-top stacking order: noise first. */
const STACK: ReadonlyArray<{ key: SeriesKey; className: string }> = [
  { key: 'noise', className: styles.fillNoise ?? '' },
  { key: 'engine', className: styles.fillEng ?? '' },
  { key: 'scripted', className: styles.fillScr ?? '' },
  { key: 'participant', className: styles.fillPt ?? '' },
]

/** Vertical distance between badge rows. */
const ROW_STEP = BADGE_HEIGHT + 2
/** The 10px monospace axis font's advance per character, in viewBox units (upper bound). */
const AXIS_CHAR_WIDTH = 6.2
const AXIS_LABEL_GAP = 8

export interface ActivityChartProps {
  readonly activity: ExerciseReport['activity']
  /** Story 31: the report spans days, so the key's times carry their date. */
  readonly spansMultipleDays?: boolean
}

export function ActivityChart({ activity, spansMultipleDays = false }: ActivityChartProps) {
  const { bins, injectMarkers, binMinutes } = activity
  const count = bins.length
  if (count === 0) {
    return <p className={styles.method}>No activity to chart.</p>
  }

  const totals = bins.map(bin => bin.participant + bin.scripted + bin.engine + bin.noise)
  const yMax = niceMax(Math.max(...totals))
  const barWidth = (X1 - X0) / count
  const gap = Math.min(2, barWidth * 0.15)
  const scale = (Y_BASE - Y_TOP) / yMax

  // About five time labels along the axis, plus the end of the window. A label that would run
  // into the end label is dropped, so the axis text never overlaps.
  const lastBin = bins[count - 1]
  const mode = axisLabelMode(activity)
  const endLabel = lastBin === undefined
    ? ''
    : axisLabel(addMinutesToStamp(lastBin.start, binMinutes), mode)
  const endLabelLeft = X1 - endLabel.length * AXIS_CHAR_WIDTH - AXIS_LABEL_GAP
  const labelEvery = Math.max(1, Math.ceil(count / 5))
  const labelIndexes: number[] = []
  for (let index = 0; index < count; index += labelEvery) {
    const bin = bins[index]
    if (bin === undefined) continue
    const right = X0 + index * barWidth + axisLabel(bin.start, mode).length * AXIS_CHAR_WIDTH
    if (right <= endLabelLeft) labelIndexes.push(index)
  }

  const markerX = (binIndex: number) => X0 + binIndex * barWidth + barWidth / 2
  const layout = layoutMarkerBadges(
    injectMarkers.map(marker => ({ x: markerX(marker.binIndex) })),
    { min: 0, max: VIEW_WIDTH },
  )
  // Extra badge rows grow the viewBox upward, so the plot never moves.
  const topExtra = Math.max(0, layout.rows - 1) * ROW_STEP
  const keyRows = injectMarkers
    .map((marker, index) => ({ marker, number: layout.numberOf[index] ?? index + 1 }))
    .sort((a, b) => a.number - b.number)

  return (
    <>
      <svg
        className={styles.chart}
        viewBox={`0 ${-topExtra} ${VIEW_WIDTH} ${190 + topExtra}`}
        role="img"
        aria-label={chartSummary(activity)}
        data-testid="activity-chart"
      >
        <line className={styles.axis} x1={X0} y1={Y_BASE} x2={X1} y2={Y_BASE} />
        <line className={styles.axis} x1={X0} y1={Y_TOP} x2={X1} y2={Y_TOP} strokeDasharray="2 3" />
        <text x={X0 - 6} y={Y_BASE + 3} textAnchor="end">0</text>
        <text x={X0 - 6} y={Y_TOP + 3} textAnchor="end">{yMax}</text>

        <g>
          {bins.map((bin, index) => {
            let y = Y_BASE
            return STACK.map(({ key, className }) => {
              const height = bin[key] * scale
              if (height <= 0) return null
              y -= height
              return (
                <rect
                  key={`${index}-${key}`}
                  className={className}
                  x={X0 + index * barWidth + gap / 2}
                  width={Math.max(0.5, barWidth - gap)}
                  y={y}
                  height={height}
                />
              )
            })
          })}
        </g>

        {injectMarkers.map((marker, index) => (
          <line
            key={`line-${index}`}
            className={styles.injLine}
            x1={markerX(marker.binIndex)}
            y1={9}
            x2={markerX(marker.binIndex)}
            y2={Y_BASE}
          />
        ))}
        {layout.badges.map(badge => {
          const cy = 9 - badge.row * ROW_STEP
          return (
            <g key={badge.label} data-testid="marker-badge">
              <rect
                className={styles.injBadge}
                x={badge.x - badge.width / 2}
                y={cy - BADGE_HEIGHT / 2}
                width={badge.width}
                height={BADGE_HEIGHT}
                rx={BADGE_HEIGHT / 2}
              />
              <text className={styles.injNum} x={badge.x} y={cy + 3.5} textAnchor="middle">
                {badge.label}
              </text>
            </g>
          )
        })}

        {labelIndexes.map(index => {
          const bin = bins[index]
          return bin === undefined ? null : (
            <text key={index} x={X0 + index * barWidth} y={168}>{axisLabel(bin.start, mode)}</text>
          )
        })}
        <text x={X1} y={168} textAnchor="end">{endLabel}</text>
      </svg>

      <div className={styles.legend}>
        <span><i className={`${styles.sw} ${styles.pt}`} />Participant</span>
        <span><i className={`${styles.sw} ${styles.scr}`} />Scripted inject</span>
        <span><i className={`${styles.sw} ${styles.eng}`} />Engine</span>
        <span><i className={`${styles.sw} ${styles.noise}`} />Background noise</span>
        {injectMarkers.length > 0 && <span>Numbered dashed lines mark key injects</span>}
      </div>
      {keyRows.length > 0 && (
        <ol className={styles.markerKey} aria-label="Key injects" data-testid="marker-key">
          {keyRows.map(({ marker, number }) => (
            <li key={`${number}-${marker.at}`}>
              {`${number} · ${formatStamp(marker.at, spansMultipleDays)} · ${injectName(marker.ref, marker.title)}`}
            </li>
          ))}
        </ol>
      )}
    </>
  )
}
