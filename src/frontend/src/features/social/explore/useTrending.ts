/**
 * features/social/explore/useTrending.ts
 * ---------------------------------------------------------------------------
 * The Trending panel's data hook (demo-polish F6; SOC-041 client-side). Reads the
 * loaded feed itself (`useFeed()` — the same exercise-scoped, participant-safe
 * read the main feed uses, so there is no new endpoint and no client `exerciseId`,
 * COR-001) and runs it through the memoized, pure `trendingTopics`.
 *
 * SCENARIO TIME (COR-053). The window is measured from the exercise clock's
 * "now" (`useScenarioTime()` → `scenarioNow()`), floored to the scenario MINUTE
 * so the ranking is stable between ticks and the memoized result is reused until
 * the minute (or the loaded feed) actually changes. No wall-clock is read.
 *
 * `loading` is true until the feed AND the cast have resolved (`useFeed`'s own
 * contract), so the panel never flashes "nothing is trending" while posts load.
 */

import { useMemo } from 'react'
import { useScenarioTime } from '@/core/clock'
import { useFeed } from '../hooks/useFeed'
import { trendingTopics, type TrendingTopic } from './trending'

const MINUTE_MS = 60_000

export interface UseTrendingResult {
  readonly topics: readonly TrendingTopic[]
  readonly loading: boolean
  readonly error: unknown
}

/** The top `limit` organic trends over the loaded feed. See the module header. */
export function useTrending(limit?: number): UseTrendingResult {
  const { posts, loading, error } = useFeed()
  // Only `now` is used; the zone is irrelevant to the window, so the default is fine.
  const { now } = useScenarioTime()
  const minute = Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS

  const topics = useMemo(
    () => trendingTopics(posts, { now: minute, limit }),
    [posts, minute, limit],
  )

  return { topics, loading, error }
}
