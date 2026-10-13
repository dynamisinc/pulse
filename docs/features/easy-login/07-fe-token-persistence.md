# Story: Participant tokens survive a closed tab

**Feature:** Easy participant login  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-012, NFR-004, NFR-009  ·  **Design decisions:** none (EL-10)  ·  **Issue:** —
**Stack:** frontend  ·  **Review:** Tier-2 (changes where credentials live in the browser)  ·  **Priority:** Must  ·  **Wave:** 1  ·  **Effort:** M

## Context

`core/auth/tokenStore.ts` keeps the token pair in `sessionStorage` on purpose: it dies with the tab and is never
shared across tabs, which keeps a persistent-XSS blast radius small. That was the right default for a staff console.
It is the wrong one for a participant on a phone: Tom's requirement is that a participant **stays signed in for the
exercise day**, through a closed tab and a locked phone. On iOS especially, a tab is discarded without warning.

So participants get `localStorage` and **staff keep `sessionStorage`** (EL-10). This story changes the store and the
silent-refresh path; the participant sign-in pages (08, 09) are the callers that opt in. It is world-neutral
platform code (no UI).

Moving to a storage that is **shared across tabs** introduces a hazard `sessionStorage` never had: two tabs wake up
on a stale access token together, both send the same refresh token, the first rotates it, the second is refused and
`clearTokens()` wipes the fresh pair the first just stored: the user is signed out of every tab. This story closes
that race.

## Acceptance Criteria

- [ ] **Given** `setTokens(pair, { persist: true })`, **then** the pair is written to `localStorage` and any copy in
      `sessionStorage` is removed; **given** `{ persist: false }` or no options, **then** it is written to
      `sessionStorage` and any `localStorage` copy is removed (today's behaviour, so every existing caller is
      unchanged). The two-key layout (`pulse.auth.token`, `pulse.auth.refreshToken`) is kept, and a pair with no
      refresh token clears any stale one in the target store, as today.
- [ ] **Given** tokens in either store, **then** `getAccessToken()` / `getRefreshToken()` return them (a
      `sessionStorage` value wins if both somehow exist) and return `null`, never throw, when neither has one.
      `clearTokens()` clears **both** stores. `logout()` and `endSession()` therefore leave no token in either, and a
      test proves a signed-out browser has nothing in `localStorage`.
- [ ] **Given** a silent refresh (`performSilentRefresh` in `core/services/api.ts`), **then** the rotated pair is
      stored **in the same store the current pair lives in** (a participant stays persistent, a staff user stays
      session-only), without the caller passing an option. A refresh the server **refuses** (`/auth/refresh`
      answering `401` or `403`) clears both stores and the original `401` propagates. A refresh that gets **no
      answer** (no response, a network error, the timeout, a `5xx` or `429`) clears **nothing**, for staff and
      participants alike: the stored pair is kept, the original request is rejected with its own error, and the
      next `401` tries the refresh again. The refresh call (that call only, not the shared axios instance) has a
      20 s timeout, so a hung refresh cannot hold the Web Lock and block every other tab; a timeout counts as "no
      answer". *(Amended by the orchestrator: the original wording cleared both stores on any refresh failure.
      With day-long sessions, a dropped request must not log a participant out. The backend answers a bad refresh
      token with `401` only, see `SessionEndpoints.RefreshAsync`.)*
- [ ] **Given** `/auth/join` and `/auth/word`, **then** they are added to `NO_REFRESH_RETRY_PATHS` so a rejected link
      or word is never mistaken for an expired session and never triggers a refresh.
- [ ] **Given** two tabs that receive a `401` at the same moment, **then** exactly one `POST /auth/refresh` is made
      and **neither tab is signed out**: the refresh runs under a Web Lock (`navigator.locks.request`) so a second tab
      waits and then adopts the already-rotated pair; where the Locks API is absent, a refresh that fails re-reads the
      stored refresh token first and, if it has changed since the attempt began, retries once with the new value
      instead of clearing. A unit test simulates the second tab by changing storage mid-flight.
- [ ] **Given** storage that throws (Safari private mode, quota, blocked by policy), **then** none of the store's
      functions throw: it falls back to an in-memory copy for the page's life, and the app still works until reload.

### Cross-cutting
- [ ] **Content security / secrets (NFR-004, NFR-009):** no token value is ever logged, thrown in an error message,
      or placed in a URL; keys stay namespaced `pulse.auth.*`. The staff sign-in page is verified (a test on the call
      site) to **not** pass `persist: true`, so staff tokens never reach `localStorage`.
- [ ] **Accessibility / two worlds:** no UI; not applicable. No COBRA or participant skin is imported.

## Out of Scope

The participant pages that pass `persist: true` (08 join, 09 sign-in; the existing password and shared-code flows
are updated by 09). Moving the session to an httpOnly cookie (a backend change, out of scope). Cross-tab sign-out
broadcast beyond the storage-event behaviour. Persisting anything other than the two tokens. The server-side end of
day (06).

## Technical Notes

Frontend core, world-neutral. Edits `src/frontend/src/core/auth/tokenStore.ts` (stays a **zero-import leaf**, as its
header requires, so `core/services/api.ts` can import it without a cycle) and `src/frontend/src/core/services/api.ts`.
Do not import `sessionResolver` or `session.tsx` into either. Update both files' header comments: `tokenStore`'s
current "deliberately NOT localStorage" rationale becomes "participants opt in; staff do not". The signature
`setTokens(pair: TokenPair, options?: { persist?: boolean }): void` is **frozen** (stories 08 and 09 code against it).
`navigator.locks` may be undefined in jsdom and older browsers: feature-detect. No new npm package. See
`implementation.md` (story 07).

## Dependencies

None (contract only). Blocks 08 and 09. Pairs with backend 06.

## Tests

`core/auth/tokenStore.test.ts` (both stores, switching, both-clear, throwing storage, memory fallback),
`core/services/api.test.ts` (refresh keeps the mode, excluded paths, the two-tab race with and without
`navigator.locks`), `core/auth/logout.test.ts` and `endSession.test.ts` (nothing left in `localStorage`), and a
call-site test for `StaffSignInPage` asserting no `persist`.
