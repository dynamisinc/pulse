/**
 * features/staffShell/staffFlyout.ts
 * ---------------------------------------------------------------------------
 * Shared `sx` for the staff shell's right-edge FLYOUT panels (Personas dock, ENGINE settings,
 * USAGE, participant admin) at every width (feature: mobile-tablet, story 13; D7-011, D5-021,
 * TABLET-AMENDMENT §2/§4).
 *
 * Why one helper: four panels were each hand-rolling `position: absolute; top: 0; bottom: 0;
 * width: N; zIndex: 30`. At 768px a 460px USAGE panel is fine, but nothing stopped a wider future
 * panel from running past the viewport edge, nothing sized the close button for a finger, and the
 * "do not cover the sticky command band" rule had no seam. This is that single seam.
 *
 * ## The contract (also documented on `staffShellTokens.flyout`)
 *  - FULL HEIGHT of the pane area, with the panel's own scrolling body (panels keep their own
 *    `overflowY: auto` region; the panel itself is a flex column).
 *  - NEVER past the viewport edge: `maxWidth` clamps to the containing block (minus any right
 *    offset). The containing block is the work-area row / console root, so a flyout can never
 *    reach the header (a separate grid row) or the toolstrip (a separate column).
 *  - Starts at `var(--staff-flyout-top, 0px)`: an opt-in seam for a surface whose sticky band
 *    sits INSIDE the flyouts' containing block (set the property to the band's height). Unset by
 *    default; the controller console keeps its flyouts below its band and leaves it unset.
 *  - z-index {@link staffShellTokens.flyout.zIndex}: above work-area content, below MUI
 *    popovers/dialogs (1300+).
 *  - Close: every panel keeps a VISIBLE close button (sized 44x44 under `(pointer: coarse)` by
 *    {@link staffFlyoutCloseButtonSx}) AND Escape. No pointer-only dismiss, no trap.
 *
 * Real layout space only: the coarse-pointer growth is real `width`/`height`, never a
 * `::before`/`::after` hit-slop (an overflowing slop gets intercepted by neighbours).
 *
 * Staff world: no theme imports here, only tokens.
 */
import { STAFF_COARSE_POINTER_MEDIA, STAFF_TOUCH_TARGET_PX, staffShellTokens } from './staffShellTokens'

/**
 * `sx` for a flyout's outer panel. `rightPx` is the offset from the containing block's right edge
 * (0 for panels inside the console root, the toolstrip width for the shell-global overlay).
 */
export function staffFlyoutPanelSx(widthPx: number, rightPx = 0) {
  return {
    position: 'absolute',
    top: `var(${staffShellTokens.flyout.topVar}, 0px)`,
    right: rightPx,
    bottom: 0,
    width: widthPx,
    maxWidth: rightPx > 0 ? `calc(100% - ${rightPx}px)` : '100%',
    minHeight: 0,
    boxShadow: '-16px 0 40px rgba(0, 0, 0, 0.14)',
    zIndex: staffShellTokens.flyout.zIndex,
    display: 'flex',
    flexDirection: 'column',
  } as const
}

/** `sx` that grows a flyout's close button to a real 44x44 under a coarse pointer. */
export const staffFlyoutCloseButtonSx = {
  [STAFF_COARSE_POINTER_MEDIA]: {
    minWidth: STAFF_TOUCH_TARGET_PX,
    minHeight: STAFF_TOUCH_TARGET_PX,
    width: STAFF_TOUCH_TARGET_PX,
    height: STAFF_TOUCH_TARGET_PX,
  },
} as const
