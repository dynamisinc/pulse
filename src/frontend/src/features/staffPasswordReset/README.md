# staffPasswordReset

Staff set-password page for copied reset / invite links (identity-auth-roles story 21, #576).
STAFF world (COBRA). Pre-auth routes `/staff/reset#token=...` and `/staff/invite#token=...` (#575b), wired in
`app-shell/routes.tsx` beside `/staff/login` (not a post-auth registry entry).

- `pages/StaffSetPasswordPage.tsx` - the form + success / invalid-link states; `StaffInvitePage`
  is the invite-copy variant. An invite token answers 200 `{ next, orgSlug, email }`: `sign-in`
  signs straight in (`staffOrgSignIn` then `completeSignIn`, falling back to the success state on
  any failure); `awaiting-assignment` renders `components/AwaitingAssignmentPanel.tsx`.
- `resetFragment.ts` - reads the token from the URL fragment and strips it from the address bar.
- `services/passwordResetService.ts` - `POST /auth/password/reset { token, newPassword }`.

Rules: token only from the fragment, never logged, only ever in the POST body; `invalid-token`
is terminal; policy codes map through `POLICY_MESSAGES` (generic fallback). No mock seam.
