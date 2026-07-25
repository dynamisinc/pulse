# Story: Frontend session & token wiring (live flip)

**Feature:** Login & UAT go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Complete (PR #311, merged)
**Requirements:** COR-012  ·  **Design decisions:** none  ·  **Issue:** #304
**Stack:** frontend  ·  **Review:** Tier-1

## Context

`identity-auth-roles/03` (Complete) built the entire backend session hinge — `GET /api/session`,
`POST /api/auth/refresh`, `POST /api/auth/logout` — and its own Delivered note says exactly what is left:
*"Frontend live-flip deferred to backend deployment... flipping `sessionResolver`'s `USE_MOCK_SESSION` to
live is a one-line switch once a real backend is reachable."* That switch (`USE_MOCK_SESSION =
USE_MOCK_DATA` in `core/auth/sessionResolver.ts`) already exists and needs **no code change** — but
nothing in the frontend today attaches a bearer token to the request that switch makes, so the "live"
call 401s immediately. And when it 401s, `SessionProvider` renders nothing (by design, per its own file
header: *"renders nothing if resolution fails... so a descendant can never observe a default, unscoped,
or expired session"*) — which is the correct fail-**closed** behavior for content, but produces a blank
screen instead of a real redirect to sign in. This story is the split-from-`identity-auth-roles/03` piece
that makes the flip actually work: a token store, the axios interceptor that attaches it, a silent-refresh
attempt before giving up, and a real (still fail-closed) redirect instead of a blank render.

Split from `identity-auth-roles/03-sessions.md` (its "Frozen-seam flip" AC, left unchecked/deferred
there) — see `docs/features/login/feature.md` Design notes for why the split lives here instead.

## Acceptance Criteria

- [x] **Given** a successful login response from any of the three login endpoints (`/api/auth/login`,
      `/api/auth/staff/login`, `/api/auth/shared` — all three return the same `{ token, refreshToken?,
      session }` envelope), **when** the caller hands that envelope to the new token store, **then** the
      access token and refresh token (if present) are persisted for the session's lifetime and are
      retrievable by the shared axios client on every subsequent request.
      Verified: `core/auth/tokenStore.ts`'s `setTokens()` writes both keys to `sessionStorage` (clearing
      the refresh key when absent, never a stale one); `core/services/api.ts`'s request interceptor reads
      `getAccessToken()` on every call.
- [x] **Given** a stored access token, **when** any request goes out through the shared axios client
      (`core/services/api.ts`), **then** it carries an `Authorization: Bearer <token>` header; a request
      made with **no** stored token carries no `Authorization` header (never a stale/empty one).
      Verified: `api.ts` lines 86-95 (request interceptor) — only sets the header when `getAccessToken()`
      returns a token and the caller hasn't already supplied one.
- [x] **Given** a request that comes back `401`, **when** the client has a stored refresh token, **then**
      it attempts **exactly one** silent `POST /api/auth/refresh`, and on success stores the rotated
      tokens and retries the original request once; **on refresh failure** (401/network error), it clears
      both tokens and does not retry further (no refresh loop; the refresh/login endpoints themselves are
      excluded from this retry so a failing refresh can't recursively trigger itself).
      Verified: `api.ts`'s response interceptor (`_pulseRefreshRetried` flag caps the retry at one),
      `performSilentRefresh()` + `silentRefresh()` (coalesces concurrent 401s onto one in-flight call),
      `NO_REFRESH_RETRY_PATHS` excludes `/auth/refresh`, `/auth/logout`, and all three login endpoints.
- [x] **Given** `SessionProvider` fails to resolve a session (401 with no usable refresh, or any other
      resolution failure), **when** that failure occurs, **then** it renders a redirect to the login entry
      (`LOGIN_PATH`, `/login`) instead of rendering nothing — still fail-closed for **content** (no
      descendant ever mounts), now visible instead of blank.
      Verified (independently confirmed pre-session): `core/auth/session.tsx:104`.
- [x] **Given** a call to `POST /api/auth/logout`, **when** it completes (or fails — logout always
      succeeds client-side per the backend's idempotent `204`), **then** both stored tokens are cleared
      immediately, before the network call resolves is acceptable but the tokens must not survive the
      call either way.
      Verified: `core/auth/logout.ts`'s `logout()` captures the token, calls `clearTokens()`, **then**
      awaits the `POST /auth/logout` inside a `try`/`catch` that swallows any failure.
- [x] No token (access or refresh) is ever written to `console.log`/`console.error`, and the interceptor's
      own error logging (mirroring the existing `[session]`/`[exerciseContext]` console-signal precedent)
      never includes the raw token value.
      Verified: `api.ts`/`tokenStore.ts`/`logout.ts` have no console output at all; `session.tsx`'s
      `console.error` explicitly logs only `error.message` (never the raw `AxiosError`, whose
      `config.headers` would carry the bearer token) — see its inline comment at line 90.

## Out of Scope

`ExerciseContextProvider`'s failure branch is **not** touched here — a failed `/exercise-context` (e.g.
an unrecognized host) is a different failure mode ("this URL isn't a known exercise") from an
unauthenticated session, and redirecting it to `/login` would be misleading; that UX is a documented
follow-up, not part of this story. A global "session expired mid-app" listener for a 401 on some *other*
already-authenticated call (e.g. a feed fetch outliving its token) is also out of scope — today's surface
area is thin enough (one social feed, no other protected reads yet) that the login-time path above covers
the real gap; revisit when more authenticated surfaces exist. Building the login **forms** themselves
(stories 02/03); the routing swap that mounts them at `/login` (story 04); anything in
`Pulse.WebApi` (all consumed, none built here).

## Technical Notes

World: platform/foundation (`core/`, no UI, no COBRA, no participant skin — same world as
`core/auth/session.tsx` today).

- **New:** `src/frontend/src/core/auth/tokenStore.ts` — `getAccessToken()`, `getRefreshToken()`,
  `setTokens({ token, refreshToken? })`, `clearTokens()`. Backed by `sessionStorage` (not
  `localStorage`): cleared on tab close, not shared cross-tab, and — per NFR-004 — a smaller persistent-
  XSS blast radius than `localStorage` while still surviving an in-exercise page reload (a pure in-memory
  store would force a full re-login on every reload, unacceptable for a multi-hour exercise). Document
  this trade-off in the module header; it is a deliberate call, not an oversight.
- **Edit:** `src/frontend/src/core/services/api.ts` — add a request interceptor reading
  `tokenStore.getAccessToken()`; add a response interceptor implementing the one-shot silent-refresh
  described above. Keep this module framework-agnostic (no `react-router` import here — it is imported
  by `core/exerciseContext`, `core/auth`, and every feature; a router dependency here would be a layering
  violation). The interceptor calls `tokenStore` and a plain `resolveRefresh()` function (co-located with
  or exported from `sessionResolver.ts`) — not React state.
- **Edit:** `src/frontend/src/core/auth/session.tsx` — change the `'error'` render branch from `null` to
  `<Navigate to={LOGIN_PATH} replace />`. This adds `react-router-dom` and
  `features/app-shell/constants.ts`'s `LOGIN_PATH` as new imports to a `core/` module; that is an
  accepted, deliberate coupling (mirrors `RoleAwareEntry.tsx`'s own use of `<Navigate>` for the same
  constant) — call it out in review rather than treat it as a smell. Update `session.test.tsx`
  accordingly (it currently asserts the null-render fail-closed behavior).
- `core/auth/sessionResolver.ts` needs **no change** — `USE_MOCK_SESSION` already delegates to
  `USE_MOCK_DATA` and the real `/session` call already goes through the (now token-attaching) shared
  axios client.
- See `docs/features/login/implementation.md` for the reuse map and this story's Wave-1 slot.

## Dependencies

`identity-auth-roles/03` (Complete — the backend contract this wires to: `GET /api/session`,
`POST /api/auth/refresh`, `POST /api/auth/logout`, all returning/consuming the frozen `Session`/token
shapes). No dependency on stories 02–06 of this feature (this is the Wave-1 foundation they build on).

## Tests

- Unit: `tokenStore` set/get/clear round-trips; a cleared store returns no token.
- Unit: the axios request interceptor attaches `Authorization: Bearer <token>` when a token is stored,
  and omits the header when none is stored.
- Unit/integration: a `401` with a stored refresh token triggers exactly one `POST /api/auth/refresh`
  call and retries the original request on success; a failed refresh clears both tokens and does not
  loop.
- Update `core/auth/session.test.tsx`: the failure branch now asserts a redirect to `LOGIN_PATH`
  (`<Navigate>`) rather than a null render.
- Manual check (documented, while the harness is thin): with `VITE_USE_MOCK_DATA` unset against a real
  backend, an unauthenticated load of the app redirects to `/login` instead of rendering blank.
