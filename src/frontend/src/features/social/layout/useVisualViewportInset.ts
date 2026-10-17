/**
 * features/social/layout/useVisualViewportInset.ts
 * ---------------------------------------------------------------------------
 * How much of the layout viewport's bottom is covered by the on-screen keyboard
 * (mobile-tablet story 02, composer AC). On iOS/Android the keyboard shrinks the VISUAL
 * viewport but not the layout viewport, so a `position: fixed` dialog stays full height and
 * its caret line / Post button end up under the keyboard. `ComposeModal` shifts its bottom
 * edge up by this many px so the dialog always fits what the participant can see.
 *
 * inset = max(0, window.innerHeight - (visualViewport.height + visualViewport.offsetTop)),
 * recomputed on the visual viewport's `resize` and `scroll`. Without `visualViewport`
 * (jsdom, older browsers) it is 0, i.e. no change. Whole pixels only, to avoid re-render
 * churn from sub-pixel jitter.
 *
 * World: participant. A hook, no UI.
 */

import { useEffect, useState } from 'react'

/** Pure maths, exported for tests. */
export function keyboardInset(
  innerHeight: number,
  viewport: { height: number, offsetTop: number },
): number {
  return Math.max(0, Math.round(innerHeight - (viewport.height + viewport.offsetTop)))
}

export function useVisualViewportInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (vv === null || vv === undefined) return undefined
    const update = () => setInset(keyboardInset(window.innerHeight, vv))
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
  return inset
}
