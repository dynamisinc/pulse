/**
 * core/hooks/useKeyboardOverlap.ts
 * ---------------------------------------------------------------------------
 * How many px the on-screen keyboard overlaps the BOTTOM EDGE OF A GIVEN ELEMENT'S CONTAINING
 * BLOCK (mobile-tablet story 14, W-002). Companion to `useVisualViewportInset`, which measures
 * against the layout viewport's bottom; that is the wrong edge for a panel absolutely positioned
 * inside a container that does not reach the bottom of the screen (the persona dock lives inside
 * the console's work area). Using the plain inset there over-lifts the panel.
 *
 *   lift = max(0, round(parent.getBoundingClientRect().bottom - (vv.offsetTop + vv.height)))
 *
 * where `parent` is `ref.current.offsetParent` (falling back to the element itself). Recomputed on
 * `visualViewport` `resize` and `scroll`, and once when it turns on. 0 without `visualViewport`
 * (jsdom, older browsers), when `enabled` is false, or before the ref is attached.
 *
 * Callers pass `enabled` = open and coarse pointer, so a hardware keyboard or desktop pinch-zoom
 * never moves anything. Real-device behaviour needs the on-device check (MT-D7 / story 16).
 *
 * Shared by both worlds (a hook, no UI).
 */

import { useEffect, useState, type RefObject } from 'react'

/** Pure maths, exported for tests. */
export function keyboardOverlap(
  containerBottom: number,
  viewport: { readonly height: number, readonly offsetTop: number },
): number {
  return Math.max(0, Math.round(containerBottom - (viewport.offsetTop + viewport.height)))
}

export function useKeyboardOverlap(ref: RefObject<HTMLElement | null>, enabled = true): number {
  const [lift, setLift] = useState(0)
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!enabled || vv === null || vv === undefined) return undefined
    const update = () => {
      const element = ref.current
      if (element === null) return
      const container = element.offsetParent ?? element
      setLift(keyboardOverlap(container.getBoundingClientRect().bottom, vv))
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      setLift(0)
    }
  }, [ref, enabled])
  return enabled ? lift : 0
}
