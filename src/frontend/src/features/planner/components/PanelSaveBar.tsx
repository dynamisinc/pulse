/**
 * features/planner/components/PanelSaveBar.tsx
 * ---------------------------------------------------------------------------
 * The save/revert footer of an exercise-configuration panel, PINNED to the
 * bottom of the scrolling content pane (feature: exercise-configuration; #41).
 *
 * TWO WORLDS — STAFF (D0 §2 / CLAUDE.md). It renders inside the COBRA
 * `ThemeProvider` the staff shell mounts and takes its background straight from
 * the COBRA palette; it holds no buttons of its own, so every caller keeps
 * using `CobraPrimaryButton` / `CobraSecondaryButton`.
 *
 * ============================================================================
 * WHY IT IS STICKY — THIS IS A SAFETY PROPERTY, NOT A FLOURISH
 * ============================================================================
 * `ExerciseSettingsPage` moved its scroll INTO the content pane so the page
 * heading and the section nav stay put. That change, on its own, would have
 * made a FULL-REPLACE form more dangerous rather than less: sections 1–3 are
 * three views over ONE form with ONE save, and if that save can scroll out of
 * reach then a planner who has edited theming has to go looking for the button
 * that commits identity, channels AND theming together. So whatever else
 * scrolls, the commit point does not move.
 *
 * The save OUTCOME rides in the same sticky block, deliberately: a
 * `role="alert"` that says "nothing was sent to the server" is worthless
 * sitting below the fold under the button that just refused to send. Pinning
 * the buttons and letting their explanation scroll away would be the same bug
 * in a smaller form.
 *
 * ============================================================================
 * WHAT MAKES IT WORK
 * ============================================================================
 *  - `position: sticky; bottom: 0` sticks against the nearest scrolling
 *    ancestor — the page's content pane. When a panel is shorter than the pane
 *    (channels, practice) sticky is a no-op and the bar simply sits in flow, so
 *    this costs nothing on the sections that never scrolled;
 *  - an OPAQUE background (`background.default`, the same token the staff
 *    shell's work area uses) so scrolled content passes behind it instead of
 *    showing through, plus the divider above it as the edge;
 *  - the negative bottom margin + matching padding let the pane's own bottom
 *    padding scroll away underneath the bar rather than leaving a stripe of
 *    background below it.
 *
 * ACCESSIBILITY (NFR-001, WCAG 2.1 AA):
 *  - a sticky bar overlays the bottom of the scrollport, so a field tabbed to
 *    near the end of the form could be scrolled to underneath it. The fix is on
 *    the SCROLL CONTAINER, not here: the content pane sets `scroll-padding-
 *    bottom` to {@link PANEL_SAVE_BAR_SCROLL_PADDING_PX}, which is what the
 *    browser keeps clear when it scrolls a focused control into view. That
 *    constant is exported from this file so the height that hides things and
 *    the height that is kept clear cannot drift apart;
 *  - it is the LAST content of the form in the DOM, exactly where it was
 *    before, so the reading and tab order are unchanged — sticky positioning
 *    moves pixels, never the accessibility tree.
 */

import type { ReactNode } from 'react'
import { Box, Divider } from '@mui/material'
import CobraStyles from '@/theme/CobraStyles'

/**
 * How much room the pinned save bar can take at the bottom of the scrollport,
 * in px — and therefore how much `scroll-padding-bottom` the scrolling content
 * pane must reserve so a focused field is never scrolled to underneath it.
 *
 * Sized for the WORST case, not the usual one: the divider, the button row and
 * a two-line `role="alert"` under it (~150px). Over-reserving only means a
 * focused field settles a little higher than it strictly had to;
 * under-reserving means a planner types into a box they cannot see.
 */
export const PANEL_SAVE_BAR_SCROLL_PADDING_PX = 160

export interface PanelSaveBarProps {
  /** The buttons, and the save/validation messages that explain them. */
  readonly children: ReactNode
}

/**
 * Pins a panel's commit controls to the bottom of the scrolling content pane.
 * See the module header for why that is a correctness requirement here.
 */
export function PanelSaveBar({ children }: PanelSaveBarProps) {
  return (
    <Box
      data-testid="panel-save-bar"
      sx={{
        // Sticky ONLY where the content pane is the scrollport, i.e. `lg`+.
        //
        // Below `lg` the page reverts to flow and the real scrolling ancestor is
        // StaffShellFrame's work area (`overflow: auto` on the shell's own
        // element). A sticky bar would then pin against THAT, while the
        // `scroll-padding-bottom` reserved for it sits on the content pane,
        // which is no longer scrolling and so contributes nothing. The result
        // is the exact failure this bar exists to prevent: a field tabbed to
        // near the end of a form scrolled to underneath the buttons.
        //
        // Fixing it by reaching into the shell's work area was the alternative,
        // and it is worse: the planner feature does not own that element, and
        // styling another feature's scrollport from here is how layout bugs
        // become cross-feature. In flow the bar simply follows the last field,
        // which is what the stacked page did and is perfectly usable narrow.
        position: { xs: 'static', lg: 'sticky' },
        bottom: 0,
        // Above the fields it overlays; below MUI's modals/menus (1300+).
        zIndex: 2,
        bgcolor: 'background.default',
        mt: 3,
        // Swallow the content pane's bottom padding, so scrolled content passes
        // behind the bar instead of stopping short of it.
        mb: `-${CobraStyles.Padding.MainWindow}`,
        pb: CobraStyles.Padding.MainWindow,
      }}
    >
      <Divider />
      {children}
    </Box>
  )
}
