/**
 * features/social/layout/RightRail.tsx
 * ---------------------------------------------------------------------------
 * The right rail ("sidebar") of the three-column frame (demo-polish F1; D1-013
 * "344px sidebar"): the `aside[aria-label="Sidebar"]` landmark.
 *
 * It is a SLOT HOST, deliberately content-free:
 *   - `searchSlot`    -- F6's search box (top of the rail).
 *   - `trendingSlot`  -- F6's trending panel.
 *   - `children`      -- everything else, in order (today: "Who to follow").
 * Each slot is wrapped only when it is supplied, so an unfilled slot leaves no
 * empty box, margin or landmark noise behind. F6 never edits this file: the
 * orchestrator fills the slots in one place, `RightRailContent.tsx`.
 *
 * Below 1184px (`FRAME_MIN_WIDTH`) the whole rail is `display: none`, which also
 * removes it from the accessibility tree rather than merely moving it off-screen.
 * It pins below the shell's compliance banner and above the bottom one via
 * `--pulse-chrome-top` / `--pulse-chrome-bottom`.
 *
 * World: participant. CSS Module only -- no COBRA, no MUI.
 */

import type { ReactNode } from 'react'
import styles from './RightRail.module.css'

export interface RightRailProps {
  /** F6's search box. Empty until F6 lands. */
  searchSlot?: ReactNode
  /** F6's trending panel. Empty until F6 lands. */
  trendingSlot?: ReactNode
  /** The remaining modules, top to bottom (today: "Who to follow"). */
  children?: ReactNode
}

export function RightRail({ searchSlot, trendingSlot, children }: RightRailProps) {
  return (
    <aside className={styles.rail} aria-label="Sidebar" data-testid="right-rail">
      {searchSlot != null && (
        <div className={styles.search} data-testid="right-rail-search-slot">
          {searchSlot}
        </div>
      )}
      {trendingSlot != null && (
        <div className={styles.module} data-testid="right-rail-trending-slot">
          {trendingSlot}
        </div>
      )}
      {children != null && <div className={styles.module}>{children}</div>}
    </aside>
  )
}
