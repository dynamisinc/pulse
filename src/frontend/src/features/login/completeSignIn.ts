/**
 * features/login/completeSignIn.ts
 * ---------------------------------------------------------------------------
 * THE ONE "sign-in succeeded" STEP shared by every way into the app (feature:
 * easy-login, Gate-2 W-2): the join link, the participant sign-in page's three
 * methods (Today's word, Password, View-only code) and the staff sign-in page.
 *
 *     store the new tokens  ->  forget the previous identity's client state
 *                           ->  go to the role-aware entry (replacing this page)
 *
 * ## Why one function
 * The join page already did all three (Gate-1 W-1 on story 08). The sign-in pages
 * did the first and the last only, so a participant who signed in on a tab that had
 * been someone else's (the next person at a shared kiosk, a tester switching
 * personas) kept the previous user's cached feed, their just-published own posts and
 * any pending "open the thread to reply" intent until each query refetched. That is
 * the cross-user bleed the isolation rule (COR-001) exists to prevent. Three pages
 * each remembering to call `resetClientSession()` will drift; one helper cannot, and
 * `completeSignIn.test.ts` source-scans the three pages so a fourth way in cannot
 * quietly skip it either.
 *
 * ## The order is part of the contract
 *  1. `setTokens` - the new pair is stored first, so any request fired from here on
 *     (including a refetch caused by the cache clear) carries the NEW identity.
 *  2. `resetClientSession()` - clears the shared React Query cache and the
 *     participant composer's tab-lived singletons (`@/core/auth`'s `endSession`
 *     explains the list). It does NOT touch the token store, which is why it is safe
 *     to run after step 1 (sign-out runs it before `logout()`; sign-in runs it after
 *     `setTokens`).
 *  3. `queryClient.clear()` on the caller's own client, when it passes one: in the app
 *     that is the same object as step 2's, but a test (or a future second provider)
 *     may mount a different one, and it must not keep the old identity's data either.
 *  4. `navigate('/', { replace: true })` - the role-aware entry decides the landing
 *     surface from the new session. `replace`, so Back never returns to a sign-in
 *     page that has just done its job.
 *
 * ## Persistence
 * `persist: true` stores the pair in `localStorage` (a participant stays signed in
 * for the exercise day however they got in, EL-10). `persist: false` keeps the
 * default `sessionStorage` (staff: a closed tab ends the session). The default is
 * passed as "no options at all" so `setTokens`' own default stays the single source
 * of that rule.
 *
 * ## What it deliberately does not do
 * It does not read or log the tokens, does not touch the URL, and knows nothing
 * about the form that produced the pair. Navigation is the caller's `navigate` (core
 * auth has no router dependency, so this lives with the login feature).
 *
 * World: login glue shared by BOTH worlds' pre-auth pages. No UI, no MUI, no COBRA,
 * no `@/theme` - so it is safe on the participant pages that are source-scanned for
 * exactly those imports. Never throws on its own.
 */

import type { TokenPair } from '@/core/auth'
import { resetClientSession, setTokens } from '@/core/auth'

/**
 * Where every successful sign-in hands off: the role-aware entry, which resolves the
 * session's role and lands the person on their own surface (staff: their default
 * staff surface; participant: their feed).
 */
export const SIGNED_IN_PATH = '/'

export interface CompleteSignInOptions {
  /**
   * `true` stores the pair in `localStorage` (participants, EL-10); `false` in
   * `sessionStorage` (staff).
   */
  readonly persist: boolean
  /** The router's `navigate`; called as `navigate('/', { replace: true })`. */
  readonly navigate: (to: string, options: { replace: true }) => void
  /**
   * The caller's React Query client, when it has one. Cleared as well as the shared
   * one so a page mounted under a different provider forgets the old identity too.
   */
  readonly queryClient?: { clear: () => void }
}

/**
 * Finishes a successful sign-in. See the module header for the order and why.
 *
 * @param pair the access + refresh tokens the server returned.
 */
export function completeSignIn(pair: TokenPair, options: CompleteSignInOptions): void {
  if (options.persist) {
    setTokens(pair, { persist: true })
  } else {
    setTokens(pair)
  }
  resetClientSession()
  options.queryClient?.clear()
  options.navigate(SIGNED_IN_PATH, { replace: true })
}
