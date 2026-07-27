/**
 * features/planner/components/FieldGrid.tsx
 * ---------------------------------------------------------------------------
 * The one responsive field-layout primitive the exercise-configuration panels
 * lay their inputs out with (feature: exercise-configuration; issue #41).
 *
 * TWO WORLDS — STAFF (D0 §2 / CLAUDE.md). It renders inside the COBRA
 * `ThemeProvider` the staff shell mounts, uses `CobraStyles` for its gap, and
 * carries no colour of its own. Never used on a participant path.
 *
 * ============================================================================
 * WHY IT EXISTS: THE SECTIONS WERE SCROLLING
 * ============================================================================
 * Every settings section used to stack its fields in ONE column, so a section
 * with ten fields (theming: a brand name, four colours and five outlet names)
 * was ~1000px tall in an 844px work area — a planner had to scroll a
 * FULL-REPLACE form to reach its save button. Desktop-first staff surfaces have
 * horizontal room to spare and were not using it.
 *
 * Fields now flow into COLUMNS instead. Nothing is compressed to make that
 * work: no fixed heights, no shrunken controls, no reduced font sizes — the
 * COBRA `size="small"` field norms are untouched, the height simply comes out
 * of using the width that was already there.
 *
 * ============================================================================
 * GENUINELY RESPONSIVE, NOT "TWO COLUMNS"
 * ============================================================================
 * `repeat(auto-fit, minmax(min(100%, {minColumnWidth}px), 1fr))` is the whole
 * mechanism, and each half of it is load-bearing:
 *
 *  - `auto-fit` + `minmax(..., 1fr)` — the browser fits as many columns as the
 *    container can hold at `minColumnWidth` and shares the leftover width
 *    between them. A narrower pane simply gets fewer columns, down to one. No
 *    breakpoint list to keep in sync with the panel's `maxWidth`, and no width
 *    at which fields are squashed below `minColumnWidth`;
 *  - `min(100%, ...)` — the guard that makes it collapse instead of OVERFLOW.
 *    A bare `minmax(280px, 1fr)` track cannot go below 280px, so in a 240px
 *    pane the grid would be wider than its container and clip. `min(100%, …)`
 *    lets the single remaining track shrink with the container.
 *
 * A field that must keep the full width of the row (a brand name above its
 * colours, say) asks for it itself with `sx={{ gridColumn: '1 / -1' }}` — the
 * grid does not special-case its children.
 *
 * ACCESSIBILITY (NFR-001). CSS Grid does not reorder anything: the DOM order is
 * the visual order is the tab order, so a keyboard user still meets the fields
 * in the order they read them. Reading a multi-column form left-to-right,
 * row-by-row is the same order the markup is in — nothing here relies on
 * `grid-auto-flow: dense` or explicit placement, both of which would divorce
 * the two.
 */

import type { ReactNode } from 'react'
import { Box } from '@mui/material'
import CobraStyles from '@/theme/CobraStyles'

export interface FieldGridProps {
  /**
   * The narrowest a column may get before the grid drops one, in px.
   *
   * It is a readability floor, not a target: pick it from what the WIDEST
   * label + helper text in the group needs to stay legible, then let `auto-fit`
   * decide how many of them fit. Bigger number = fewer, roomier columns.
   */
  readonly minColumnWidth?: number
  readonly children: ReactNode
}

/**
 * Lays its children out in as many equal columns as the container can hold at
 * `minColumnWidth`, collapsing to a single column when it cannot hold two.
 */
export function FieldGrid({ minColumnWidth = 280, children }: FieldGridProps) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: CobraStyles.Spacing.FormFields,
        // `min(100%, …)` is what makes a too-narrow container collapse the grid
        // rather than overflow it — see the module header.
        gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minColumnWidth}px), 1fr))`,
        alignItems: 'start',
      }}
    >
      {children}
    </Box>
  )
}
