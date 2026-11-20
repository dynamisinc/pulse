# orgDirectory (staff world, org admin only)

Identity-auth-roles story 19 (#574): the organization people directory at `/staff/people`.

- `GET /api/org/people` (search by name/email, paged 25), `PATCH /api/org/people/{id}`
  (`{isOrgAdmin}` or `{disabled}`), `POST /api/org/people/{id}/password-reset` (copy-link).
- Table shows name/email, org-admin / disabled / locked-out status (icon + text), enrollments
  (exercise, role, lead). Every action sits behind a confirm dialog; failures (409 `last-org-admin`,
  `cannot-disable-self`, `target-is-org-admin`, 404) show in a `role="alert"` region; the list
  refetches after every mutation. The caller's own row offers no Disable.
- **Make admin** on a person with no password is refused (409 `person-has-no-password`, #848); the
  dialog explains that they must set a password from their invite link first.
- **Invite person** (`POST /api/org/people/invite`, #575b) and the row's **Invite** action
  (`POST /api/org/people/{id}/invite {email}`, #849). The row action shows only for a person with no
  email and no password (`hasPassword` on the row) who is neither disabled nor an org admin; it
  saves the email on that person with the invite (409 `email-in-use` / `email-mismatch`), so no
  duplicate person is created. **Resend invite** (#862) reuses the same route with the stored email
  for a person with an email but no password. Once a mailer is configured the by-id route returns
  `inviteUrl: null` (emailed only); the dialog then says whether the email went out.
- Gated on `usePermissions().role === 'orgAdmin'` (no `StaffAction` was added: that table is frozen
  for this change). The server is the authority.
- COBRA only, FontAwesome only, MUI 9 `sx`. Live service only (no mock flip point).
- Registered with one entry in `features/staff/staffRouteRegistry.tsx` (`// #574`).

Layout: `services/` (axios), `hooks/` (React Query), `components/`, `pages/`, `types.ts`.

## Staff assignment (follow-up)
Enrollment exercise names render as plain text. `OrgPeopleTable` takes an optional
`renderExerciseLink` prop (TODO for the #667 merge): #667 adds the per-exercise staff link and
should pass it there. This feature imports nothing from #667 and builds no staff editor.
