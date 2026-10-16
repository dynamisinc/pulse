/**
 * features/controller/report/components/ActivityChart.tsx
 * ---------------------------------------------------------------------------
 * The "Activity over time" chart of the printed exercise report (story 29): posts per 5 scenario
 * minutes, stacked by source with background noise at the BOTTOM (so participant posts sit on
 * top where they are easiest to see), key injects as dashed vertical lines labeled with their
 * ref. Inline SVG, no chart library.
 *
 * Reads like the mockup: viewBox 680x190, plot from x=34 to x=676, baseline y=150, top gridline
 * y=22. The y-axis maximum is the tallest bin rounded UP (`niceMax`). Never color-only: the SVG
 * carries an `aria-label` summary and a visible legend names every series. Times are the
 * server's scenario-time strings, sliced, never converted.
 */

import { addMinutesToStamp, axisLabel, axisLabelMode, chartSummary, niceMax, refLabel, type SeriesKey } from '../services/reportFormat'
import type { ExerciseReport } from '../types/report'
import styles from './report.module.css'

const X0 = 34
const X1 = 676
const Y_BASE = 150
const Y_TOP = 22

/** Bottom-to-top stacking order: noise first. */
const STACK: ReadonlyArray<{ key: SeriesKey; className: string }> = [
  { key: 'noise', className: styles.fillNoise ?? '' },
  { key: 'engine', className: styles.fillEng ?? '' },
  { key: 'scripted', className: styles.fillScr ?? '' },
  { key: 'participant', className: styles.fillPt ?? '' },
]

export interface ActivityChartProps {
  readonly activity: ExerciseReport['activity']
}

export function ActivityChart({ activity }: ActivityChartProps) {
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

  // About five time labels along the axis, plus the end of the window.
  const labelEvery = Math.max(1, Math.ceil(count / 5))
  const labelIndexes: number[] = []
  for (let index = 0; index < count; index += labelEvery) labelIndexes.push(index)
  const lastBin = bins[count - 1]
  const mode = axisLabelMode(activity)
  const endLabel = lastBin === undefined
    ? ''
    : axisLabel(addMinutesToStamp(lastBin.start, binMinutes), mode)

  return (
    <>
      <svg
        className={styles.chart}
        viewBox="0 0 680 190"
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

        {injectMarkers.map((marker, index) => {
          const x = X0 + marker.binIndex * barWidth + barWidth / 2
          const labelY = 14 + (index % 3) * 14
          const flip = x > X1 - 150
          return (
            <g key={`${index}-${marker.ref}`}>
              <line className={styles.injLine} x1={x} y1={labelY + 2} x2={x} y2={Y_BASE} />
              <text
                className={styles.injLabel}
                x={flip ? x - 4 : x + 4}
                y={labelY}
                textAnchor={flip ? 'end' : 'start'}
              >
                {`${refLabel(marker.ref)} ${marker.title}`}
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
        {injectMarkers.length > 0 && <span>Dashed lines mark key injects</span>}
      </div>
    </>
  )
}
