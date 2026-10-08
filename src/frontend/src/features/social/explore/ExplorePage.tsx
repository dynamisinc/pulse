/**
 * features/social/explore/ExplorePage.tsx
 * ---------------------------------------------------------------------------
 * The Explore page (demo-polish F6, story 15-explore; SOC-040/041/042). F0 left a
 * stub here so F1 (the router, which mounts this at `/explore`) had something to
 * import; F6 fills it in. Participant world (Pulse Social skin): plain elements +
 * a scoped CSS Module — NO COBRA, NO themed MUI.
 *
 * WHAT IT SHOWS. A labelled page (`<h1>Explore</h1>`) with the search box and, under
 * it, the Trending list (up to 10 organic trends). While a search is in progress
 * the results replace the trending list — one thing at a time, like a consumer
 * app — and clearing the box brings Trending back. Activating a trend navigates to
 * `/hashtag/:tag`; opening a search result navigates to the post's thread or the
 * account's profile.
 *
 * NO REQUIRED PROPS. F1 mounts `<ExplorePage />` with no props. The optional
 * `onOpen*` callbacks (`exploreNavigation.ts`) exist for hosts that want in-app
 * navigation; without them every row is a real link to its route, so the page
 * works as-is. See that module for the one `TODO(F1-merge)` swap.
 *
 * Both children read the exercise-scoped feed and cast themselves (no data props,
 * COR-001), and render in scenario time only (COR-053).
 */

import { useState } from 'react'
import type { ExploreOpenerProps } from './exploreNavigation'
import { SearchBox } from './SearchBox'
import { TrendingPanel } from './TrendingPanel'
import styles from './ExplorePage.module.css'

/** How many trends the Explore page lists (the right rail lists fewer). */
const EXPLORE_TRENDING_LIMIT = 10

export type ExplorePageProps = ExploreOpenerProps

export function ExplorePage(props: ExplorePageProps) {
  const { onOpenHashtag, onOpenPost, onOpenProfile } = props
  // Trending yields to the results while a search is in progress.
  const [searching, setSearching] = useState(false)

  return (
    <section className={styles.page} aria-labelledby="explore-heading" data-testid="explore-page">
      <h1 id="explore-heading" className={styles.title}>Explore</h1>

      <div className={styles.searchWrap}>
        <SearchBox
          onSearchingChange={setSearching}
          onOpenPost={onOpenPost}
          onOpenProfile={onOpenProfile}
        />
      </div>

      {!searching && (
        <div className={styles.trendingWrap}>
          <TrendingPanel limit={EXPLORE_TRENDING_LIMIT} onOpenHashtag={onOpenHashtag} />
        </div>
      )}
    </section>
  )
}
