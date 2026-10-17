/**
 * features/controller/consoleTouch.ts
 * ---------------------------------------------------------------------------
 * The console's COARSE-POINTER sizing fragments (mobile-tablet story 14, D5-024, TABLET-AMENDMENT
 * section 4). STAFF world; plain `sx` fragments, no components.
 *
 * THE RULE. Under `(pointer: coarse)` every console action control is at least 44 x 44 CSS px and
 * at least 8px from its neighbour. The gate is the POINTER, never the viewport width: an iPad with
 * a trackpad still gets the tablet layout, and a narrow desktop window gets desktop-size controls.
 *
 * REAL LAYOUT SPACE, NOT HIT-SLOP. The 44px is a `min-width` / `min-height` on the control itself,
 * so its container grows with it and a neighbour can never sit on top of the tappable area. No
 * `::before` / `::after` slop (the same decision as story 13's toolstrip and story 05's channel
 * strip). Mouse layouts are untouched because the fragments live inside the media query.
 *
 * Spread a fragment into an `sx`: `sx={{ ...base, ...COARSE_TARGET_SX }}`. Both are keyed by the
 * media query, so they merge with an element's own `@media` block only if it is spread LAST (spread
 * order wins); no element here has another `(pointer: coarse)` block of its own.
 *
 * Toolstrip buttons are story 13's; the confirm internals are story 15's. Neither uses this file.
 */

import {
  STAFF_COARSE_POINTER_MEDIA,
  STAFF_TOUCH_GAP_PX,
  STAFF_TOUCH_TARGET_PX,
} from '@/features/staffShell/staffShellTokens'

// ONE source of truth (story 13's staff tokens): 44, 8 and the coarse-pointer media key.
/** Minimum touch target, CSS px (TABLET-AMENDMENT section 4). */
export const CONSOLE_TOUCH_TARGET_PX = STAFF_TOUCH_TARGET_PX
/** Minimum gap between adjacent touch actions, CSS px. */
export const CONSOLE_TOUCH_GAP_PX = STAFF_TOUCH_GAP_PX

/** The media query key used in `sx`. */
export const CONSOLE_COARSE_MEDIA = STAFF_COARSE_POINTER_MEDIA

/** Grow a control to a 44 x 44 box, content centred (an inline-flex control stays inline-flex). */
export const COARSE_TARGET_SX = {
  [CONSOLE_COARSE_MEDIA]: {
    minWidth: `${CONSOLE_TOUCH_TARGET_PX}px`,
    minHeight: `${CONSOLE_TOUCH_TARGET_PX}px`,
    justifyContent: 'center',
  },
} as const

/** Grow a control to 44px tall only (a wide control such as a text button or a slider track). */
export const COARSE_TALL_SX = {
  [CONSOLE_COARSE_MEDIA]: {
    minHeight: `${CONSOLE_TOUCH_TARGET_PX}px`,
  },
} as const

/** Space a row/column of adjacent actions at least 8px apart. */
export const COARSE_GAP_SX = {
  [CONSOLE_COARSE_MEDIA]: {
    gap: `${CONSOLE_TOUCH_GAP_PX}px`,
  },
} as const
