/**
 * features/social/explore/useTrending.ts
 * ---------------------------------------------------------------------------
 * The Trending panel's data hook (demo-polish F6; SOC-041 client-side). Reads the
 * shared, LIVE Explore baseline (`useExploreBaseline` — the newest-200 top-level
 * posts, kept current by arrivals; one feed read however many panels are mounted)
 * and ranks it with the memoized, pure `trendingTopics`.
 *
 * WHEN IT RECOMPUTES: when the baseline publishes a new batch of arrivals, or the
 * scenario MINUTE changes — never per render. "Now" is the exercise clock's
 * (`useScenarioTime()` → `scenarioNow()`), floored to the minute, so the window and
 * decay are scenario time (COR-053); no wall-clock is read.
 *
 * FUTURE-DATED POSTS. Posts stamped more than 15 scenario minutes ahead of "now" are
 * skipped (they are not recent activity). The one exception is the dev mock
 * (`USE_MOCK_DATA`): its fixtures are dated 2033 while its clock mirrors the wall
 * clock, so the tolerance is lifted there and the fixtures trend.
 */

import { useMemo } from 'react'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { useScenarioTime } from '@/core/clock'
import { useExploreBaseline } from './useExploreFeed'
import { trendingTopics, type TrendingTopic } from './trending'

const MINUTE_MS = 60_000

export interface UseTrendingResult {
  readonly topics: readonly TrendingTopic[]
  readonly loading: boolean
  /** The baseline read failed (the store is retrying). */
  readonly failed: boolean
}

/** The top `limit` organic trends over the live baseline. See the module header. */
export function useTrending(limit?: number): UseTrendingResult {
  const { posts, loading, failed } = useExploreBaseline()
  // Only `now` is used; the zone is irrelevant to the window, so the default is fine.
  const { now } = useScenarioTime()
  const minute = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS

  const topics = useMemo(
    () =>
      trendingTopics(posts, {
        now: minute,
        limit,
        ...(USE_MOCK_DATA ? { futureToleranceMs: Number.POSITIVE_INFINITY } : {}),
      }),
    [posts, minute, limit],
  )

  return { topics, loading, failed }
}
