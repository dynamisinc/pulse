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
 * (`requestReplyFocus`); `ThreadView`, once the thread has loaded, asks whether
 * its own focused post was the one requested (`consumeReplyFocus`) and focuses
 * the composer if so. Navigation-agnostic, so it works unchanged under F1's
 * routes. The request is ONE-SHOT and keyed by post id: consuming clears it, a
 * request for a different post is not consumed by another thread, and a newer
 * request replaces an older one — so a stale tap can never steal focus later.
 */

/** The post whose thread the next `ThreadView` should open with the composer focused. */
let requestedPostId: string | undefined

/** Records that the thread for `postId` is being opened to reply (call just before navigating). */
export function requestReplyFocus(postId: string): void {
  requestedPostId = postId
}

/**
 * True exactly once after `requestReplyFocus(postId)`: the thread for `postId`
 * has been opened to reply, so its composer should take focus. Always clears a
 * matching request, whether or not a composer exists to focus (a read-only
 * session has none), so the intent never lingers.
 */
export function consumeReplyFocus(postId: string): boolean {
  if (requestedPostId !== postId) return false
  requestedPostId = undefined
  return true
}

/** Test-only: forgets any pending request. */
export function resetReplyIntentForTests(): void {
  requestedPostId = undefined
}
