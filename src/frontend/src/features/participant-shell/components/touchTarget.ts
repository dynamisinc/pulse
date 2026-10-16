/**
 * features/participant-shell/components/touchTarget.ts
 * ---------------------------------------------------------------------------
 * The 44 px touch-target floor for compact participant-shell controls
 * (mobile-tablet stories 05 and 17; NFR-001).
 *
 * On a COARSE pointer only (phones, tablets) a matching control becomes an
 * `inline-flex` box at least 44×44 CSS px with its content centred, so the
 * tappable area is real layout space. Mouse layouts are untouched.
 *
 * Why real space and not an invisible `::after` hit-slop: a slop centred on a
 * compact control pokes outside its container whenever that container is
 * shorter than 44 px (a one-line alert band, the 38 px channel strip), and the
 * neighbour stacked above it (the compliance banner) or beside it (the channel
 * nav, the social rail) then wins the tap (Copilot review on #584). Growing
 * the control makes its container grow with it, so the target is never
 * obstructed.
 *
 * Usage: render `<style>{touchTargetCss('.my-class')}</style>` once and put
 * `my-class` on the control. A control with a visible chip/pill background
 * should wrap the pill in an inner element, so only the transparent outer
 * box grows (see the alert bar's "+N more").
 *
 * World: participant. Plain CSS string; no MUI, no COBRA.
 */

/** The minimum touch target, in CSS px. */
export const TOUCH_TARGET_MIN_PX = 44

/**
 * CSS that makes every element matching `selector` at least
 * {@link TOUCH_TARGET_MIN_PX} square on coarse pointers, content centred.
 */
export function touchTargetCss(selector: string): string {
  return `
@media (pointer: coarse) {
  ${selector} {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    min-width: ${TOUCH_TARGET_MIN_PX}px;
    min-height: ${TOUCH_TARGET_MIN_PX}px;
  }
}
`
}
