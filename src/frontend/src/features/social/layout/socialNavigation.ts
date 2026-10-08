/**
 * features/social/layout/socialNavigation.ts
 * ---------------------------------------------------------------------------
 * The Social channel's NAVIGATION ADAPTER (demo-polish F1, "Navigation adapter
 * (for C6)" AC). Everything inside the channel that moves between pages, or asks
 * "which page am I on?", goes through this module -- never straight to React
 * Router's `useNavigate` / `useLocation`, and never to `window.location` /
 * `window.history`.
 *
 * WHY AN ADAPTER AT ALL. Two hosts mount the same channel:
 *
 *   1. The participant app (`App.tsx`'s `*` catch-all). It wants REAL URLs: deep
 *      links, a working browser Back/Forward, reload-on-any-route.
 *      `SocialNavigationProvider` is the default and wraps React Router.
 *   2. The controller's "preview as participant" stage (C6, Wave 3), which sits
 *      INSIDE a staff route. The preview must be able to click around the channel
 *      WITHOUT moving the staff app's address bar or pushing entries onto the
 *      staff user's browser history. `MemorySocialNavigationProvider` keeps the
 *      location in React state and never touches browser history.
 *
 * Because the channel reads its location from the adapter (see `SocialRoutes`,
 * which hands it to `<Routes location>`), the two hosts differ by exactly one
 * provider and nothing in the channel knows which one it is under.
 *
 * WHAT THE ADAPTER EXPOSES
 *  - `location`     the in-channel location `{ pathname, search, hash, key }`.
 *  - `navigate(to, { replace? })`   push (default) or replace an in-channel path.
 *  - `back(fallback?)`   go to the previous in-channel entry; if there is none
 *                        (a deep link opened in a fresh tab), REPLACE with
 *                        `fallback` (default `/home`) so "Back" never leaves the
 *                        app and never dead-ends.
 *  - `canGoBack`    whether `back()` has a real previous entry.
 *  - `getLocationKey()`  the current entry's key, read lazily (no re-render), so
 *                        queued work can detect that the user has since moved on.
 *  - `kind`         `'browser'` | `'memory'`. Only the browser kind may touch the
 *                   window (scroll restoration is browser-only, for instance).
 *
 * TWO CONTEXTS, ONE HOOK PAIR. The location changes on every navigation; the
 * actions (`navigate`/`back`/`kind`) never do. They are published through two
 * contexts so a component that only NAVIGATES (the feed's open-thread callbacks,
 * threaded into memoized rows) can use `useSocialNavigate()` and is not
 * re-rendered by every location change -- which would defeat the memoized feed
 * rows under burst (NFR-002/SOC-071). `useSocialNavigation()` is the full view.
 *
 * ROUTE VOCABULARY lives here too (`socialPaths`, `matchSocialRoute`,
 * `SOCIAL_RESERVED_SEGMENTS`), so path construction and classification have one
 * home. `SocialRoutes` builds its `<Route path>`s from `SOCIAL_ROUTE_PATTERNS`,
 * and `SocialRoutes.test.tsx` proves `matchSocialRoute` and the rendered
 * `<Routes>` agree on a battery of paths -- they cannot drift silently.
 *
 * Plain `.ts` (the provider is built with `createElement`), mirroring
 * `participant-shell/mountContract.ts`.
 *
 * World: participant. No COBRA, no MUI.
 */

import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react'
import { matchPath } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Route vocabulary
// ---------------------------------------------------------------------------

/** The landing route. `/` and every unknown path redirect here. */
export const HOME_PATH = '/home'

/** The Explore route (F0's stub today; F6 fills the page). */
export const EXPLORE_PATH = '/explore'

/**
 * The handle segment used for a thread link built from a post id ALONE.
 *
 * `/:handle/status/:id` is the thread route, but the callbacks threaded into the
 * feed (`onOpenThread(postId)`) carry no author. The handle segment is cosmetic --
 * the thread is resolved by `:id` only -- so an unknown author uses this
 * placeholder (the same shape X's own `/i/status/:id` takes). It is reserved so it
 * can never be mistaken for a persona handle.
 */
export const THREAD_HANDLE_PLACEHOLDER = 'i'

/**
 * First path segments that are NEVER a persona handle: routes the channel owns
 * (`home`, `explore`, `hashtag`), and the app-level `login` / `staff` prefixes
 * (a participant typing `/staff` must land on Home, not on an "account doesn't
 * exist" profile -- COR-004). Compared case-insensitively.
 */
