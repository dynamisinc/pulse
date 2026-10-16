/**
 * features/participant-shell/components/touchHitArea.ts
 * ---------------------------------------------------------------------------
 * Extended touch hit areas for compact participant-shell controls
 * (mobile-tablet stories 05 and 17; NFR-001, 44 px touch-target floor).
 *
 * The shell chrome (alert bar "Details →" / "+N more", the channel strip links)
 * is deliberately compact: growing the visible control would thicken the EAS
 * band or the 38 px strip. Instead, on a COARSE pointer only (phones, tablets),
 * an invisible, absolutely-positioned `::after` centred on the control grows
 * its tappable box to at least 44×44 CSS px. Mouse users see and get exactly
 * the old layout; the visual treatment never changes.
 *
 * Usage: render `<style>{touchHitAreaCss('.my-class')}</style>` once and put
 * `my-class` on the control. The control becomes `position: relative` (its
 * pseudo-element's containing block); nothing else about it changes.
 *
 * World: participant. Plain CSS string; no MUI, no COBRA.
 */

/** The minimum touch target, in CSS px. */
export const TOUCH_TARGET_MIN_PX = 44

/**
 * CSS that gives every element matching `selector` a hit area of at least
 * {@link TOUCH_TARGET_MIN_PX} square on coarse pointers, without changing its
 * rendered size or position.
 */
export function touchHitAreaCss(selector: string): string {
  return `
${selector} {
  position: relative;
}
@media (pointer: coarse) {
  ${selector}::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: max(100%, ${TOUCH_TARGET_MIN_PX}px);
    height: max(100%, ${TOUCH_TARGET_MIN_PX}px);
    transform: translate(-50%, -50%);
  }
}
`
}
