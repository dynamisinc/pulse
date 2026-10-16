/**
 * features/controller/report/components/ReportSheet.tsx
 * ---------------------------------------------------------------------------
 * The printable exercise report SHEET (demo-feedback story 29), reproducing the approved
 * "Pulse Exercise Media Record" mockup: EXERCISE marking band, header, At a glance (stat grid
 * plus the source split bar), Activity over time, Inject response times, Verified vs. lookalike
 * (omitted when there are no pairs), Post record, footer.
 *
 * A printed DOCUMENT in the staff world: its own CSS module, no COBRA, no participant skin.
 * Everything here is plain text from the server's `ExerciseReport`; every time is the server's
 * preformatted exercise-zone scenario time and the footer says so ("All times are scenario
 * time"). "Prepared" (`preparedAt`, exercise zone) is printed once, in the meta list.
 */

import { binWidthLabel, formatDay, formatDayWithWeekday, formatWindow, timeOf } from '../services/reportFormat'
import type { ExerciseReport } from '../types/report'
import { ActivityChart } from './ActivityChart'
import { InjectResponseTable } from './InjectResponseTable'
import { LookalikeSection } from './LookalikeSection'
import { PostRecord } from './PostRecord'
import styles from './report.module.css'

export interface ReportSheetProps {
  readonly report: ExerciseReport
}

function Stat({ value, label }: { readonly value: string; readonly label: string }) {
  return (
    <div className={styles.stat}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  )
}

const SOURCE_ROWS = [
  { key: 'participant', label: 'participant', swatch: styles.pt },
  { key: 'scripted', label: 'scripted inject', swatch: styles.scr },
  { key: 'engine', label: 'engine', swatch: styles.eng },
  { key: 'noise', label: 'background noise', swatch: styles.noise },
] as const

export function ReportSheet({ report }: ReportSheetProps) {
  const { exercise, summary } = report
  const sourceTotal = SOURCE_ROWS.reduce((sum, row) => sum + summary.bySource[row.key], 0)
  const busiest = summary.busiestWindow

  return (
    <div className={styles.sheet} data-testid="report-sheet">
      <div className={styles.marking}>
        EXERCISE · EXERCISE · EXERCISE — ALL CONTENT IS SIMULATED
      </div>
      <div className={styles.inner}>
        <header className={styles.cover}>
          <div className={styles.brandline}>
            <span>Pulse · Exercise media record</span>
          </div>
          <h1 className={styles.title}>{exercise.name}</h1>
          <dl className={styles.meta}>
            <div>
              <dt>Scenario window</dt>
              <dd>
                {formatWindow(exercise.scenarioStart, exercise.scenarioEnd, exercise.timeZone)}
              </dd>
            </div>
            <div>
              <dt>Conducted</dt>
              <dd>{exercise.conductedDate !== null ? formatDayWithWeekday(exercise.conductedDate) : '—'}</dd>
            </div>
            <div>
              <dt>Prepared</dt>
              <dd>{formatDay(exercise.preparedAt)}</dd>
            </div>
          </dl>
        </header>

        <section className={styles.section} aria-labelledby="report-glance-h">
          <h2 id="report-glance-h" className={styles.heading}>At a glance</h2>
          <div className={styles.stats}>
            <Stat value={summary.participants.toLocaleString('en-US')} label="Participants" />
            <Stat value={summary.posts.toLocaleString('en-US')} label="Posts" />
            <Stat value={summary.replies.toLocaleString('en-US')} label="Replies" />
            <Stat value={summary.injectsDelivered.toLocaleString('en-US')} label="Injects delivered" />
            <Stat
              value={summary.medianResponseMinutes !== null ? `${Math.round(summary.medianResponseMinutes)} min` : '—'}
              label="Median time to first response"
            />
            <Stat
              value={busiest !== null ? busiest.posts.toLocaleString('en-US') : '—'}
              label={busiest !== null ? `Busiest 5 minutes (${timeOf(busiest.start)})` : 'Busiest 5 minutes'}
            />
            {summary.postsEdited !== null && (
              <Stat value={summary.postsEdited.toLocaleString('en-US')} label="Posts edited" />
            )}
            <Stat value={summary.postsTakenDown.toLocaleString('en-US')} label="Posts taken down" />
          </div>
          <div className={styles.mix} role="group" aria-label={`Where the ${summary.posts} posts came from`}>
            <div className={styles.mixbar} aria-hidden="true">
              {SOURCE_ROWS.map(row => (
                <i
                  key={row.key}
                  className={row.swatch}
                  style={{ width: `${sourceTotal > 0 ? (summary.bySource[row.key] / sourceTotal) * 100 : 0}%` }}
                />
              ))}
            </div>
            <div className={styles.mixkey}>
              {SOURCE_ROWS.map(row => (
                <span key={row.key}>
                  <i className={`${styles.sw} ${row.swatch}`} aria-hidden="true" />
                  <b>{summary.bySource[row.key].toLocaleString('en-US')}</b> {row.label}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="report-activity-h">
          <h2 id="report-activity-h" className={styles.heading}>
            Activity over time <small>{`Posts per ${binWidthLabel(report.activity.binMinutes)}, by source`}</small>
          </h2>
          <ActivityChart activity={report.activity} />
        </section>

        <InjectResponseTable rows={report.injectResponses} />

        {report.lookalikes.length > 0 && <LookalikeSection pairs={report.lookalikes} />}

        <PostRecord posts={report.posts} omittedNoiseCount={report.omittedNoiseCount} />

        <footer className={styles.foot}>
          <span>{`Pulse · ${exercise.name} · Exercise media record`}</span>
          <span>All times are scenario time</span>
        </footer>
      </div>
    </div>
  )
}
