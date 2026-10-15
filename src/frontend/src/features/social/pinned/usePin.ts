/**
 * features/social/pinned/usePin.ts
 * ---------------------------------------------------------------------------
 * The personal-pin state machine behind a post's action-row Pin control
 * (demo-feedback story 07; DF-6, COR-015, D1-011, NFR-001). Participant world - pure
 * hook, no UI. The same optimistic pattern as `useReaction` / `useReactionToggle`, minus
 * the count (a pin never has one):
 *
 *  - `pinned` is the viewer's own personal pin. It is the optimistic value while a write
 *    is in flight, else the state CONFIRMED this session (`pinState`, shared by every card
 *    showing the post), else the post's own `viewer.pinned`.
 *  - FRESHER SERVER DATA WINS. A confirmed pin outranks the post's flag only until a LATER
 *    read arrives: when the caller hands in a new `serverSnapshot` (a new `viewer` object
 *    means a new read) whose `viewer.pinned` disagrees with the confirmed state, that newer
 *    server value is recorded in `pinState` for every card (skipped while this card's own
 *    write is in flight). The snapshot a card MOUNTS with is never treated as fresher - a
 *    frozen feed baseline can predate a pin made this session.
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

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
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
  /**
   * The read the flag came from - the post's `viewer` object. A NEW object after mount is a
   * newer read whose `pinned` value wins over an older confirmed state (module header).
   */
  readonly serverSnapshot?: object
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

  // A newer read (a new snapshot object after mount) overrides an older confirmed pin.
  const { serverSnapshot } = options
  const snapshotRef = useRef(serverSnapshot)
  useEffect(() => {
    if (snapshotRef.current === serverSnapshot) return
    snapshotRef.current = serverSnapshot
    if (serverSnapshot === undefined || inFlightRef.current) return
    const known = pinState.get(postId)
    if (known !== undefined && known !== initiallyPinned) pinState.set(postId, initiallyPinned)
  }, [serverSnapshot, initiallyPinned, postId])

  const toggle = useCallback(() => {
    if (!canPin || inFlightRef.current) return
    inFlightRef.current = true
    const next = !pinned
    setOptimistic(next)
    setPending(true)
    clear()

    // A sign-out or sign-in while the write is in flight resets the shared store; the late
    // answer then belongs to the previous identity and must not repopulate it.
    const generation = pinState.generation()
    const write = next ? putPin(postId) : deletePin(postId)
    write
      .then(
        state => {
          setOptimistic(undefined)
          if (pinState.generation() !== generation) return
          pinState.set(postId, state.active)
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
