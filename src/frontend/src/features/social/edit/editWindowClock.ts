/**
 * features/social/edit/editWindowClock.ts
 * ---------------------------------------------------------------------------
 * The monotonic read time behind the edit countdown (story 20, Gate-1 M-1). Cached feed data and
 * `ownPostStore` keep the ORIGINAL `viewer.editableForSeconds`, so a card that remounts (feed ->
 * thread -> back) must not count it down afresh. Each look implies a deadline
 * (`performance.now() + seconds`); the EARLIEST one per post is kept and never extended (Copilot
 * #558: 30, then 10, then 30 again must not re-grant the window). Monotonic time only measures
 * a duration and is never rendered (COR-053). Tab-lived state: reset on sign-out via the
 * session-reset registry.
 */

import { registerSessionReset } from '@/core/auth/sessionReset'

/** Per post: the EARLIEST deadline (`performance.now()` ms) any read has implied. */
const deadlines = new Map<string, number>()

/**
 * Milliseconds left in `postId`'s window given the server's `seconds` (0 when closed). The
 * deadline is `min(held deadline, now + seconds)` and is NEVER extended: a different value is not
 * necessarily fresher (thread -> cached feed can read 30, then 10, then 30 again), so a larger
 * value can shorten nothing and grant nothing; only a smaller one pulls the deadline in.
 */
export function remainingWindowMs(postId: string, seconds: number | undefined): number {
  if (seconds === undefined || seconds <= 0) return 0
  const now = performance.now()
  const implied = now + seconds * 1000
  const held = deadlines.get(postId)
  const deadline = held === undefined ? implied : Math.min(held, implied)
  if (deadline !== held) deadlines.set(postId, deadline)
  return Math.max(0, deadline - now)
}

/** Forgets every recorded read (sign-out / identity switch). */
export function resetEditWindowReads(): void {
  deadlines.clear()
}

registerSessionReset(resetEditWindowReads, import.meta.hot)
