/**
 * features/controller/report/components/InjectResponseTable.tsx
 * ---------------------------------------------------------------------------
 * "Inject response times" (story 17, DF-25): one row per delivered inject with the first
 * participant response, a bar proportional to the minutes it took (full width = the 30-minute
 * window) and who responded; an inject nobody answered shows a "No response in 30 min" pill.
 * The method note under the table states the rule in the words the story approves.
 */

import { refLabel, timeOf } from '../services/reportFormat'
import type { ReportInjectResponse } from '../types/report'
import styles from './report.module.css'

/** The DF-25 window, in scenario minutes. */
const WINDOW_MINUTES = 30
/** Pixel width of a full-window bar. */
const FULL_BAR_PX = 180

export const RESPONSE_METHOD_NOTE =
  "A response is a participant's reply to one of the inject's posts, or a participant post that " +
  'mentions the account that posted it, within 30 scenario minutes.'

export interface InjectResponseTableProps {
  readonly rows: readonly ReportInjectResponse[]
}

export function InjectResponseTable({ rows }: InjectResponseTableProps) {
  return (
    <section className={styles.section} aria-labelledby="report-injects-h">
      <h2 id="report-injects-h" className={styles.heading}>
        Inject response times <small>Delivered injects and the first participant response</small>
      </h2>
      {rows.length === 0 ? (
        <p className={styles.method}>No injects were delivered.</p>
      ) : (
        <div className={styles.tablewrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Inject</th>
                <th scope="col">Delivered</th>
                <th scope="col">First participant response</th>
                <th scope="col">Responded as</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const responded = row.responseMinutes !== null && row.firstResponseAt !== null
                const width = Math.max(
                  2,
                  Math.round(((row.responseMinutes ?? 0) / WINDOW_MINUTES) * FULL_BAR_PX),
                )
                return (
                  <tr key={`${rowIndex}-${row.ref}`}>
                    <td>{`${refLabel(row.ref)} ${row.title}`}</td>
                    <td className={styles.tcell}>{timeOf(row.deliveredAt)}</td>
                    <td>
                      {responded ? (
                        <div className={styles.resp}>
                          <i style={{ width }} aria-hidden="true" />
                          <span>{`${Math.round(row.responseMinutes ?? 0)} min · ${timeOf(row.firstResponseAt ?? '')}`}</span>
                        </div>
                      ) : (
                        <span className={styles.none}>NO RESPONSE IN 30 MIN</span>
                      )}
                    </td>
                    <td>{row.respondedAsHandle ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.method}>{RESPONSE_METHOD_NOTE}</p>
    </section>
  )
}
