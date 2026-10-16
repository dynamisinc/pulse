/**
 * features/controller/report/components/PostRecord.tsx
 * ---------------------------------------------------------------------------
 * The "Post record" section (story 29): posts and replies in scenario-time order, grouped under
 * their scenario half-hour. When white noise was left out of the list (DF-41) a note says how
 * many posts and that they are still counted in the metrics and the chart.
 *
 * Story 30: a one-line statement of the active filters prints above the list, and when the
 * record is WITHHELD (more matches than the printable limit) the list is replaced by how many
 * match and how to narrow it. The summary and charts above are unaffected.
 */

import { groupByHalfHour } from '../services/reportFormat'
import { describeFilters } from '../services/reportFilters'
import type { ReportPost, ReportPostRecord } from '../types/report'
import { ReportPostCard } from './ReportPostCard'
import styles from './report.module.css'

export interface PostRecordProps {
  readonly posts: readonly ReportPost[]
  readonly omittedNoiseCount: number
  readonly postRecord: ReportPostRecord
}

export function PostRecord({ posts, omittedNoiseCount, postRecord }: PostRecordProps) {
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
              <ReportPostCard key={post.id} post={post} />
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
