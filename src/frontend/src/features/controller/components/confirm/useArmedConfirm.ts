/**
 * features/controller/components/confirm/useArmedConfirm.ts
 * ---------------------------------------------------------------------------
 * The shared "deliberate confirm" guard for the four guarded controller actions: Takedown,
 * Freeze world, End exercise and the kill switch's STOP -> Live re-arm (mobile-tablet story 15,
 * D5-025, TABLET-AMENDMENT §5 rules 1 and 4). STAFF world hook, no UI.
 *
 * WHAT IT DOES. Given whether a confirm step is `open`, it
 *   1. ARMS the step `delayMs` (400) after it opens: until then {@link guard}ed taps are ignored.
 *      This blocks ghost taps and a double-tap that carries over from the control that opened
 *      the step. `armed` is exposed so the confirm button can show `aria-disabled` meanwhile
 *      (state is never silent);
 *   2. FIRES ONCE: the first guarded tap runs the action, every later one is ignored until the
 *      step closes and reopens (or `resetKey` changes, for a step that legitimately stays open
 *      after a refused request, such as EndEx, so retrying is still one tap).
 *
 * DECISION: THE DELAY IS TOUCH-ONLY. `enabled` is `useCoarsePointer()` at every call site.
 * TABLET-AMENDMENT §5 is headed "Deliberate confirms on touch", and the amendment's scope line
 * (its line 6) says desktop at 1280px and wider does not change. So the delay applies on a
 * coarse pointer only: a desktop
 * keyboard user who opens Freeze and presses Enter right away is not silently ignored, and the
 * desktop feel stays exactly as it was. With `enabled` false the step is armed the moment it is
 * open; "fires once" still applies.
 *
 * The guard is a ref check at event time, so two taps in the same frame (before React re-renders)
 * still fire once. Timers are cleaned up on close and unmount.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** TABLET-AMENDMENT §5 rule 4. */
export const ARMING_DELAY_MS = 400

export interface UseArmedConfirmOptions {
  /** True while the confirm step is showing. The delay restarts on each false -> true. */
  readonly open: boolean
  /** Apply the arming delay (touch only). When false the step is armed as soon as it is open. */
  readonly enabled: boolean
  readonly delayMs?: number
  /** Change this to allow one more fire without closing the step (a refused request). */
  readonly resetKey?: unknown
}

export interface ArmedConfirm {
  /** False while the arming delay runs (render the confirm `aria-disabled`). */
  readonly armed: boolean
  /** Wrap the confirm action: ignored until armed, and after it has fired once. */
  readonly guard: (action: () => void) => () => void
}

export function useArmedConfirm({
  open,
  enabled,
  delayMs = ARMING_DELAY_MS,
  resetKey,
}: UseArmedConfirmOptions): ArmedConfirm {
  const [timerArmed, setTimerArmed] = useState(false)
  const armedRef = useRef(false)
  const firedRef = useRef(false)

  useEffect(() => {
    if (!open) return undefined
    firedRef.current = false
    if (!enabled) {
      armedRef.current = true
      return () => {
        armedRef.current = false
      }
    }
    armedRef.current = false
    const timer = window.setTimeout(() => {
      armedRef.current = true
      setTimerArmed(true)
    }, delayMs)
    return () => {
      window.clearTimeout(timer)
      armedRef.current = false
      setTimerArmed(false)
    }
  }, [open, enabled, delayMs])

  // `resetKey` allows one more fire, but must not re-arm a fire that happened this open cycle
  // merely because the effect also runs on mount / when the step opens (that is handled above).
  const prevOpenRef = useRef(open)
  const mountedRef = useRef(false)
  useEffect(() => {
    const wasOpen = prevOpenRef.current
    prevOpenRef.current = open
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    // Reset on a genuine resetKey change while the step stays open; opening is reset above.
    if (open && wasOpen) firedRef.current = false
  }, [resetKey, open])

  const guard = useCallback((action: () => void) => () => {
    if (!armedRef.current || firedRef.current) return
    firedRef.current = true
    action()
  }, [])

  return { armed: open && (!enabled || timerArmed), guard }
}
