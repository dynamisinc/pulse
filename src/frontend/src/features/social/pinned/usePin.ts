/**
 * features/social/pinned/usePin.ts
 * ---------------------------------------------------------------------------
 * The Pin / Unpin state machine behind a post's action-row Pin control
 * (demo-feedback story 07; DF-6, COR-015, D1-011, NFR-001). Participant world - pure
 * hook, no UI. The same optimistic pattern as `useReaction` / `useReactionToggle`, minus
 * the count (a pin never has one):
 *
 *  - `pinned` is the viewer's own personal pin. It is the optimistic value while a write
 *    is in flight, else the state CONFIRMED this session (`pinState`, shared by every card
 *    showing the post), else the post's own `viewer.pinned`.
 *  - `toggle()` flips it OPTIMISTICALLY, then `PUT` / `DELETE /api/posts/{id}/reactions/pin`.
 *    On resolve it records the server's `active` in `pinState` and tells a mounted Pinned
 *    tab (`viewerEngagement`); on reject it drops the optimistic value - which restores
 *    exactly the pre-toggle state - and shows a brief failure message.
 *  - A second tap while a write is in flight is a no-op (a REF guard, so two taps in one
 *    tick cannot both pass).
 *  - `canPin` is the render gate, identical to the like control's: a writable session with
 *    a bound persona. When false the Pin control is ABSENT (it has no count to show inert).
 *
 * No client telemetry: the server emits `post.pinned` / `post.unpinned` (story 04).
 */

import { useCallback, useRef, useState, useSyncExternalStore } from 'react'
import { useSession } from '@/core/auth'
import { useTransientMessage, type UseTransientMessageResult } from '../hooks/useTransientMessage'
import { deletePin, putPin } from './pinService'
import { pinState, viewerEngagement } from './pinEvents'

/** Shown (and announced) when a pin / unpin write fails and is rolled back. */
export const PIN_FAILURE_MESSAGE = "Couldn't update your pin. Please try again."

/** Options for {@link usePin}. */
export interface UsePinOptions {
  readonly postId: string
  /** The post's `viewer.pinned` (absent = not pinned). */
  readonly initiallyPinned: boolean
  /** The card's shared failure-message channel (one live region per card). */
  readonly notice?: UseTransientMessageResult
}

/** What the action row binds the Pin control to. */
export interface UsePinResult {
  readonly pinned: boolean
  /** Writable session with a bound persona - else the control is absent. */
  readonly canPin: boolean
  readonly pending: boolean
  /** Flips the pin. A no-op unless `canPin`, and while a write is pending. */
  readonly toggle: () => void
}

export function usePin(options: UsePinOptions): UsePinResult {
  const { postId, initiallyPinned } = options
  const session = useSession()
  const canPin = !session.isReadOnly && session.personaId !== undefined

  const ownNotice = useTransientMessage()
  const { show, clear } = options.notice ?? ownNotice

  const confirmed = useSyncExternalStore(
    pinState.subscribe,
    () => pinState.get(postId),
    () => pinState.get(postId),
  )
  const [optimistic, setOptimistic] = useState<boolean | undefined>(undefined)
  const pinned = optimistic ?? confirmed ?? initiallyPinned

  const inFlightRef = useRef(false)
  const [pending, setPending] = useState(false)

  const toggle = useCallback(() => {
    if (!canPin || inFlightRef.current) return
    inFlightRef.current = true
    const next = !pinned
    setOptimistic(next)
    setPending(true)
    clear()

    const write = next ? putPin(postId) : deletePin(postId)
    write
      .then(
        state => {
          pinState.set(postId, state.active)
          setOptimistic(undefined)
          viewerEngagement.notify({ postId, kind: 'pin', active: state.active })
        },
        () => {
          // Roll back exactly: without the optimistic value the pre-toggle state shows again.
          setOptimistic(undefined)
          show(PIN_FAILURE_MESSAGE)
        },
      )
      .finally(() => {
        inFlightRef.current = false
        setPending(false)
      })
  }, [canPin, pinned, postId, clear, show])

  return { pinned, canPin, pending, toggle }
}
