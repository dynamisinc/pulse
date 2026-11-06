# Story: Org sign-in page (email + password, org choice, lands org admins on Exercise Management)

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-077, COR-074, COR-076  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §1.2  ·  **Issue:** #835
**Stack:** fullstack (frontend page + one backend change)  ·  **Review tier:** Tier-2 (authentication path)  ·  **Wave:** A1 follow-up, ahead of A2  ·  **Priority:** High (Jonathan, 2026-11-06)

## Context
Story 15 built the backend for an org-scope staff session, but explicitly left the sign-in form out of scope as
"real follow-on frontend work, tracked here as a named gap" (see its Out of Scope). Nothing sends the org
sign-in request today: `staffSignInService.ts` declares `StaffOrgSignInCredentials` with the note "Types only: no
UI sends this yet".

As a result, **no one can reach an org-admin session from a screen**. The only staff sign-in page,
`/staff/login` on an exercise's address, sends the exercise-bound request. An org admin, who is enrolled as a
planner by the bootstrap seam, gets a **planner** session. Since `createExercise` is `orgAdmin`-only, the
**Create exercise** form on Exercise Management never appears. The user guide lists the org sign-in page as
"Not yet on a screen".

This story is that page. It is enough on its own to test exercise creation on UAT: the backend already accepts
an email-and-password sign-in on any host. The shared console address (`console.<domain>/o/{slug}`) is story 28.

Staff world (COBRA).

## Acceptance Criteria
- [ ] **Sign in by email.** On the staff sign-in page, a staff member can sign in with **email and password**.
      The page sends `POST /api/auth/staff/login {email, password}` (no `exerciseId`), and an `orgSlug` when
      one is known (see below).
- [ ] **Org admins land on Exercise Management.** When the response is an org-scope session
      (`scope: 'org'`, `role: 'orgAdmin'`, `exerciseId: null`), the session is stored like any staff session
      and the user lands on Exercise Management with the **Create exercise** form available. This holds even
      when the organization has no exercises.
- [ ] **Everyone else lands on their exercise.** A non-org-admin gets their most recently used staff enrollment,
      as the backend already decides, and lands on that role's home screen.
- [ ] **Choose an organization.** When the response is `200 {choose:[{slug, orgName}], choiceToken}`, the page
      lists the organizations and posts `POST /api/auth/staff/login/choose {choiceToken, orgSlug}` for the one
      picked. The page says the choice expires (2 minutes), and an expired or used token sends the user back to
      the sign-in form with a plain message.
- [ ] **Org address.** `/o/{slug}` (on whichever host serves the staff console) pre-fills the org and sends
      `orgSlug`, so a bookmarked org address skips the choice.
- [ ] **Exercise address implies the org.** Signing in on an exercise's address takes the org from that
      exercise (design §1.2: "When staff sign in on an exercise host, the org comes from that exercise, so it
      works like a slug"). Backend: when the org-shape request has no `orgSlug` and arrives on a host that
      resolves to an exercise, use that exercise's organization. *(Not implemented today; the slugless path
      matches across every org instead.)*
- [ ] **Uniform failures.** Every refusal shows the same message ("That email and password don't match, or
      your account is locked."), whatever the cause. No message reveals whether an email or org exists.
- [ ] **Existing sign-ins keep working.** Allowlist (break-glass) logins sign in through this page, with the
      allowlist username in the email field, as the backend already accepts. The old username + secret,
      exercise-bound path stays reachable until it is retired, or this page replaces it with no loss.
- [ ] **Switching into an exercise.** From an org-scope session, the exercise switcher enters one of the
      person's own enrollments via `POST /api/staff/active-exercise`. Leaving returns them to org scope.
- [ ] Two worlds (D0 §2): COBRA components (`@/theme/styledComponents`), desktop-first, FontAwesome only, MUI 9
      `sx`-only; never confusable with a participant view.
- [ ] Accessibility (NFR-001): WCAG 2.1 AA; keyboard-operable; errors and the org list announced via a live
      region; nothing conveyed by color alone.
- [ ] Security: auth routes stay `Cache-Control: no-store` (story 26). The password field uses
      `autocomplete="current-password"`, and the email field `autocomplete="username"`.
- [ ] User guide: `docs/guide/getting-started.md` "Signing in to your organization" is updated (remove "Not yet
      on a screen"), as is `planner-guide.md` "Creating an exercise", plus the screenshot list in
      `tools/guide-screenshots`.

## Out of Scope
- The shared staff console address `console.<domain>` and its infrastructure (story 28, #836).
- Password reset and invites (stories 20 and 21).
- The timing and lockout hardening in #602 and #662 (deferred to 2027; see Dependencies).

## Technical Notes
- Frontend: `src/frontend/src/features/login/pages/StaffSignInPage.tsx` and
  `src/frontend/src/features/login/services/staffSignInService.ts`. The request and response types already
  exist (`StaffOrgSignInCredentials`, `StaffOrgChoiceResponse`, `isStaffOrgChoiceResponse`).
- Session handling already accepts org scope: `core/auth/roles.ts` `isSessionRole(scope, role)`, and
  `sessionResolver.ts`. `RoleAwareEntry` routes `orgAdmin` to Exercise Management.
- Backend: `Features/Identity/Staff/OrgStaffLoginService.cs` (`LoginAsync`, `ChooseAsync`,
  `LoginByAllowlistAsync`). The host-implied-org AC is the only backend change.
- Staff tokens are tab-scoped (`sessionStorage`), so one tab is one staff sign-in, as today.

## Dependencies
- Story 15 backend (org sign-in API): built on `main`. Story 16 (#572) and story 17 (#573): closed.
- **#602 and #662 (deferred to 2027):** their side channels stay latent while no one has a Pulse password.
  Allowlist sign-ins are not affected. They **must land before invites (#575) or password resets (#576)
  ship**, because that is when Pulse passwords appear and the timing differences become exploitable.

## Tests
- RTL: email sign-in, org-scope landing with the Create form visible, org choice (pick, expiry, reuse),
  `/o/{slug}` pre-fill, uniform error, allowlist username accepted.
- Backend: host-implied org (exercise host → its org; foreign or unknown host → unchanged slugless behaviour).
- e2e (UAT smoke): an org admin signs in on the UAT address and creates an exercise.