export const SOCIAL_RESERVED_SEGMENTS: readonly string[] = [
  'home',
  'explore',
  'hashtag',
  'login',
  'staff',
  THREAD_HANDLE_PLACEHOLDER,
]

/** Whether `segment` may not be resolved as a persona handle (profile routes). */
export function isReservedSegment(segment: string): boolean {
  return SOCIAL_RESERVED_SEGMENTS.includes(segment.toLowerCase())
}

/**
 * Whether `segment` is acceptable as the handle of a THREAD URL: any
 * non-reserved handle, plus the placeholder (`/i/status/:id`). `/staff/status/1`
 * and friends are not threads -- they are redirected Home like any other
 * reserved prefix.
 */
export function isThreadHandle(segment: string): boolean {
  return segment.toLowerCase() === THREAD_HANDLE_PLACEHOLDER || !isReservedSegment(segment)
}

/**
 * The route patterns, exactly as `SocialRoutes` registers them. Specific patterns
 * win over `/:handle` through React Router's own ranking (static segments outrank
 * dynamic ones); `matchSocialRoute` below checks them in the same order.
 */
export const SOCIAL_ROUTE_PATTERNS = {
  home: HOME_PATH,
  explore: EXPLORE_PATH,
  hashtag: '/hashtag/:tag',
  thread: '/:handle/status/:id',
  profile: '/:handle',
} as const

/** Builders for in-channel URLs -- the only place a path is concatenated. */
export const socialPaths = {
  home: (): string => HOME_PATH,
  explore: (): string => EXPLORE_PATH,
  /** `tag` is the normalized tag (no leading `#`). */
  hashtag: (tag: string): string => `/hashtag/${encodeURIComponent(tag)}`,
  profile: (handle: string): string => `/${encodeURIComponent(handle)}`,
  /**
   * `handle` is optional: omit it (post id only) and the placeholder segment is
   * used -- see {@link THREAD_HANDLE_PLACEHOLDER}.
   */
  thread: (postId: string, handle: string = THREAD_HANDLE_PLACEHOLDER): string =>
    `/${encodeURIComponent(handle)}/status/${encodeURIComponent(postId)}`,
}

/**
 * What a pathname resolves to. `'redirect'` covers `/`, every unknown path, and
 * every reserved first segment that is not itself a route (`/staff`,
 * `/staff/console`, `/login`, ...): all of them are sent to Home.
 */
export type SocialRouteKind = 'home' | 'explore' | 'hashtag' | 'thread' | 'profile' | 'redirect'

/** The shape of a hashtag the channel will route: letters, digits and `_`, 1-100 of them. */
const HASHTAG_PARAM_PATTERN = /^[\p{L}\p{N}_]{1,100}$/u

/**
 * Normalizes the `:tag` URL parameter exactly the way `HashtagFeed` keys its feed --
 * strip leading `#`s, lowercase -- and validates it. Returns the normalized tag, or
 * `undefined` for anything that cannot be a hashtag (empty, whitespace, punctuation,
 * over 100 characters): the route then redirects Home instead of rendering a feed
 * for a string no post can carry, and an arbitrary URL segment never reaches
 * `HashtagFeed`, the telemetry target, or the heading as free text (NFR-004).
 *
 * `HashtagRoute` and `matchSocialRoute` both call this, so the router and the
 * classifier cannot disagree about whether `/hashtag/x` is a feed.
 */
