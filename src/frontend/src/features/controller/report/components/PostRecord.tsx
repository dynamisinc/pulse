/**
 * features/controller/report/components/PostRecord.tsx
 * ---------------------------------------------------------------------------
 * The "Post record" section (story 29): posts and replies in scenario-time order, grouped under
 * their scenario half-hour. When white noise was left out of the list (DF-41) a note says how
 * many posts and that they are still counted in the metrics and the chart.
 *
 * Story 31 (DF-47): replies print indented under their listed thread root, and a thread stays in
 * its ROOT's half-hour group (`groupByHalfHour` re-derives thread order; it does not trust the
 * server's). A reply whose parent is not listed prints at its own time.
 *
 * Story 30: a one-line statement of the active filters prints above the list, and when the
 * record is WITHHELD (more matches than the printable limit) the list is replaced by how many
 * match and how to narrow it. The summary and charts above are unaffected.
 */

import { dateOf, groupByHalfHour, type PostGroup } from '../services/reportFormat'
import { describeFilters } from '../services/reportFilters'
import type { ReportPost, ReportPostRecord } from '../types/report'
import { ReportPostCard } from './ReportPostCard'
import styles from './report.module.css'

export interface PostRecordProps {
  readonly posts: readonly ReportPost[]
  readonly omittedNoiseCount: number
  readonly postRecord: ReportPostRecord
  /** Story 31: times inside cards carry their date when the report spans days. */
  readonly spansMultipleDays?: boolean
}

/** The day of a group's heading: its thread root's, the group's first post. */
function headingDay(group: PostGroup): string {
  return dateOf(group.posts[0]?.scenarioAt ?? '')
}

export function PostRecord({
  posts,
  omittedNoiseCount,
  postRecord,
  spansMultipleDays = false,
}: PostRecordProps) {
  const groups = groupByHalfHour(posts)
  return (
    <section className={styles.section} aria-labelledby="report-posts-h">
      <h2 id="report-posts-h" className={styles.heading}>
        Post record <small>Posts and replies in scenario-time order</small>
      </h2>
      <p className={styles.method} data-testid="filter-statement">
        {describeFilters(postRecord)}
      </p>
      {omittedNoiseCount > 0 && (
        <p className={styles.omit} data-testid="omitted-noise-note">
          {`Background noise (${omittedNoiseCount.toLocaleString('en-US')} ${omittedNoiseCount === 1 ? 'post' : 'posts'}) is left out of this list. It is counted in the metrics and charts above.`}
        </p>
      )}
      {postRecord.withheld && (
        <p className={styles.omit} data-testid="record-withheld">
          {`${postRecord.matching.toLocaleString('en-US')} posts match. The printable record holds up to ${postRecord.limit.toLocaleString('en-US')}. Narrow the sources or the time window above.`}
        </p>
      )}
      {!postRecord.withheld && groups.length === 0 && (
        <p className={styles.method}>No posts to list.</p>
      )}
      {groups.map(group => (
        <div key={group.key}>
          <div className={styles.hour}>{group.label}</div>
          <div className={styles.feed}>
            {group.posts.map(post => (
              <ReportPostCard
                key={post.id}
                post={post}
                nested={group.nestedIds.has(post.id)}
                spansMultipleDays={spansMultipleDays}
                showDate={dateOf(post.scenarioAt) !== headingDay(group)}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
