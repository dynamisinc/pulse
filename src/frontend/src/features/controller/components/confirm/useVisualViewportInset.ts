/**
 * features/controller/components/confirm/useVisualViewportInset.ts
 * ---------------------------------------------------------------------------
 * How many px of the layout viewport's bottom the on-screen keyboard covers (mobile-tablet
 * story 15, TABLET-AMENDMENT §5 rule 5: "the on-screen keyboard never hides the END field or its
 * Confirm button, so lay these out against the visual viewport"). STAFF world hook, no UI.
 *
 * On iPadOS the keyboard shrinks the VISUAL viewport but not the layout viewport, so a centred
 * fixed dialog keeps its full-height frame and its bottom (the Confirm row) ends up under the
 * keys. `EndExerciseDialog` pads its container's bottom by this inset so the dialog is centred in
 * what the controller can actually see.
 *
 * inset = max(0, innerHeight - (visualViewport.height + visualViewport.offsetTop)), recomputed on
 * the visual viewport's `resize` / `scroll`, whole pixels only. `enabled` false (a fine pointer: a
 * hardware keyboard has no on-screen one) or no `visualViewport` (jsdom, old browsers) gives 0.
 * The staff world keeps its own copy rather than importing the participant social layout hook.
 */

import { useEffect, useState } from 'react'

export function keyboardInset(
  innerHeight: number,
  viewport: { readonly height: number, readonly offsetTop: number },
): number {
  return Math.max(0, Math.round(innerHeight - (viewport.height + viewport.offsetTop)))
}

export function useVisualViewportInset(enabled: boolean): number {
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
