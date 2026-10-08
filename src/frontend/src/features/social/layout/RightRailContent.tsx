/**
 * features/social/layout/RightRailContent.tsx
 * ---------------------------------------------------------------------------
 * WHAT the right rail contains -- separated from `RightRail.tsx` (the landmark
 * and its slots) so that adding a module is a one-file, one-line edit.
 *
 * TODAY: "Who to follow" only. It moved here from the feed column (SOC-053,
 * D1-R1: the module is titled exactly **Who to follow**, never "official"); the
 * display cap is the same 3 rows the inline module used.
 *
 * ORCHESTRATOR-EDITED LATER. After F1 and F6 both merge, the orchestrator mounts
 * F6's search box and trending panel here by passing them to the two slots:
 *
 *     <RightRail searchSlot={<SearchBox />} trendingSlot={<TrendingPanel />}>
 *       <WhoToFollow limit={WHO_TO_FOLLOW_LIMIT} />
 *     </RightRail>
 *
 * No Wave-2 builder edits this file (implementation.md section 4.2). Nothing in
 * `social/layout/**` imports F6's files, so F1 builds and merges independently.
 *
 * World: participant. No COBRA, no MUI.
 */

import { WhoToFollow } from '../components/WhoToFollow'
import { RightRail } from './RightRail'

/**
 * How many "Who to follow" rows the rail shows. A DISPLAY cap only -- it never
 * changes which accounts are eligible or their planner-seeded order
 * (`WhoToFollow` / `whoToFollowService` own that, and nothing ranks anything).
 * The wire request is capped to the same number (`useWhoToFollow`).
 */
export const WHO_TO_FOLLOW_LIMIT = 3

export function RightRailContent() {
  return (
    <RightRail>
      <WhoToFollow limit={WHO_TO_FOLLOW_LIMIT} />
    </RightRail>
  )
}
