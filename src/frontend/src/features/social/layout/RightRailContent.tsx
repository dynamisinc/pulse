/**
 * features/social/layout/RightRailContent.tsx
 * ---------------------------------------------------------------------------
 * WHAT the right rail contains -- separated from `RightRail.tsx` (the landmark
 * and its slots) so that adding a module is a one-file, one-line edit.
 *
 * TOP TO BOTTOM: the search box, the Trending panel (both F6, mounted here by the
 * orchestrator after F1 and F6 merged), then "Who to follow" (SOC-053, D1-R1: titled
 * exactly **Who to follow**, never "official"; capped at 3 rows).
 *
 * ON `/explore` the search box and Trending are NOT rendered: the Explore page has
 * its own, and one page must have exactly one search landmark and one trends region.
 * Both read the shared Explore baseline (`explore/exploreFeedStore`), so unmounting
 * one set while the other mounts in the same commit costs no refetch.
 *
 * World: participant. No COBRA, no MUI.
 */

import { WhoToFollow } from '../components/WhoToFollow'
import { SearchBox } from '../explore/SearchBox'
import { TrendingPanel } from '../explore/TrendingPanel'
import { RightRail } from './RightRail'
import { matchSocialRoute, useSocialNavigation } from './socialNavigation'

/**
 * How many "Who to follow" rows the rail shows. A DISPLAY cap only -- it never
 * changes which accounts are eligible or their planner-seeded order
 * (`WhoToFollow` / `whoToFollowService` own that, and nothing ranks anything).
 * The wire request is capped to the same number (`useWhoToFollow`).
 */
export const WHO_TO_FOLLOW_LIMIT = 3

export function RightRailContent() {
  const { location } = useSocialNavigation()
  const onExplore = matchSocialRoute(location.pathname) === 'explore'

  return (
    <RightRail
      searchSlot={onExplore ? undefined : <SearchBox variant="rail" />}
      trendingSlot={onExplore ? undefined : <TrendingPanel />}
    >
      <WhoToFollow limit={WHO_TO_FOLLOW_LIMIT} />
    </RightRail>
  )
}
