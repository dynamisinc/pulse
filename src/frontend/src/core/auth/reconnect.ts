/**
 * core/auth/reconnect.ts
 * ---------------------------------------------------------------------------
 * The two small decisions BOTH page-load providers share when their first request
 * fails (easy-login Gate-2 W-5, extended by W2-3 and S2-1):
 *
 *  - `signInPathForPage()`: where the "Sign in again" link on the neutral
 *    "Reconnecting..." screen (`ReconnectingState`) goes;
 *  - `httpStatusOf(error)`: the HTTP status of a failed request, for a provider that has to
 *    tell "the server said no" from "the server was not reached".
 *
 * ## Who uses it
 * `SessionProvider` (`GET /session`) and `ExerciseContextProvider` (`GET
 * /exercise-context`, the very FIRST request at page load, before any session exists) both
 * show the same screen when a signed-in person's request did not get an answer, instead of
 * bouncing a participant to sign in again with an intact pair or leaving them on a dead
 * "Session unavailable" notice. Each owns its own rule for WHEN (the session provider also
 * treats an expired session as a refusal; the exercise provider treats a 404 as "no such
 * exercise"), and they share only the two helpers here, so the screen cannot drift between
 * them.
 *
 * ## Which sign-in page (S2-1)
 * A staff tab (its session lives in `sessionStorage`, including a refused one that is still
 * sticky to it) signs in again at the STAFF sign-in; everyone else at the participant one.
 * Sending a controller to the participant page, which is for people who have a personal link
 * or today's word, strands them on a form that cannot sign them in. The store, not the URL,
 * decides, because the page may be anywhere.
 *
 * Leaf module: it imports only `tokenStore` and the world-neutral path constants. No UI.
 */

import { isAxiosError } from 'axios'
import { LOGIN_PATH, STAFF_LOGIN_PATH } from '@/features/app-shell/constants'
import { isSessionScoped } from './tokenStore'

/** The sign-in page "Sign in again" leads to for THIS page's kind of session. */
export function signInPathForPage(): string {
  return isSessionScoped() ? STAFF_LOGIN_PATH : LOGIN_PATH
}

/**
 * The HTTP status the server answered a failed request with, or `undefined` when there was
 * none (no response at all, or not an HTTP error).
 */
export function httpStatusOf(error: unknown): number | undefined {
  return isAxiosError(error) ? error.response?.status : undefined
}
