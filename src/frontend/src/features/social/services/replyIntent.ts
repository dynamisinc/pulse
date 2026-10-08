/**
 * features/social/services/replyIntent.ts
 * ---------------------------------------------------------------------------
 * "Open this thread with the reply composer focused" (demo-polish F4, story 13
 * "Reply composer": "the reply button on any card opens the thread with the
 * composer focused"). Participant world — a tiny module-level handoff, no UI.
 *
 * THE PROBLEM. A card's reply button calls `onReply(postId)`; the host opens the
 * thread through whatever navigation it owns — local view state today
 * (`SocialChannel`), a router in F1's frame. `ThreadView` cannot read the router
 * (the participant shell is location-blind by design) and the navigation callback
 * is `(id) => void`, with nowhere to say "and focus the composer".
 *
 * THE HANDOFF. The tapped card records the intent just before it navigates
 * (`requestReplyFocus`); `ThreadView`, once the thread has loaded AND its composer
 * is mounted, asks whether its own focused post was the one requested
 * (`consumeReplyFocus`) and focuses the composer if so. Navigation-agnostic, so it
 * works unchanged under F1's routes. The request is ONE-SHOT and keyed by post id:
 * consuming clears it, a request for a different post is not consumed by another
 * thread, and a newer request replaces an older one.
 *
 * IT CANNOT GO STALE. A request that is never consumed (the thread failed to load,
 * the navigation never happened, the session ended) must not steal focus on some
 * later, unrelated visit to the same thread, so it is cleared three ways: `ThreadView`
 * consumes it when its thread errors, `core/auth/endSession` calls
 * {@link resetReplyIntent}, and it EXPIRES after {@link REPLY_INTENT_TTL_MS}. (It is
 * deliberately not cleared on unmount: React StrictMode's dev-only mount/unmount/
 * mount would spend it before the thread had loaded.) The expiry uses the monotonic
 * `performance.now()`, never the wall clock: it only bounds an interaction handoff
 * and is never displayed (COR-053 is about participant-visible instants).
 *
 * This module imports nothing: `core/auth` imports it to reset on sign-out.
 */

/** How long a recorded reply intent stays valid: a tap-to-thread round trip, with slack. */
export const REPLY_INTENT_TTL_MS = 15_000

interface ReplyIntent {
  readonly postId: string
  /** `performance.now()` when it was recorded, or undefined where unavailable. */
  readonly at: number | undefined
}

/** The post whose thread the next `ThreadView` should open with the composer focused. */
let requested: ReplyIntent | undefined

function monotonicNow(): number | undefined {
  return typeof performance !== 'undefined' ? performance.now() : undefined
}

/** Records that the thread for `postId` is being opened to reply (call just before navigating). */
export function requestReplyFocus(postId: string): void {
  requested = { postId, at: monotonicNow() }
}

/**
 * True exactly once after `requestReplyFocus(postId)` (and within the TTL): the
 * thread for `postId` has been opened to reply, so its composer should take focus.
 * Always clears a matching request, valid or expired, whether or not a composer
 * exists to focus (a read-only session has none), so the intent never lingers.
 */
export function consumeReplyFocus(postId: string): boolean {
  if (requested === undefined || requested.postId !== postId) return false
  const { at } = requested
  requested = undefined
  const now = monotonicNow()
  return at === undefined || now === undefined || now - at <= REPLY_INTENT_TTL_MS
}

/** Forgets any pending request (sign-out, tests). */
export function resetReplyIntent(): void {
  requested = undefined
}
