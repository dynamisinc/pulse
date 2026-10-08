/**
 * features/social/explore/ExplorePage.tsx
 * ---------------------------------------------------------------------------
 * The Explore page (demo-polish F6, story 15-explore; SOC-040/041/042), mounted at
 * `/explore` by F1's `SocialRoutes` with no props. Participant world (Pulse Social
 * skin): plain elements + a scoped CSS Module — NO COBRA, NO themed MUI.
 *
 * WHAT IT SHOWS. A labelled page (`<h1>Explore</h1>`) with the search box and, under
 * it, the Trending list (up to 10 organic trends). While a search is in progress the
 * results take the stage and Trending is HIDDEN (`hidden`), not unmounted: clearing the
 * box brings it straight back — no refetch, no "Loading trends…" flash — and the
 * shared baseline underneath is read once regardless. Activating a trend opens
 * `/hashtag/:tag`; a search result opens its thread or profile.
 *
 * The right rail has its own search and trending; it hides them on this route
 * (`RightRailContent`), so there is exactly one search landmark and one trends
 * region here.
 *
 * Both children read the shared Explore baseline (`exploreFeedStore`) and render in
 * scenario time only (COR-053).
 *
 * TELEMETRY (XC-004). One `view` event per mount, ref-guarded against re-renders and
 * StrictMode's double effect — the same shape as `HashtagFeed`'s, targeting the
 * `explore` page. The server emits no `view`, so the client emits in every mode.
 */

import { useEffect, useRef, useState } from 'react'
import { useSession } from '@/core/auth'
import { scenarioNow } from '@/core/clock'
import { useExerciseContext } from '@/core/exerciseContext'
import { buildAndEmit } from '@/core/telemetry'
import { wallClockNowIso } from '@/core/time/wallClock'
import type { ExploreOpenerProps } from './exploreNavigation'
import { SearchBox } from './SearchBox'
import { TrendingPanel } from './TrendingPanel'
import styles from './ExplorePage.module.css'

/** How many trends the Explore page lists (the right rail lists fewer). */
const EXPLORE_TRENDING_LIMIT = 10

export type ExplorePageProps = ExploreOpenerProps

export function ExplorePage(props: ExplorePageProps) {
  const { onOpenHashtag, onOpenPost, onOpenProfile } = props
  const { exerciseId, timeZone } = useExerciseContext()
  const session = useSession()
  // Trending yields to the results while a search is in progress.
  const [searching, setSearching] = useState(false)

  const viewEmittedRef = useRef(false)
  useEffect(() => {
    if (viewEmittedRef.current) return
    viewEmittedRef.current = true
    buildAndEmit({
      exerciseId,
      eventType: 'view',
      channel: 'social',
      actor: { kind: 'participant', participantId: session.accountId },
      wallClockTime: wallClockNowIso(),
      scenarioTime: scenarioNow().toISOString(),
      timeZone,
      target: { entityType: 'explore', entityId: 'explore' },
    })
  }, [exerciseId, timeZone, session.accountId])

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

      <div className={styles.trendingWrap} hidden={searching}>
        <TrendingPanel limit={EXPLORE_TRENDING_LIMIT} onOpenHashtag={onOpenHashtag} />
      </div>
    </section>
  )
}
