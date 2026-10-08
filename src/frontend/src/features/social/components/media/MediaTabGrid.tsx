/**
 * features/social/components/media/MediaTabGrid.tsx
 * ---------------------------------------------------------------------------
 * The profile "Media" tab grid (demo-polish F0 STUB). Created here so the file
 * exists with its prop contract before the two stories that depend on it start:
 * F2 (media display) owns this file and fills in the grid of media thumbnails;
 * F5 (brand & profile finish) imports it into `pages/Profile.tsx`'s Media tab.
 * F0 does NOT mount it (`Profile.tsx` is F5's file, not F0's).
 *
 * PROPS (the seam F2 and F5 agree on): the media-bearing posts of one account, in
 * the order to show them, plus an optional open handler that receives the POST id
 * (thread navigation is the caller's job — this component never routes).
 *
 * F0 STATE: renders nothing. F2 replaces it. When F2 fills it in, it must be
 * keyboard-operable, give every thumbnail the media item's `alt` as its accessible
 * name (NFR-001), and render nothing at all when `posts` has no media.
 *
 * Participant world — no COBRA, no MUI. Treat media `url`s as opaque (XC-009).
 */

import type { PostView } from '../post'

export interface MediaTabGridProps {
  /** The account's posts that carry media, in display order. */
  readonly posts: readonly PostView[]
  /** Fires with the POST id when a thumbnail is activated. */
  readonly onOpenPost?: (postId: string) => void
}

export function MediaTabGrid(_props: MediaTabGridProps) {
  return null
}
