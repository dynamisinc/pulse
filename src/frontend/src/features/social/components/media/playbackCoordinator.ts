/**
 * features/social/components/media/playbackCoordinator.ts
 * ---------------------------------------------------------------------------
 * "One video playing at a time" (demo-polish F2 AC): a feed full of inline
 * players must not talk over itself. Each `VideoPlayer` calls `claimPlayback`
 * from its `play` event; the coordinator pauses whichever element held the claim
 * before and records the new holder. `releasePlayback` (pause / ended / unmount)
 * clears the claim only if the caller still holds it.
 *
 * Module-level on purpose: the players are siblings in different cards with no
 * shared React ancestor, and the rule is page-wide. It holds an element
 * reference only, never a URL or any post data.
 */

let active: HTMLMediaElement | null = null

/** Marks `element` as the one playing video, pausing any other that was. */
export function claimPlayback(element: HTMLMediaElement): void {
  const previous = active
  active = element
  if (previous !== null && previous !== element) previous.pause()
}

/**
 * Pauses whichever video is playing right now (no-op when none). Used when something
 * above the channel takes over the screen — the shell's Pause / EndEx / break-fiction
 * overlay — so media never keeps playing (and sounding) behind it. The element's own
 * `pause` event releases the claim.
 */
export function pauseActivePlayback(): void {
  active?.pause()
}

/** Clears the claim if `element` still holds it. */
export function releasePlayback(element: HTMLMediaElement): void {
  if (active === element) active = null
}

/** TEST SEAM: forget the current holder without pausing it. */
export function resetPlaybackForTests(): void {
  active = null
}
