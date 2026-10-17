/**
 * core/hooks/useVisualViewportInset.ts
 * ---------------------------------------------------------------------------
 * How many px of the layout viewport's bottom the on-screen keyboard covers. On iOS/iPadOS
 * and Android the keyboard shrinks the VISUAL viewport but not the layout viewport, so a
 * `position: fixed` dialog keeps its full height and its bottom (caret line, Post / Confirm
 * button) ends up under the keys. Callers shift or pad that edge by this many px so the
 * dialog fits what the user can actually see.
 *
 * inset = max(0, window.innerHeight - (visualViewport.height + visualViewport.offsetTop)),
 * recomputed on the visual viewport's `resize` and `scroll`. Whole pixels only, to avoid
 * re-render churn from sub-pixel jitter. Without `visualViewport` (jsdom, older browsers),
 * or with `enabled` false, it is 0, i.e. no change.
 *
 * Shared by both worlds (a hook, no UI, no theming):
 *  - participant: `social/layout/ComposeModal` (mobile-tablet story 02), always enabled;
 *  - staff: `controller/lifecycle/EndExerciseDialog` (story 15, TABLET-AMENDMENT §5 rule 5),
 *    enabled only on a coarse pointer (a hardware keyboard has no on-screen one).
 */

import { useEffect, useState } from 'react'

/** Pure maths, exported for tests. */
export function keyboardInset(
  innerHeight: number,
  viewport: { readonly height: number, readonly offsetTop: number },
): number {
  return Math.max(0, Math.round(innerHeight - (viewport.height + viewport.offsetTop)))
}

export function useVisualViewportInset(enabled = true): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!enabled || vv === null || vv === undefined) return undefined
    const update = () => setInset(keyboardInset(window.innerHeight, vv))
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      setInset(0)
    }
  }, [enabled])
  return enabled ? inset : 0
}
