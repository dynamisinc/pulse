/**
 * core/auth/endSession.ts
 * ---------------------------------------------------------------------------
 * The one shared "tear down the client session" path both worlds' sign-out
 * controls call (feature: login). It composes the two things a logout must do
 * on the client, in one place so the staff and participant controls behave
 * identically:
 *
 *   1. CLEAR THE REACT QUERY CACHE (`queryClient.clear()`). The app uses one
 *      shared query client (`core/services/queryClient`) and most server-state
 *      queries are keyed WITHOUT a per-user/per-session component
 *      (`['staff','assignments']`, the feed, personas, brand/chrome config, …).
 *      Clearing auth tokens alone would leave the prior user's cached data
 *      resident, so a DIFFERENT user logging in on the same browser tab could
 *      briefly see it under the same keys until each query refetched — a
 *      cross-user / cross-exercise client-side bleed the isolation guarantee
 *      (COR-001) must not allow.
 *   2. END THE AUTH SESSION (`logout()`): clear the token store + best-effort
 *      `POST /api/auth/logout`. `logout()` stays deliberately lib-agnostic
 *      (tokens + axios only — no react-query import); this composer is where
 *      the cache concern is added, keeping that separation clean.
 *
 *   3. FORGET THE PARTICIPANT COMPOSER'S SESSION-SCOPED STATE (demo-polish F4): the
 *      viewer's own just-published posts (`ownPostStore`, merged at the top of the
 *      feed) and any pending "open the thread to reply" intent. Both are module
 *      singletons that live as long as the TAB, not the session, so without this a
 *      post made as one persona would be merged into the next sign-in's feed on the
 *      same tab. Both modules are leaves (no imports beyond types) so this adds
 *      nothing to `core/auth`'s dependency graph.
 *
 *   4. FORGET THE SESSION'S TAKEN-DOWN POST IDS (demo-polish C5): `removedPosts` is the
 *      same kind of tab-lived module singleton (opaque ids that stop a post being shown),
 *      reset the same way so a sign-in on the same tab never inherits the last session's.
 *      Also a leaf module (no imports).
 *
 * NAVIGATION is the CALLER's job (the control does `void endSession()` then
 * `navigate(LOGIN_PATH)`) — this module has no router dependency, mirroring
 * `logout()`. Both `clear()` and the token clear run SYNCHRONOUSLY before
 * `logout()` awaits its network call, so the caller's immediate navigate never
 * blocks on a slow/hung request. Never throws (`logout()` swallows its own
 * network failure; `clear()` is synchronous and local).
 *
 * World: platform/foundation. No UI, no COBRA. Never logs a token.
 */
import { queryClient } from '../services/queryClient'
import { ownPostStore } from '@/features/social/services/ownPostStore'
import { removedPosts } from '@/features/social/services/removedPosts'
import { resetReplyIntent } from '@/features/social/services/replyIntent'
import { logout } from './logout'

/**
 * Fully tears down the client session: drops all cached server-state so no
 * prior-user data survives into the next session, then logs out (token clear +
 * best-effort server notify). The caller navigates to the login entry
 * afterward. Never throws.
 */
export async function endSession(): Promise<void> {
  queryClient.clear()
  ownPostStore.reset()
  removedPosts.reset()
  resetReplyIntent()
  await logout()
}
