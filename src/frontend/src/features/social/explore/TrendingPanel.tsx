/**
 * features/social/explore/TrendingPanel.tsx
 * ---------------------------------------------------------------------------
 * The Trending panel (demo-polish F6, story 15-explore; SOC-041 client-side,
 * hashtags-trending/02 "lite", D1-R5). Participant world (Pulse Social skin):
 * plain semantic elements + a scoped CSS Module + FontAwesome only — NO COBRA, NO
 * themed MUI, NO `@mui/icons-material`.
 *
 * WHAT IT SHOWS. The top 5 (default; up to 10 via `limit`) hashtags over the
 * LOADED feed, ranked by recency-weighted activity in SCENARIO time. Each row has
 * a varied category line ("Trending", "Public safety · Trending"), the hashtag,
 * and a post-count line ("16 posts"). Nothing is declared by hand and nothing
 * carries an "official"/"promoted" cue — a trend is just a trend (D1-R5, SOC-041).
 * The ranking and its tie-break live in `trending.ts` (pure, memoized, unit
 * tested); the data comes from `useTrending()`, which reads the exercise-scoped
 * feed itself (no props from the host, COR-001).
 *
 * SELF-CONTAINED + WIDTH-AGNOSTIC. It takes no data props, so the orchestrator can
 * drop `<TrendingPanel />` into F1's right-rail `trendingSlot` (~344px) and
 * `ExplorePage` can render it in the 600px main column; it fills whatever width
 * its container gives it.
 *
 * NAVIGATION. Each row is a real `<a href="/hashtag/:tag">` (see
 * `exploreNavigation.ts`): activating it navigates to the hashtag feed — through
 * `onOpenHashtag` when the host supplies one (in-app, no reload), otherwise by
 * following the link. Rows are links, so they are natively keyboard-operable and
 * never a focusable no-op.
 *
 * STATES (never colour-only, NFR-001). Loading: "Loading trends…" (a polite
 * `role="status"`). Error: "Trends aren’t available right now." Empty: "Nothing
 * is trending yet." — all text. The list is an ordered list (`<ol role="list">`:
 * the rank is the order; `role` restores list semantics that `list-style: none`
 * drops in Safari).
 *
 * SCENARIO TIME (COR-053): the panel renders no timestamp; its window is measured
 * from scenario "now" (`useTrending`). Wall-clock is never read.
 */

import { useId } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowTrendUp } from '@fortawesome/free-solid-svg-icons'
import {
  activateLink,
  hashtagHref,
  useExploreOpeners,
  type ExploreOpenerProps,
} from './exploreNavigation'
import { useTrending } from './useTrending'
import styles from './TrendingPanel.module.css'

/** How many trends the panel lists by default (the rail). Explore passes 10. */
export const DEFAULT_TRENDING_LIMIT = 5

export interface TrendingPanelProps extends ExploreOpenerProps {
  /** Max trends listed (1..10). Default {@link DEFAULT_TRENDING_LIMIT}. */
  readonly limit?: number
}

function postCountLabel(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'post' : 'posts'}`
}

export function TrendingPanel({
  limit = DEFAULT_TRENDING_LIMIT,
  ...openerProps
}: TrendingPanelProps) {
  const { onOpenHashtag } = useExploreOpeners(openerProps)
  const { topics, loading, error } = useTrending(limit)
  const headingId = useId()

  const isEmpty = !loading && error === undefined && topics.length === 0

  return (
    <section
      className={styles.panel}
      aria-labelledby={headingId}
      data-testid="trending-panel"
    >
      <h2 id={headingId} className={styles.heading}>What’s happening</h2>

      {topics.length > 0 && (
        <ol className={styles.list} role="list" data-testid="trending-list">
          {topics.map(topic => (
            <li key={topic.tag} className={styles.row} data-testid="trending-row">
              <a
                className={styles.link}
                href={hashtagHref(topic.tag)}
                data-tag={topic.tag}
                onClick={event =>
                  activateLink(
                    event,
                    onOpenHashtag === undefined ? undefined : () => onOpenHashtag(topic.tag),
                  )
                }
              >
                <span className={styles.category}>
                  <FontAwesomeIcon
                    icon={faArrowTrendUp}
                    className={styles.categoryIcon}
                    aria-hidden="true"
                  />
                  {topic.category}
                </span>
                <span className={styles.tag}>{topic.display}</span>
                <span className={styles.count}>{postCountLabel(topic.postCount)}</span>
              </a>
            </li>
          ))}
        </ol>
      )}

      {loading && topics.length === 0 && (
        <p className={styles.state} role="status">Loading trends…</p>
      )}
      {!loading && error !== undefined && topics.length === 0 && (
        <p className={styles.state} role="status">Trends aren’t available right now.</p>
      )}
      {isEmpty && <p className={styles.state}>Nothing is trending yet.</p>}
    </section>
  )
}
