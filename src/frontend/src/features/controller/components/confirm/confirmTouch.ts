/**
 * features/controller/components/confirm/confirmTouch.ts
 * ---------------------------------------------------------------------------
 * Shared touch metrics + `sx` fragments for the deliberate-confirm steps (mobile-tablet story 15,
 * D5-025, TABLET-AMENDMENT §4 and §5). STAFF world.
 *
 * Every size here is REAL LAYOUT SPACE (`minHeight` / `minWidth` / `gap`): no `::before`/`::after`
 * hit-slop, because overflowing slop is intercepted by neighbours. Call sites apply these only
 * when `useCoarsePointer()` is true, so desktop is untouched.
 */

import { STAFF_TOUCH_TARGET_PX } from '@/features/staffShell/staffShellTokens'

/** Minimum touch target edge (WCAG 2.5.5 / amendment §4). */
export const TOUCH_TARGET_PX = STAFF_TOUCH_TARGET_PX
/** Minimum space between Cancel/Back and Confirm (amendment §5 rule 3). */
export const CONFIRM_GAP_MIN_PX = 8
/** What the confirm row actually uses on touch: comfortably above the 8px floor. */
export const CONFIRM_GAP_PX = 16

/** A button/control that is at least 44px tall and wide (real box size). */
export const touchTargetSx = {
  minHeight: TOUCH_TARGET_PX,
  minWidth: TOUCH_TARGET_PX,
} as const

/**
 * Extra hardening for the DESTRUCTIVE confirm button: no iPadOS double-tap zoom, no text
 * selection, no long-press callout (a long-press must never do anything but nothing).
 */
export const destructiveTouchSx = {
  touchAction: 'manipulation',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
} as const

/** Dim a confirm that is still inside its arming delay (it is also `aria-disabled`). */
export const ARMING_SX = {
  '&[aria-disabled="true"]': { opacity: 0.6, cursor: 'default' },
} as const

/** A radio row (label + control) that is a full 44px target on touch. */
export const touchRadioRowSx = {
  minHeight: TOUCH_TARGET_PX,
  '& .MuiRadio-root': { minWidth: TOUCH_TARGET_PX, minHeight: TOUCH_TARGET_PX },
} as const
