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
import { logout } from './logout'

/**
 * Fully tears down the client session: drops all cached server-state so no
 * prior-user data survives into the next session, then logs out (token clear +
 * best-effort server notify). The caller navigates to the login entry
 * afterward. Never throws.
 */
export async function endSession(): Promise<void> {
  queryClient.clear()
  await logout()
}