export function normalizeHashtagParam(raw: string): string | undefined {
  const tag = raw.replace(/^#+/, '').toLowerCase()
  return HASHTAG_PARAM_PATTERN.test(tag) ? tag : undefined
}

/**
 * Decodes a URL parameter the way `<Routes>` does before a route element sees it
 * (`useParams` is decoded; the bare `matchPath` used by the classifier below is not),
 * falling back to the raw value on malformed encoding. Without this the classifier
 * would call `/%73taff` a profile while the router, which decodes it to `staff`,
 * redirects it Home.
 */
function decodeParam(value: string | undefined): string {
  if (value === undefined) return ''
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Pure classifier mirroring the `<Routes>` table (see the module header). */
export function matchSocialRoute(pathname: string): SocialRouteKind {
  if (matchPath(SOCIAL_ROUTE_PATTERNS.home, pathname)) return 'home'
  if (matchPath(SOCIAL_ROUTE_PATTERNS.explore, pathname)) return 'explore'
  const hashtag = matchPath(SOCIAL_ROUTE_PATTERNS.hashtag, pathname)
  if (hashtag) {
    return normalizeHashtagParam(decodeParam(hashtag.params.tag)) === undefined
      ? 'redirect'
      : 'hashtag'
  }
  const thread = matchPath(SOCIAL_ROUTE_PATTERNS.thread, pathname)
  if (thread) {
    return isThreadHandle(decodeParam(thread.params.handle)) ? 'thread' : 'redirect'
  }
  const profile = matchPath(SOCIAL_ROUTE_PATTERNS.profile, pathname)
  if (profile) {
    return isReservedSegment(decodeParam(profile.params.handle)) ? 'redirect' : 'profile'
  }
  return 'redirect'
}

// ---------------------------------------------------------------------------
// The adapter contract
// ---------------------------------------------------------------------------

/** An in-channel location. Structurally assignable to React Router's `Location`. */
export interface SocialLocation {
  readonly pathname: string
  readonly search: string
  readonly hash: string
  /** Unique per history entry (React Router's key, or the memory provider's). */
  readonly key: string
}

export interface SocialNavigateOptions {
  /** Replace the current entry instead of pushing a new one. */
  readonly replace?: boolean
}

/** The stable half of the adapter: never changes identity across navigations. */
export interface SocialNavigationActions {
  /** `'browser'` = real URLs / browser history; `'memory'` = never touches either. */
  readonly kind: 'browser' | 'memory'
  /** Push (default) or replace an absolute in-channel path, e.g. `/hashtag/zone2`. */
  readonly navigate: (to: string, options?: SocialNavigateOptions) => void
  /**
   * Go to the previous in-channel entry. With none (a deep link opened cold),
   * REPLACE with `fallback` (default {@link HOME_PATH}) instead -- Back never
   * leaves the app and never dead-ends.
   */
  readonly back: (fallback?: string) => void
  /**
   * The key of the CURRENT history entry, read at call time (a function, so it never
   * re-renders a caller). Lets deferred work -- e.g. a profile tap waiting on the
   * persona directory -- tell whether the user has navigated since it was queued.
   */
  readonly getLocationKey: () => string
}

/** The changing half: re-published on every navigation. */
export interface SocialLocationState {
  readonly location: SocialLocation
  /** Whether `back()` has a previous in-channel entry to return to. */
  readonly canGoBack: boolean
}

/** What `useSocialNavigation()` returns: both halves together. */
export interface SocialNavigation extends SocialNavigationActions, SocialLocationState {}

const ActionsContext = createContext<SocialNavigationActions | undefined>(undefined)
const LocationContext = createContext<SocialLocationState | undefined>(undefined)

export interface SocialNavigationContextProviderProps {
  actions: SocialNavigationActions
  state: SocialLocationState
  children: ReactNode
}

/**
 * Publishes an adapter value to the subtree. Used by the two providers in
 * `SocialNavigationProvider.tsx`; nothing else should construct one.
 */
export function SocialNavigationContextProvider({
  actions,
  state,
  children,
}: SocialNavigationContextProviderProps) {
  return createElement(
    ActionsContext.Provider,
    { value: actions },
    createElement(LocationContext.Provider, { value: state }, children),
  )
}

/** Whether a navigation provider is mounted above this component. */
export function useHasSocialNavigation(): boolean {
  return useContext(ActionsContext) !== undefined
}

/**
 * The stable actions only (`navigate` / `back` / `kind`). Does NOT re-render on
 * a location change -- use this for callbacks threaded into memoized rows.
 * Fail-closed outside a provider, like `useShellContext()`.
 */
export function useSocialNavigate(): SocialNavigationActions {
  const actions = useContext(ActionsContext)
  if (actions === undefined) {
    throw new Error(
      'useSocialNavigate() must be called within a navigation provider ' +
      '(<SocialNavigationProvider> or <MemorySocialNavigationProvider>); ' +
      '<SocialChannel> mounts the default one itself.',
    )
  }
  return actions
}

/**
 * The full adapter: location + actions. Re-renders on every navigation.
 * Fail-closed outside a provider.
 */
export function useSocialNavigation(): SocialNavigation {
  const actions = useSocialNavigate()
  const state = useContext(LocationContext)
  if (state === undefined) {
    throw new Error('useSocialNavigation() found actions but no location state.')
  }
  return useMemo(() => ({ ...actions, ...state }), [actions, state])
}
