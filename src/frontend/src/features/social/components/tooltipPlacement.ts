/**
 * features/social/components/tooltipPlacement.ts
 * ---------------------------------------------------------------------------
 * The pure geometry of `ParticipantTooltip` (demo-feedback story 13, #494): where the
 * bubble goes, in viewport coordinates, given the control's box, the bubble's size, the
 * preferred side and the window. Kept apart from the component so the "never covers the
 * control" rule is unit-tested without layout (jsdom does none).
 *
 * World: participant. Pure functions, no UI.
 */

/** Space between the control's edge and the bubble (px). */
export const TOOLTIP_GAP = 6

/** Minimum distance kept from the viewport edge (px). */
const VIEWPORT_MARGIN = 8

export type TooltipPlacement = 'bottom' | 'top' | 'right'

export interface TooltipRect {
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}

export interface TooltipPosition {
  readonly top: number
  readonly left: number
  readonly placement: TooltipPlacement
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max))

/**
 * Where the bubble goes (viewport coordinates). Pure, so the "never covers the control"
 * rule is testable without layout: the bubble is always fully on one side of the anchor
 * (below, above or to the right) with `TOOLTIP_GAP` between them; it flips to the other
 * side when the preferred one would leave the viewport, and slides along its side to stay
 * `VIEWPORT_MARGIN` inside the window.
 */
export function placeTooltip(
  anchor: TooltipRect,
  bubble: { readonly width: number, readonly height: number },
  preferred: TooltipPlacement,
  viewport: { readonly width: number, readonly height: number },
): TooltipPosition {
  const below = anchor.top + anchor.height + TOOLTIP_GAP
  const above = anchor.top - TOOLTIP_GAP - bubble.height
  const fitsBelow = below + bubble.height <= viewport.height - VIEWPORT_MARGIN
  const fitsAbove = above >= VIEWPORT_MARGIN

  if (preferred === 'right') {
    const left = anchor.left + anchor.width + TOOLTIP_GAP
    if (left + bubble.width <= viewport.width - VIEWPORT_MARGIN) {
      const top = clamp(
        anchor.top + anchor.height / 2 - bubble.height / 2,
        VIEWPORT_MARGIN,
        viewport.height - VIEWPORT_MARGIN - bubble.height,
      )
      return { top, left, placement: 'right' }
    }
    // No room on the right: fall back to the default side.
    return placeTooltip(anchor, bubble, 'bottom', viewport)
  }

  const useBelow = preferred === 'bottom' ? fitsBelow || !fitsAbove : !fitsAbove && fitsBelow
  const left = clamp(
    anchor.left + anchor.width / 2 - bubble.width / 2,
    VIEWPORT_MARGIN,
    viewport.width - VIEWPORT_MARGIN - bubble.width,
  )
  return useBelow
    ? { top: below, left, placement: 'bottom' }
    : { top: above, left, placement: 'top' }
}
