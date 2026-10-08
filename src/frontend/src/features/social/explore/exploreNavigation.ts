/**
 * features/social/explore/exploreNavigation.ts
 * ---------------------------------------------------------------------------
 * The ONE navigation seam for Explore's components (demo-polish F6): how a trend
 * opens `/hashtag/:tag`, and how a search result opens a post's thread or an
 * account's profile. Participant world — plain TS, no UI.
 *
 * WHY A SEAM. F6 is built in parallel with F1, which owns the router and the
 * in-channel navigation adapter (`useSocialNavigation` / `socialPaths`, in
 * `layout/`). Neither is in F6's base, so Explore cannot import them yet. Instead
 * `TrendingPanel`, `SearchBox` and `ExplorePage` take three OPTIONAL callbacks
 * ({@link ExploreOpenerProps}) and resolve them through {@link useExploreOpeners}
 * — the single place the integration swap happens.
 *
 * THE DEFAULT (no callback supplied). Every openable row is a real `<a href>` to
 * the route F1 serves (`/hashtag/:tag`, `/:handle`, `/:handle/status/:id` — see
 * `docs/features/demo-polish/10-app-frame-navigation.md`). With no callback the
 * browser simply follows the link, so nothing is ever a focusable no-op (WR-002),
 * middle-click / "open in new tab" work, and the URL is already correct when the
 * router lands. With a callback, a plain left-click is intercepted and handed to
 * it (an in-app `navigate()` — no reload); modified clicks still get the browser's
 * behaviour ({@link activateLink}).
 *
 * TODO(F1-merge): once F1's `layout/socialNavigation.ts` is in the tree, the
 * orchestrator makes `useExploreOpeners` fall back to F1's openers instead of
 * `undefined`, i.e.
 *
 *   const social = useSocialOpeners()          // F1
 *   return {
 *     onOpenHashtag: props.onOpenHashtag ?? social.onHashtagOpen,
 *     onOpenPost: props.onOpenPost ?? social.onOpenThread,
 *     onOpenProfile: props.onOpenProfile ?? social.onOpenProfile,
 *   }
 *
 * and may then delete the `*Href` helpers below in favour of `socialPaths`. That
 * is the only edit Explore needs for in-app (no-reload) navigation; no other file
 * in `explore/` knows how navigation works.
 */

import type { MouseEvent } from 'react'

/** The three ways Explore can open something. All optional (see the header). */
export interface ExploreOpenerProps {
  /** Open the hashtag feed for a NORMALIZED tag (lowercase, no leading `#`). */
  readonly onOpenHashtag?: (tag: string) => void
  /** Open a post's flattened thread. */
  readonly onOpenPost?: (postId: string) => void
  /** Open an account's profile by persona id. */
  readonly onOpenProfile?: (personaId: string) => void
}

/**
 * Resolves the openers a component should use: the props it was given, falling
 * back to the app's navigation. Today the fallback is "none" (rows are plain
 * links); the F1 merge replaces it — see the module header's TODO(F1-merge).
 */
export function useExploreOpeners(props: ExploreOpenerProps): ExploreOpenerProps {
  // TODO(F1-merge): fall back to `useSocialOpeners()` here (see the module header).
  return props
}

// -----------------------------------------------------------------------------
// Default hrefs (the routes F1 serves). Ids and tags are opaque — encode them.
// -----------------------------------------------------------------------------

/** `/hashtag/:tag` for a normalized tag. */
export function hashtagHref(tag: string): string {
  return `/hashtag/${encodeURIComponent(tag)}`
}

/** `/:handle` for an account (handle has no leading `@`). */
export function profileHref(handle: string): string {
  return `/${encodeURIComponent(handle)}`
}

/** `/:handle/status/:id` for a post, by its author's handle. */
export function postHref(authorHandle: string, postId: string): string {
  return `/${encodeURIComponent(authorHandle)}/status/${encodeURIComponent(postId)}`
}

/**
 * Click handler for an `<a href>` row. With an `open` callback, a plain
 * primary-button click is intercepted and handed to it; with none, or with a
 * modifier key held (new tab/window), the browser follows the link as normal.
 */
export function activateLink(
  event: MouseEvent<HTMLAnchorElement>,
  open: (() => void) | undefined,
): void {
  if (open === undefined) return
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
