/**
 * features/social/explore/TrendingPanel.tsx
 * ---------------------------------------------------------------------------
 * The Trending panel (demo-polish F6, story 15-explore; SOC-041 client-side,
 * hashtags-trending/02 "lite", D1-R5). Participant world (Pulse Social skin):
 * plain semantic elements + a scoped CSS Module + FontAwesome only — NO COBRA, NO
 * themed MUI.
 *
 * WHAT IT SHOWS. The top 5 (default; up to 10 via `limit`) hashtags over the live
 * Explore baseline, ranked by recency-weighted activity in SCENARIO time. Each row
 * has a varied category line ("Trending", "Public safety · Trending"), the hashtag,
 * and a post-count line ("16 posts"). Nothing is declared by hand and nothing
 * carries an "official"/"promoted" cue — a trend is just a trend (D1-R5, SOC-041).
 * Ranking lives in `trending.ts`; the data in `useTrending()`, which reads the shared
 * baseline (`exploreFeedStore`) — so the rail's panel keeps moving as posts arrive.
 *
 * SELF-CONTAINED + WIDTH-AGNOSTIC. No data props: `<TrendingPanel />` mounts in the
 * ~344px right rail and `ExplorePage` renders it in the 600px column; it fills
 * whatever width it is given.
 *
 * NAVIGATION. Each row is a real `<a href="/hashtag/:tag">` (`exploreNavigation.ts`);
 * activating it opens the hashtag feed in-app. Rows are links, so they are natively
 * keyboard-operable.
 *
 * STATES (never colour-only, NFR-001). Loading: "Loading trends…" (a polite
 * `role="status"`). Failed read: "Trends aren’t available right now." Empty:
 * "Nothing is trending yet." The list is an ordered list (`<ol role="list">`: the
 * rank is the order; `role` restores list semantics `list-style: none` drops in
 * Safari).
 */

import { useId } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowTrendUp } from '@fortawesome/free-solid-svg-icons'
import { socialPaths } from '../layout/socialNavigation'
import { activateLink, useExploreOpeners, type ExploreOpenerProps } from './exploreNavigation'
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
  const { topics, loading, failed } = useTrending(limit)
  const headingId = useId()

  const isEmpty = !loading && !failed && topics.length === 0

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
                href={socialPaths.hashtag(topic.tag)}
                data-tag={topic.tag}
                onClick={event => activateLink(event, () => onOpenHashtag(topic.tag))}
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
      {failed && topics.length === 0 && (
        <p className={styles.state} role="status">Trends aren’t available right now.</p>
      )}
      {isEmpty && <p className={styles.state}>Nothing is trending yet.</p>}
    </section>
  )
}
