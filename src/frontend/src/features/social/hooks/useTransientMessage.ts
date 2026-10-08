/**
 * features/social/hooks/useTransientMessage.ts
 * ---------------------------------------------------------------------------
 * A tiny "show this short message, then let it go" state holder (demo-polish F3).
 * It backs the BRIEF inline error a failed like / repost shows under the action
 * row (NFR-001): the message is rendered into a polite live region, so assistive
 * technology announces it without stealing focus, and it dismisses itself so a
 * transient failure never leaves a stale error on the card.
 *
 *  - `show(text)` replaces whatever is displayed and (re)starts the dismiss timer.
 *  - `clear()` removes it now (called when the user tries again).
 *  - The timer is cleared on unmount, and a `show` that arrives AFTER unmount (a
 *    write that rejects once its card has gone) is ignored, so a card that scrolls
 *    away never leaves a timer or a state update behind.
 *
 * Participant world — plain React state; no UI of its own.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** How long a failure message stays on screen before it dismisses itself. */
export const TRANSIENT_MESSAGE_MS = 6000

export interface UseTransientMessageResult {
  /** The message currently shown, or `null` when there is none. */
  readonly message: string | null
  /** Shows `text`, replacing any current message and restarting the dismiss timer. */
  readonly show: (text: string) => void
  /** Removes the message immediately. */
  readonly clear: () => void
}

export function useTransientMessage(
  durationMs: number = TRANSIENT_MESSAGE_MS,
): UseTransientMessageResult {
  const [message, setMessage] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mountedRef = useRef(true)

  const cancelTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
  }, [])

  const clear = useCallback(() => {
    cancelTimer()
    setMessage(null)
  }, [cancelTimer])

  const show = useCallback(
    (text: string) => {
      if (!mountedRef.current) return
      cancelTimer()
      setMessage(text)
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined
        setMessage(null)
      }, durationMs)
    },
    [cancelTimer, durationMs],
  )

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cancelTimer()
    }
  }, [cancelTimer])

  return { message, show, clear }
}
