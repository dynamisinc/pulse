/**
 * features/social/layout/SocialRoutes.tsx
 * ---------------------------------------------------------------------------
 * The Social channel's route table (demo-polish F1, "Real URLs and Back").
 *
 *   /                      -> redirect to /home
 *   /home                  -> the feed (`HomeView`)                    [kept mounted]
 *   /explore               -> `ExplorePage` (F0's stub; F6 fills it)
 *   /hashtag/:tag          -> the hashtag feed
 *   /:handle/status/:id    -> the flattened thread
 *   /:handle               -> a profile
 *   anything else          -> redirect to /home
 *
 * "Anything else" includes a participant typing `/staff/console`: the participant
 * never reaches, or even reads, a staff route (COR-004). The channel router lives
 * HERE, inside `SocialChannel` under the app's `*` catch-all -- not in
 * `RoleAwareEntry` -- which is why `participantLocationBlindness.test.ts` (which
 * guards that file) stays green.
 *
 * MATCHING GOES THROUGH THE ADAPTER. The routes are matched with React Router's
 * `<Routes location={...}>` against the navigation adapter's location
 * (`useSocialNavigation().location`), so the channel never reads the real
 * `window.location` -- under `MemorySocialNavigationProvider` it matches an
 * in-memory location instead and the staff app's address bar is untouched.
 * Redirects go through the adapter too (`SocialRedirect`), never `<Navigate>`.
 *
 * WHY THE ROUTE CONTEXT IS RESET. `<Routes location>` insists the overriding
 * pathname begin with the portion of the real URL already matched by the parent
 * routes (it throws "the location pathname must begin with ..." otherwise). In the
 * participant app the parent is the root `*`, so that is trivially true; but C6's
 * preview mounts the channel under a staff route such as `/staff/console`, where a
 * memory location of `/home` would throw. Providing a root `RouteContext` around
 * the `<Routes>` makes it a top-level matcher -- the memory location is then the
 * only pathname that matters. (`UNSAFE_RouteContext` is React Router's documented
 * escape hatch for this; `socialRoutes.test.tsx` mounts the channel under a nested
 * parent route to pin the behavior.)
 *
 * HOME STAYS MOUNTED. Returning to `/home` with Back must keep the feed's frozen
 * baseline, an unsent compose draft, and the scroll position, with no refetch and
 * no duplicate feed-view telemetry. A router unmounts the previous route, so Home
 * is NOT rendered by `<Routes>`: it is rendered here, outside it, and merely
 * `hidden` while another route shows (its `/home` route element is `null`). It
 * mounts LAZILY, on the first visit to Home, so a cold deep link to a thread never
 * fetches the feed or emits a feed `view` the participant never saw -- and it
 * stays mounted afterwards. (Scroll position is restored separately, by
 * `useScrollRestoration`.) Detail routes (thread / profile / hashtag) unmount on
 * leaving; they are cheap to re-open and carry no state worth keeping.
 *
 * World: participant. No COBRA, no MUI.
 */

import { useState, type ContextType } from 'react'
import { Route, Routes, UNSAFE_RouteContext } from 'react-router-dom'
import { ExplorePage } from '../explore/ExplorePage'
import {
  HOME_PATH,
  SOCIAL_ROUTE_PATTERNS,
  matchSocialRoute,
  useSocialNavigation,
} from './socialNavigation'
import { HashtagRoute } from './routes/HashtagRoute'
import { HomeView } from './routes/HomeView'
import { ProfileRoute } from './routes/ProfileRoute'
import { SocialRedirect } from './routes/SocialRedirect'
import { ThreadRoute } from './routes/ThreadRoute'

/** An empty parent-route context: makes the `<Routes>` below a top-level matcher. */
const ROOT_ROUTE_CONTEXT: ContextType<typeof UNSAFE_RouteContext> = {
  outlet: null,
  matches: [],
  isDataRoute: false,
}

export function SocialRoutes() {
  const { location } = useSocialNavigation()
  const onHome = matchSocialRoute(location.pathname) === 'home'

  // Mount Home on first visit and keep it (derived state, set during render --
  // React's documented pattern for "remember that this has happened").
  const [homeMounted, setHomeMounted] = useState(onHome)
  if (onHome && !homeMounted) setHomeMounted(true)

  return (
    <>
      {homeMounted && (
        <div hidden={!onHome} data-testid="social-feed-region">
          <HomeView />
        </div>
      )}

      <UNSAFE_RouteContext.Provider value={ROOT_ROUTE_CONTEXT}>
        <Routes location={location}>
          <Route path="/" element={<SocialRedirect to={HOME_PATH} />} />
          {/* Home renders above, outside <Routes>, so it can stay mounted. */}
          <Route path={SOCIAL_ROUTE_PATTERNS.home} element={null} />
          <Route path={SOCIAL_ROUTE_PATTERNS.explore} element={<ExplorePage />} />
          <Route path={SOCIAL_ROUTE_PATTERNS.hashtag} element={<HashtagRoute />} />
          <Route path={SOCIAL_ROUTE_PATTERNS.thread} element={<ThreadRoute />} />
          <Route path={SOCIAL_ROUTE_PATTERNS.profile} element={<ProfileRoute />} />
          <Route path="*" element={<SocialRedirect to={HOME_PATH} />} />
        </Routes>
      </UNSAFE_RouteContext.Provider>
    </>
  )
}
