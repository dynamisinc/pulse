/**
 * features/controller/liveWorld/pinChangeSource.ts
 * ---------------------------------------------------------------------------
 * The seam through which the Live world column hears that a post was pinned or
 * unpinned FOR EVERYONE in ANOTHER console (story 08, DF-7; the server's SignalR
 * `PostPinChanged { postId, pinnedForAll }` on the exercise group). STAFF world, no UI.
 *
 * ## Why a seam
 * The subscription itself belongs to the shared realtime transport: story 07 adds
 * `realtimeFeed.subscribePinChanged(handler): () => void` (the frozen name and signature,
 * implementation.md "Wave plan", 08 depends on it by name). Story 08 is built in parallel,
 * so the default source looks that function up AT CALL TIME and is a no-op (an
 * unsubscribe that does nothing) while it does not exist. Once 07 merges, the very same
 * code subscribes for real, with nothing to change here. Tests pass a double through the
 * column's `pinChangeSource` prop.
 *
 * One shared connection (frontend-agent rule G): this module opens nothing of its own;
 * it only registers a handler on the app-wide `realtimeFeed`, whose connection the
 * column's arrival source already holds open.
 *
 * Events are validated before they reach the column (a malformed payload is dropped):
 * the transport is the place that parses, but the column must never apply a pin to
 * `undefined`.
 */

import { realtimeFeed } from '@/features/social/services/realtimeFeed'

/** One pin change, exactly as `PostPinChanged` carries it (frozen contract). */
export interface PinChangedEvent {
  readonly postId: string
  readonly pinnedForAll: boolean
}

/** A subscriber to pin changes. */
export type PinChangedHandler = (event: PinChangedEvent) => void

/** Where pin changes come from. The signature is story 07's `subscribePinChanged`, verbatim. */
export interface PinChangeSource {
  /** Registers `handler`; returns an unsubscribe. */
  subscribePinChanged(handler: PinChangedHandler): () => void
}

/** True when `value` is a well-formed {@link PinChangedEvent}. */
export function isPinChangedEvent(value: unknown): value is PinChangedEvent {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.postId === 'string'
    && record.postId.length > 0
    && typeof record.pinnedForAll === 'boolean'
}

/**
 * Story 07's `realtimeFeed.subscribePinChanged`, when it exists; `undefined` before it
 * merges. A structural lookup, so this compiles both before and after the function
 * joins the `RealtimeFeed` interface.
 */
function sharedSubscribePinChanged(): PinChangeSource['subscribePinChanged'] | undefined {
  const feed = realtimeFeed as unknown as Record<string, unknown>
  const candidate: unknown = feed.subscribePinChanged
  if (typeof candidate !== 'function') return undefined
  return handler => (candidate as PinChangeSource['subscribePinChanged']).call(realtimeFeed, handler)
}

/** The app-wide source: `realtimeFeed.subscribePinChanged` once story 07 provides it. */
export const defaultPinChangeSource: PinChangeSource = {
  subscribePinChanged(handler) {
    const subscribe = sharedSubscribePinChanged()
    if (subscribe === undefined) return () => {}
    return subscribe(event => {
      if (isPinChangedEvent(event)) handler(event)
    })
  },
}
