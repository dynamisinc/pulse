/**
 * features/social/explore/exploreNavigation.ts
 * ---------------------------------------------------------------------------
 * How Explore's rows open things (demo-polish F6): a trend opens its hashtag feed;
 * a search result opens a post's thread or an account's profile. Participant world
 * — plain TS, no UI.
 *
 * Every openable row is a real `<a href>` built with F1's `socialPaths`, so it is
 * never a focusable no-op, "open in new tab" works, and the URL is right even
 * without script. A plain left-click is intercepted ({@link activateLink}) and
 * handed to an in-app opener — F1's `useSocialOpeners()` by default, so navigation
 * goes through the channel's adapter (no reload, and the preview's memory history is
 * respected). The three optional props override that per call site, mainly for tests.
 *
 * Requires the channel's providers (the navigation adapter and the persona
 * directory) because `useSocialOpeners()` does; `SocialChannel` mounts both.
 */

import { useMemo, type MouseEvent } from 'react'
import { useSocialOpeners } from '../layout/useSocialOpeners'

/** Optional overrides for the three ways Explore opens something. */
export interface ExploreOpenerProps {
  /** Open the hashtag feed for a NORMALIZED tag (lowercase, no leading `#`). */
  readonly onOpenHashtag?: (tag: string) => void
  /** Open a post's thread; `authorHandle` only decorates the URL. */
  readonly onOpenPost?: (postId: string, authorHandle?: string) => void
  /** Open an account's profile by persona id. */
  readonly onOpenProfile?: (personaId: string) => void
}

/** The openers a component calls: the props it was given, else the channel's. */
export interface ExploreOpeners {
  readonly onOpenHashtag: (tag: string) => void
  readonly onOpenPost: (postId: string, authorHandle?: string) => void
  readonly onOpenProfile: (personaId: string) => void
}

export function useExploreOpeners(props: ExploreOpenerProps): ExploreOpeners {
  const social = useSocialOpeners()
  const { onOpenHashtag, onOpenPost, onOpenProfile } = props
  return useMemo(
    () => ({
      onOpenHashtag: onOpenHashtag ?? social.openHashtag,
      onOpenPost: onOpenPost ?? social.openThread,
      onOpenProfile: onOpenProfile ?? social.openProfile,
    }),
    [onOpenHashtag, onOpenPost, onOpenProfile, social],
  )
}

/**
 * Click handler for an `<a href>` row: a plain primary-button click is
 * intercepted and handed to `open`; a modified click (new tab/window) is left to
 * the browser.
 */
export function activateLink(event: MouseEvent<HTMLAnchorElement>, open: () => void): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return
  }
  event.preventDefault()
  open()
}
