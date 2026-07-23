# Story: Wire real login routes + logout

**Feature:** Login & UAT go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-004, COR-005 (consumed, not re-decided)  ·  **Design decisions:** none  ·  **Issue:** #307
**Stack:** frontend  ·  **Review:** Tier-1

## Context

The routing plumbing that fails closed to `/login` already exists (`RoleAwareEntry.tsx`, `routes.tsx`,
`constants.ts`) and already documents, in its own comments, that it is waiting on exactly this: *"The
login page + its theming are owned by the login story (COR-030, out of scope here)... The orchestrator
should DROP this route once the real `/login` route exists."* This story is that drop-in: replace the
`SignInFallback` placeholder with story 02's participant page, add the new `/staff/login` route for
story 03's staff page, and add the one piece neither of those stories owns — a **logout** affordance,
which does not exist anywhere in the app today (`StaffHeader.tsx` has no sign-out control, and no
participant surface has one either).

**Why `/login` stays world-neutral instead of routing by role.** `RoleAwareEntry` currently sends *every*
fail-closed case — an expired participant session, an expired staff session, an unsupported role — to
the same `LOGIN_PATH`. Making that role-aware (so an expired staff session lands on `/staff/login`
directly) would mean threading role information through a redirect that, by construction, fires
precisely when the role can no longer be trusted (the session that would prove it has already failed).
Simplest and safest: `/login` stays the one universal fail-closed landing, hosts the participant form
directly (the majority case), and carries one clearly-labelled link to `/staff/login` for the staff
minority. Revisit only if this proves to be a real friction point in practice.

## Acceptance Criteria

- [ ] **Given** the route table in `features/app-shell/routes.tsx`, **when** it is rebuilt, **then**
      `LOGIN_PATH` (`/login`) renders story 02's `ParticipantSignInPage` (replacing `SignInFallback`) and
      a new route (`/staff/login`) renders story 03's `StaffSignInPage`; `SignInFallback.tsx` is deleted
      (not merely unused — the module header itself says to drop it).
- [ ] **Given** `ParticipantSignInPage`, **when** it renders, **then** it includes a visible, clearly
      separated link/section to `/staff/login` ("Staff or controller? Sign in here.") — the one place the
      two worlds are allowed to reference each other, and only as a link, never shared chrome.
- [ ] **Given** an authenticated session (any role), **when** the user triggers logout, **then**
      `POST /api/auth/logout` is called, `tokenStore` is cleared (story 01), and the app navigates to
      `/login` — landing on a real sign-in form, not a blank screen or a stale surface.
- [ ] **Given** the staff world, **when** `StaffHeader` renders, **then** it includes a logout control
      (icon + accessible name, FontAwesome, COBRA `styledComponents` — never a bare MUI button) reachable
      by keyboard.
- [ ] **Given** the participant world, **when** the participant shell renders, **then** it includes an
      equivalent, brand-appropriate logout affordance (this story adds the control; it does not redesign
      the participant shell's chrome — place it wherever the shell already has a settings/account
      affordance, or a minimal new one if none exists yet).
- [ ] **Given** the stale `(COR-030, out of scope here)` comments in `SignInFallback.tsx`'s own header
      (now deleted), `routes.tsx`, and `constants.ts`, **when** this story edits those files, **then** the
      surviving comments in `routes.tsx`/`constants.ts` are corrected to reference this feature
      (`docs/features/login/`) instead of the COR-030 misnomer (see `feature.md`'s naming note) — a
      drive-by fix made *because* this story is already touching those exact lines, not a separate pass.

## Out of Scope

The pages themselves (stories 02/03); the token store / interceptor / silent-refresh mechanics (story
01); redesigning the participant shell's chrome beyond adding one logout control; a role-aware fail-
closed redirect target (flagged above as a documented non-goal, not an oversight); anything in
`Pulse.WebApi` (the logout endpoint already exists and is Complete).

## Technical Notes

World: **routing glue — world-neutral at the route-table level**, world-specific only inside the two
pages it wires (same posture as `RoleAwareEntry.tsx` itself). Edits (not new files, mostly):
`src/frontend/src/features/app-shell/routes.tsx`, `constants.ts` (add `STAFF_LOGIN_PATH` alongside
`LOGIN_PATH`); **deletes** `src/frontend/src/features/app-shell/SignInFallback.tsx`. Adds a logout
control to `src/frontend/src/features/staffShell/components/StaffHeader.tsx` (COBRA) and to the
participant shell (`src/frontend/src/features/participant-shell/`, per-brand skin — check
`ShellLayout.tsx`/its header for the nearest existing account-affordance slot before adding a new one).
Both logout controls call a shared `logout()` helper (co-locate in `core/auth/` alongside `tokenStore`,
or export from story 01's module — a small addition, coordinate with story 01's file footprint since both
touch `core/auth/`). This is a **routing-glue story that happens to edit `app-shell`'s files**; it is
filed under `login` rather than `app-shell` because it only exists to complete this feature (see
`feature.md` Dependencies) — cross-reference `docs/features/app-shell/feature.md` when editing its files.
See `docs/features/login/implementation.md` for the reuse map and Wave-3 slot.

## Dependencies

Story 01 (tokenStore + `logout()` helper). Story 02 (`ParticipantSignInPage`). Story 03
(`StaffSignInPage`). Consumes (does not modify) `app-shell/01`'s `RoleAwareEntry`/`RoleRouter` and
`exercise-isolation/04`'s participant guard.

## Tests

- Routing test (extends `routes.test.tsx`): `/login` renders `ParticipantSignInPage`; `/staff/login`
  renders `StaffSignInPage`; `SignInFallback` is no longer imported anywhere.
- Integration: clicking logout (staff and participant) calls `POST /api/auth/logout`, clears the token
  store, and navigates to `/login`.
- Accessibility: both logout controls have an accessible name and are keyboard-activatable; the
  participant→staff link on `/login` is a real, labelled link (not a styled `div`).
