/**
 * features/social/edit/editWindowClock.ts
 * ---------------------------------------------------------------------------
 * The monotonic read time behind the edit countdown (story 20, Gate-1 M-1). Cached feed data and
 * `ownPostStore` keep the ORIGINAL `viewer.editableForSeconds`, so a card that remounts (feed ->
 * thread -> back) must not count it down afresh. The first time a post's seconds value is seen,
 * `performance.now()` is recorded against the post id; every later look at the SAME value counts
 * down from that first sight. A DIFFERENT value (a fresher read, or the answer to a save) is a new
 * server statement and restarts the record. Monotonic time only measures a duration and is never
 * rendered (COR-053). Tab-lived state: reset on sign-out via the session-reset registry.
 */

import { registerSessionReset } from '@/core/auth/sessionReset'

interface WindowRead {
  readonly seconds: number
  readonly readAt: number
}

const reads = new Map<string, WindowRead>()

/** Milliseconds left in `postId`'s window given the server's `seconds` (0 when closed). */
export function remainingWindowMs(postId: string, seconds: number | undefined): number {
  if (seconds === undefined || seconds <= 0) return 0
  const now = performance.now()
  const held = reads.get(postId)
  const read = held !== undefined && held.seconds === seconds ? held : { seconds, readAt: now }
  if (read !== held) reads.set(postId, read)
  return Math.max(0, seconds * 1000 - (now - read.readAt))
}

/** Forgets every recorded read (sign-out / identity switch). */
export function resetEditWindowReads(): void {
  reads.clear()
}

registerSessionReset(resetEditWindowReads, import.meta.hot)
