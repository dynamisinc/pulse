# Story: Staff sign-in

**Feature:** Login & UAT go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Complete (PR #314, merged)
**Requirements:** COR-014  ·  **Design decisions:** none  ·  **Issue:** #306
**Stack:** frontend  ·  **Review:** Tier-1

## Context

`identity-auth-roles/05` (Complete) built `POST /api/auth/staff/login` against the Phase-1
`DynamisIdentityProvider` allowlist (COR-014). No staff-facing form exists — this story is that form, at
its own route (`/staff/login`, wired by story 04), deliberately **not** sharing a page with the
participant form (story 02): D0 §2 forbids COBRA leaking onto a participant path or a brand skin leaking
onto a staff one, and putting both on one physical page under one theme risks exactly that. A separate
route lets this page mount the COBRA theme cleanly, the same way `StaffWorldHandoff` already does for the
post-login staff branch.

**A design call this story makes, flagged for confirmation (not silently assumed):** `StaffLoginRequest`
requires `{ username, secret, exerciseId }` in one call — the backend authenticates the credential *and*
checks assignment to that exercise atomically; there is no pre-auth endpoint that lists a staff member's
exercises before they've proven who they are (correctly — that data is staff-only, XC-002). Today's UAT
deployment is a single hostname serving one exercise, and `GET /api/exercise-context` (already resolvable
pre-auth via `exercise-isolation/08`'s host mapping) already gives that exercise's id. **This story derives
`exerciseId` from the host-resolved exercise context, invisibly to the staff user, rather than asking them
to paste a GUID.** A staff member assigned to more than one exercise still authenticates against *this*
host's exercise first, and reaches the others afterward via the already-built `ExerciseSwitcher`
(`exercise-isolation/05`). If a future deployment needs staff to sign in on a host with **no** resolvable
exercise (e.g. a shared staff-only base domain), this derivation breaks and a manual/picker fallback would
be needed — out of scope here; flagged as a follow-up, not built speculatively.

## Acceptance Criteria

- [x] **Given** a staff member navigates to `/staff/login`, **when** the page renders, **then** it shows
      a COBRA-styled form with **username** and **secret** fields only (no exercise field — see Context).
      Verified: `StaffSignInForm` renders exactly two `CobraTextField`s ("Username", "Secret") inside a
      `ThemeProvider theme={cobraTheme}` mount — no exercise-id field.
- [x] **Given** the page cannot resolve `GET /api/exercise-context` for the current host, **when** the
      staff member attempts to sign in, **then** the form shows a clear, actionable error ("This address
      isn't configured for staff sign-in — check the URL your planner gave you.") **before** attempting
      `POST /api/auth/staff/login` (never silently sending an empty/guessed `exerciseId`).
      Verified: `handleSubmit` checks `contextQuery.isPending || contextQuery.isError || !contextQuery.data`
      and returns (setting `UNRESOLVED_CONTEXT_MESSAGE`) **before** `staffSignIn(...)` is ever called.
- [x] **Given** a valid username + secret + the resolved `exerciseId`, **when** submitted, **then** the
      returned `{ token, refreshToken?, session }` envelope is handed to `tokenStore` (story 01) and the
      app navigates to `/` (the role-aware entry lands the staff member on their console/evaluator
      surface per `app-shell/01` — this story does not re-decide that).
      Verified: `staffSignIn({ username, secret, exerciseId })` on success calls `setTokens()` then
      `navigate('/')`.
- [x] **Given** a `401` (rejected credential), **when** the response arrives, **then** the form shows one
      generic message ("Those credentials weren't recognized.") and clears only the secret field.
      Verified: `friendlySignInErrorMessage`'s `case 401` returns `INVALID_CREDENTIALS_MESSAGE`; `secret`
      is cleared only `if (signInError.status === 401)`.
- [x] **Given** a `403` (authenticated but not assigned to this exercise — `StaffLoginOutcome.NotAssigned`),
      **when** the response arrives, **then** the form shows a **distinct** message from the 401 case
      ("You're not assigned to this exercise. Contact your planner.") — this is a genuinely different,
      actionable failure and collapsing it into the generic 401 copy would send staff chasing the wrong
      fix.
      Verified: `case 403` returns the distinct `NOT_ASSIGNED_MESSAGE`; the secret-clear branch is
      `status === 401` only, so a 403 leaves the form's credentials intact.

### Cross-cutting

- [x] **Accessibility (NFR-001):** labelled `<form>` inputs, the secret field masked
      (`type="password"`), error states `role="alert"` pairing icon + text (never color alone), a
      submit-in-flight state announced via `aria-live="polite"` — same pattern as `ExerciseSwitcher`.
      Verified: `CobraTextField label=...` on both fields, `type="password"` on the secret field,
      `SignInAlert` is `role="alert"` pairing `faTriangleExclamation` with text, the submitting block is
      `role="status" aria-live="polite"`.
- [x] **Content security (NFR-004/NFR-009):** the secret is never logged, never rendered back, and the
      input is a real `<input type="password">` (not `text`) so it isn't shoulder-surfable by default.
      Verified: no console output anywhere in `StaffSignInPage.tsx`/`staffSignInService.ts`; the secret
      field is `type="password"`; `toStaffSignInError()` only ever captures `status`/`serverMessage`
      (never the request body).

## Out of Scope

The routing wiring at `/staff/login` (story 04); the token store / interceptor (story 01); a multi-
exercise picker for a staff member with no resolvable host exercise (flagged above as a real follow-up,
not built here); provisioning the `StaffUser`/`StaffAssignment` rows this page authenticates against
(story 05); the `ExerciseSwitcher` itself (`exercise-isolation/05`, already built) — this page only gets
the staff member to *a* valid session, switching exercises afterward is that component's job.

## Technical Notes

World: **staff**. New files under `src/frontend/src/features/login/`: `pages/StaffSignInPage.tsx`,
`services/staffSignInService.ts` (thin wrapper over the shared axios client for
`POST /api/auth/staff/login`, mirroring `StaffLoginResponseDto`'s frozen shape). Mounts
`<ThemeProvider theme={cobraTheme}>` directly (same import as `RoleAwareEntry.tsx`'s
`StaffWorldHandoff`) and uses `@/theme/styledComponents` (`CobraTextField`,
`CobraPrimaryButton`) — never `@mui/material`'s bare `TextField`/`Button`. Resolves `exerciseId` from a
page-owned re-resolve of the host exercise to populate the login request body. **AS BUILT (#314 —
supersedes an earlier "mount your own `ExerciseContextProvider` / read `useExerciseContext()`" note):**
the resolve is NON-BLOCKING via `useQuery(resolveExerciseContext, { retry: false })`, NOT
`ExerciseContextProvider`. That provider is fail-closed (renders `null` while loading AND on error), which
would hide the form and make AC1 (the form must render) and AC2 (the unresolved-host error must show ON
the form) impossible. The form always renders; submission is blocked — and `POST /auth/staff/login` never
sent — while the query is `isPending`/`isError`/has no `data`. See
`docs/features/login/implementation.md` for the reuse map and Wave-2 slot.

## Dependencies

Story 01 (tokenStore). `identity-auth-roles/05` (Complete — the backend contract). `exercise-isolation/08`
(`GET /api/exercise-context`, Complete). Consumed by story 04 (routing).

## Tests

- Component test: renders username/secret fields; the secret input is masked; submit is keyboard-
  reachable (Enter submits).
- Integration (mocked axios): a successful staff login stores tokens and navigates to `/`; the request
  body's `exerciseId` matches the resolved `/exercise-context` value.
- Integration: a `401` shows the generic-credential message; a `403` (`NotAssigned`) shows the distinct
  not-assigned message; an unresolved `/exercise-context` blocks submission with its own message rather
  than posting an empty `exerciseId`.
- Accessibility: error alerts are announced; the page never imports `@mui/material`'s unstyled
  components directly (COBRA-only, per the two-worlds gate).
