# Story: Participant sign-in (named account + shared read-only code)

**Feature:** Login & UAT go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Complete (PR #313, merged)
**Requirements:** COR-011, COR-015  ·  **Design decisions:** none  ·  **Issue:** #305
**Stack:** frontend  ·  **Review:** Tier-1

## Context

`identity-auth-roles/02` (Complete) built `POST /api/auth/login` (handle + password, matched against
the host-resolved exercise's `Account` rows); `identity-auth-roles/06` (Complete) built
`POST /api/auth/shared` (the exercise's shared view-only password, COR-015's "hundred passive
participants" case). Neither story built a page — both explicitly carve "the login page theming" out of
scope (see the naming note in `feature.md`). This story is that page: the **one** participant-facing
entry point (COR-008's "URL + password is the entire onboarding") that hosts both credential kinds,
because they are the same physical surface — one page, one brand touch, two backend calls — not two
independently shippable slices.

## Acceptance Criteria

- [x] **Given** a participant navigates to `/login` (see story 04 for the route wiring), **when** the
      page renders, **then** it shows a named-account form (handle + password) as the primary path and a
      clearly separated "have a shared exercise code instead?" toggle/tab that swaps to the shared-code
      form (a single password field) — both on the same page, matching the two backend entry points.
      Verified: `ParticipantSignInPage.tsx`'s `toggleGroup` (mode `'named'` default, `'shared'` toggle),
      each rendering its own `<form>` conditionally on `mode`.
- [x] **Given** valid handle+password for an `Account` in the host-resolved exercise, **when** submitted
      to `POST /api/auth/login`, **then** the returned `{ token, refreshToken?, session }` envelope is
      handed to `tokenStore` (story 01) and the app navigates to `/` (the role-aware entry then lands the
      participant on their default surface per `app-shell/01` — this story does not re-decide that
      landing route).
      Verified: `signInWithPassword()` (`participantSignInService.ts`) posts to `/auth/login`;
      `completeSignIn()` calls `setTokens()` then `navigate('/')`.
- [x] **Given** a valid shared exercise password, **when** submitted to `POST /api/auth/shared`, **then**
      the same token-store + redirect-to-`/` flow runs, landing on a read-only session (`isReadOnly:
      true` on the returned session — this story does not need to special-case that; `app-shell/01`
      already routes a read-only participant the same as any other participant).
      Verified: `signInWithSharedCode()` posts to `/auth/shared` through the identical `completeSignIn()`
      path; the envelope's `session` is passed through untyped, exactly as the story says it should be.
- [x] **Given** a rejected credential (`401` from either endpoint), **when** the response arrives,
      **then** the form shows one generic message ("That handle/password wasn't recognized." /
      "That exercise code wasn't recognized.") — never distinguishing "wrong password" from "no such
      handle" (anti-enumeration, NFR-009) — and the password field is cleared, not the handle field.
      Verified: `isUnauthorizedSignInError()` branches on HTTP `status === 401` only (never
      `serverMessage`); `handleNamedSubmit`/`handleSharedSubmit` clear only `password`/`sharedPassword`,
      never `username`.
- [x] **Given** the page can resolve the host's exercise (`GET /api/exercise-context`, already
      pre-auth-safe per `exercise-isolation/08`), **when** it resolves, **then** the page shows the
      exercise's participant-visible name as a light branding touch (e.g. a heading — "Sign in to
      {exerciseName}"); when it does **not** resolve (unknown host), the page still renders a working,
      generically-branded form rather than blocking on the exercise lookup.
      Verified: `useResolvedExerciseName()` (`useQuery(..., { retry: false })`) leaves `data` `undefined`
      on error/loading; the heading falls back to plain `"Sign in"`; the forms render unconditionally
      either way.

### Cross-cutting

- [x] **No-enterprise-look (D0 §2):** this is a participant surface. No COBRA import, no
      `@/theme/styledComponents`, no bare default-MUI look. It mounts its own light theme scope (see
      Technical Notes) — never the COBRA `ThemeProvider`.
      Verified: the page imports no `@mui/material`/`@/theme/*` at all — plain semantic HTML + its own
      `ParticipantSignInPage.module.css`.
- [x] **Accessibility (NFR-001):** both forms are real `<form>`s with labelled inputs (`<label>`/
      `aria-label`, never placeholder-only labels); the tab/toggle between the two login kinds is
      keyboard-operable (reachable by Tab, a real button or ARIA tab pattern, not a `div onClick`); the
      error message is `role="alert"` and pairs an icon with text, never color alone; a submit-in-flight
      state is `aria-live="polite"` (mirrors `ExerciseSwitcher`'s existing loading/error pattern).
      Verified: `<label htmlFor>` pairs on every input; the toggle is a real `<button type="button"
      aria-pressed>` pair; the alert is `role="alert"` pairing `faTriangleExclamation` with text; the
      in-flight state is `role="status" aria-live="polite"`.
- [x] **Content security (NFR-004):** the handle/password/shared-code inputs are sent as-is to the
      backend (which owns sanitization/hashing) — this page never renders anything back from the request
      body via `dangerouslySetInnerHTML`, and the exercise name (from `/exercise-context`) is rendered as
      a plain React text node (escaped by construction).
      Verified: no `dangerouslySetInnerHTML` anywhere in the file; `{exerciseName}` is a plain JSX text
      interpolation.

## Out of Scope

The routing wiring that mounts this page at `/login` and replaces `SignInFallback` (story 04); the token
store / interceptor / refresh mechanics this page calls into (story 01); the staff sign-in surface
(story 03, a different world entirely); what happens *after* a successful login (the default landing
route, default-feed-for-read-only rule, etc. — all already built, `app-shell/01` /
`exercise-isolation/04`); provisioning the `Account`/`SharedCredential` rows this page authenticates
against (story 05, UAT bootstrap); a password-reset/forgot-password flow (no such requirement exists —
COR-017's participant-admin panel, deferred, is the reset mechanism, staff-initiated, not self-service).

## Technical Notes

World: **participant**. New files under `src/frontend/src/features/login/`:
`pages/ParticipantSignInPage.tsx`, `services/participantSignInService.ts` (thin wrappers over the shared
axios client for `POST /api/auth/login` and `POST /api/auth/shared`, mirroring the request/response
shapes already frozen in `Pulse.WebApi`'s `AccountDtos.cs`/`SharedReadOnlyLoginResponseDto.cs` — do not
invent a different envelope). MUI 9: system props are `sx`-only (see root `CLAUDE.md`). This page needs
its own, page-owned re-resolve of the host exercise (the `/login` route in `routes.tsx` does not wrap a
provider; do not reach for the app-wide provider tree, hoisted only around the post-auth `*` route).
**AS BUILT (#313 — supersedes an earlier "mount your own `ExerciseContextProvider`" note):** the
resolve is done NON-BLOCKINGLY via `useQuery(resolveExerciseContext, { retry: false })`, NOT by mounting
`ExerciseContextProvider`. That provider is fail-closed — it renders `null` while loading AND on error
(`core/exerciseContext/exerciseContext.tsx`) — so wrapping the forms in it would hide the entire page on
an unknown host, directly violating AC5 ("still renders a working form … rather than blocking on the
exercise lookup"). The soft query leaves `data` `undefined` while loading/erroring and the heading falls
back to a plain "Sign in", with the forms rendered unconditionally. See
`docs/features/login/implementation.md` for the reuse map and Wave-2 slot.

## Dependencies

Story 01 (tokenStore + the axios client it persists into). `identity-auth-roles/02` and `/06` (Complete
— the two backend endpoints this calls). `exercise-isolation/08` (`GET /api/exercise-context`,
Complete). Consumed by story 04 (routing).

## Tests

- Component test: renders both forms; toggling between them swaps the visible fields; each is keyboard-
  reachable.
- Integration (mocked axios): a successful `/api/auth/login` response stores tokens and navigates to
  `/`; a successful `/api/auth/shared` response does the same.
- Integration: a `401` from either endpoint shows the generic anti-enumeration message and clears only
  the password field.
- Accessibility: the error alert is announced (`role="alert"`), and the exercise-name heading renders
  when `/exercise-context` resolves and is omitted (not blank/broken) when it does not.
