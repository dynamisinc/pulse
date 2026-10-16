# ADMIN-IDENTITY-MODEL — People, enrollments, credentials and the exercise lifecycle

**Status:** **SIGNED OFF (Tier-2, Tom, 2026-10-16) with amendments** — see §8 "Sign-off record" · **Owner:** Session A (administration) · **Date:** 2026-10-16
**Source:** [`NEXT-WAVE-SESSION-BRIEF.md`](../NEXT-WAVE-SESSION-BRIEF.md) Part B1 decisions and Part C2 "Phase A".
**Consumers:** `identity-auth-roles`, `exercise-build-golive`, `persona-management`, `exercise-lifecycle-admin`,
`easy-login`. Sessions B (tablet role guards) and C (engine schema timing) read §9.

> **How to read this.** Each of the seven hard problems in C2 gets a section that does four things: it
> states the current code (with file references), makes a **decision**, gives the reason, and lists any
> **open question for Tom**. §8 collects the five Tier-2 sign-offs in one place. §9 lists the
> contract and schema changes the orchestrator has to clear. Nothing in this doc is built yet.

---

## 0. Where we start (the current code, as mapped 10/16)

| Concern | Today | Ref |
|---|---|---|
| Tenant | `Organization` exists. `Exercise.OrganizationId` and `StaffUser.OrganizationId` are non-null. `PersonaTemplate` has the central org filter; `Exercise`/`StaffUser` are bounded with `InOrganization` plus the sweep test. | `exercise-isolation/11`, `Data/OrganizationScope.cs:50` |
| Staff identity | `StaffUser` (org-owned, `ExternalSubject`, `Username`), with **no password column**. Secrets come from the config allowlist in `DynamisIdentityProvider` (a Phase-1 stub behind `IIdentityProvider`). | `StaffLoginService.cs:74-230` |
| Staff roles | `StaffAssignment(StaffUserId, ExerciseId, Role)`, where Role is a free string. **No UI or API creates them**: only bootstrap, the org-admin seeder, and exercise creation (which copies the creator's role). | `ExerciseCreationService.cs:155` |
| Participant identity | `Account` (exercise-scoped): Username, CredentialHash (PBKDF2), PersonaId, Email, Role ∈ {participant, pio}. Four ways in: password, personal link, day word, view-only code. | `Account.cs`, `ParticipantLoginService.cs` |
| Session | One opaque bearer token, stored hashed. The `Session` row carries Kind ∈ {staff, participant, readonly}, ExerciseId (non-null), Role and PersonaId. Role is **not** a claim; it is read from the row. | `Session.cs`, `SessionPrincipal.cs:36` |
| World separation | Participant sessions must match the exercise their host resolves to (`SessionAuthenticationMiddleware.cs:93`). Staff sessions are bound to an exercise but not to a host. | |
| OrgAdmin | Only a per-exercise `StaffAssignment.Role = "orgAdmin"`, so an empty org cannot sign in (story 15). | `identity-auth-roles/15` |
| Lifecycle | `build → staged → live ⇄ paused → completed → archived`. One transition endpoint, guarded only by "assigned staff" with **no role check** (P0 #377/#481). Freeze is a pause tier, not a state. | `ExerciseLifecycleState.cs:85-94`, `LifecycleEndpoints.cs:57` |
| Duplicate / delete / reopen / reset | None exist. Demo reset is `Clear-DemoContent.ps1`, which uses **direct SQL**. | `scripts/uat/` |
| Media | Exercise-scoped `MediaAsset`. Uploads are sniffed by magic bytes. **No EXIF strip and no re-encode.** The watermark is a frontend overlay only. | `MediaUploadService.cs:222` |
| Seeding | `Seed-DemoContent.ps1` reads `pulse.demopack.v1` through public endpoints. There is **no staff persona-create endpoint**. | `docs/demo/pack/pack.json` |

---

## 1. One account, two worlds

### Decision 1.1 — `Person` is the human; enrollments are per exercise

```
Organization (+ Slug: new, unique; used in the staff console URL, §1.2)
  └── Person                    (org-owned; who the human is + their credentials)
        ├── OrgRole?            ("orgAdmin": the only org-level grant)
        ├── StaffUser           (1:1 facet sharing Person.Id; exists once the person has any staff enrollment)
        └── Enrollment*         (NEW table, replaces StaffAssignment; one row per person per exercise)
              ExerciseId, PersonId? (null = one-off participant),
              Role ∈ planner|controller|evaluator|participant|pio, PersonaId? (participant roles)
              └── Account?      (participant roles only; Account.EnrollmentId is unique. The sign-in facet:
                                 Username, CredentialHash, lockout, Email; links and day words key on it)
```

- **`Person` (new, `IOrganizationOwned`)** has these columns: `Id`, `OrganizationId`, `Email` (normalized,
  **unique per organization**, i.e. a unique index on `(OrganizationId, Email)`; nullable only for legacy rows
  during migration), `DisplayName`, `PasswordHash?`, `PasswordChangedAt?`, `FailedLoginCount`,
  `LockedOutUntil?`, `OrgRole?`, `AvatarBlobName?`, `DisabledAt?`, `CreatedAt`.
  Like `StaffUser`, it is a *resolution root* at sign-in: it is looked up by org slug and email, or by email
  across orgs, *in order to* find the tenant (§1.2). It therefore uses `InOrganization` everywhere except
  those sign-in lookups, which carry `org-scope-exempt(ResolutionRoot)` markers. The sweep test's count is
  bumped.
- **`Enrollment` (new, `IExerciseScoped`) is the one record of "this person holds this role in this
  exercise"**, for every role. *Signed off: Tom chose a real table over a logical union of the two
  existing tables.*
  - **It replaces `StaffAssignment`.** Rows are migrated with the same Ids, and the old table is dropped in the
    same migration. The org tier reads staff enrollments across exercises (`GET /api/org/staff-assignments`
    and the exercise switcher). Those reads use an explicit `IgnoreQueryFilters()` plus an `InOrganization`
    join, under a named sweep exemption (`TenantChecked`). Staff sign-in is in the same position: it runs before
    any exercise scope exists, so it picks the "most recently used enrollment" the same way.
  - **`Account` stays as the participant's *sign-in facet*** and gains `EnrollmentId` (unique, non-null after
    backfill). **`Account.Role` and `Account.PersonaId` move to `Enrollment`.** The migration creates one
    `Enrollment` per `Account`, copies those two values, then drops the old columns. Personal links, day
    words, lockout and username all still key on `Account`, so how easy-login works is unchanged. The code
    that *reads* role and persona (session minting, roster, persona binding, attribution) switches to
    `Account.Enrollment.*`.
  - **Uniqueness:** `(ExerciseId, PersonId)` is unique where `PersonId` is not null. That is the "one person,
    one role per exercise" rule, so being staff and a participant in the same exercise is impossible in the
    database itself, not only in a service.
  - **Consistency:** a staff-role enrollment must have a `PersonId` (there are no one-off staff) and no
    `Account`. A participant-role enrollment must have an `Account`. The service layer enforces this, and a
    check constraint backs it by refusing a `PersonaId` on staff roles.
  - **Accepted cost:** finished stories read the old columns: identity-auth-roles 02, 03, 05, 10 and 12, and
    easy-login 02, 03 and 05. Their readers move to `Enrollment`. Their ACs do not change, their test suites
    are the regression net, and story-agent adds an amendment note to each.
- **`StaffUser` becomes a 1:1 facet of `Person` that shares the primary key** (`StaffUser.Id == Person.Id`).
  Every existing FK (`Session.StaffUserId`, `ParticipantLink.IssuedByStaffUserId`,
  `ExerciseDayWord.SetByStaffUserId`, telemetry actor ids) stays valid, and no class is renamed while
  Sessions B and C are working in parallel. A migration backfills one `Person` per existing
  `StaffUser`, using the same Id.
- **One person may not hold a staff enrollment and a participant enrollment in the same exercise.**
  The unique index above enforces it, and the service maps the violation to 409 `conflicting-enrollment`.
  A person who is a controller on Exercise A and a participant on Exercise B is fine. Being both
  inside one exercise would break evaluation integrity and the two-worlds rule.
- **Lead controller (signed off by Tom, 2026-10-16).** `Enrollment.IsLead` (bit, default 0):
  - It is valid only on a `controller` enrollment, enforced by a check constraint.
  - There is **at most one lead per exercise**, enforced by a filtered unique index on `(ExerciseId)` where
    `IsLead = 1`.
  - Planners and org admins set it with `PUT /api/staff/enrollments/{id}/lead`. The endpoint arrives in A1;
    the UI comes with A2 story 20. Setting a new lead clears the old one in the same transaction.
  - It gates **swamped mode** (auto-send of expired timed drafts, D5 STORY-UPDATES) and the engine
    **autonomy level** write: lead controller only, every other role gets 403.
  - Like any other grant change, changing the lead revokes the affected sessions.
  - It unblocks Session C's provider flip (#571).
- **Revoking a grant revokes the sessions built on it.** `StaffCallerContext` authorizes from the persisted
  `Session.Role`, and refresh preserves that role. So revoking `OrgRole`, disabling a Person, or removing
  or changing an `Enrollment` revokes, **in the same transaction**, every live session (access and refresh)
  that was minted from that grant:
  - org-scope sessions, for an `OrgRole` revoke;
  - all of the person's sessions, for a disable;
  - sessions on that exercise, for an enrollment change.

  Tests prove that the old access token and the old refresh token both stop working. *(Copilot review 4.)*
- **The org admin grant is `Person.OrgRole = "orgAdmin"`. It is not an exercise role.** `orgAdmin` leaves the
  staff role vocabulary. Migration: every existing `orgAdmin` assignment sets the person's
  `OrgRole` and its `Enrollment` becomes `planner` on that exercise, so the person keeps the access they have today.
  To work *inside* an exercise, an org admin needs an enrollment. They can enroll themselves (audited
  `org.enrollment.self-granted`), but they never get implicit in-exercise powers. This keeps the role
  matrix (§8.2) two-dimensional and auditable.

### Decision 1.2 — a session is minted for one world, and for at most one exercise

| Session kind | Minted from | ExerciseId | Role source | Host binding |
|---|---|---|---|---|
| `participant` | an `Account` (password / link / day word) | the host's exercise | `Enrollment.Role` | must equal the host exercise (as today) |
| `readonly` | the view-only code | the host's exercise | `participant`, IsReadOnly | must equal the host exercise (as today) |
| `staff` | `Person` credentials + a staff-role `Enrollment` | the selected exercise | `Enrollment.Role` | none (as today) |
| `staff` (**org scope**) | `Person` credentials with `OrgRole = orgAdmin` and no exercise selected | **null** | `orgAdmin` | none |

- `Session.ExerciseId` becomes **nullable**, and `Session.PersonId` is added. Null means org scope. That is
  structurally different from `Guid.Empty` (the "unresolved" sentinel the write-guard refuses), which is
  exactly what story 15's AC asks for. An org-scope session is accepted by `/api/org/*`, `/api/session`,
  `/api/me/*`, **`GET /api/staff/assignments`** (the person's own enrollments) and
  **`POST /api/staff/active-exercise`**. Those last two check that the target is the caller's own enrollment
  in their own org, and a foreign or missing target gets the bare 404. Without them an org admin could never
  enter an exercise.
  Every exercise-scoped route fails closed on it, because `IExerciseContext.CurrentExerciseId` stays null and the
  existing guards already 401/403 on null.
- **Staff sign-in no longer takes an exercise. It takes an org, by URL or by choice.**
  *Signed off: email is unique per org, the org slug goes in the URL, and when there is no slug the person
  signs in with email first and then picks an org.*
  - **With a slug** (`console.<domain>/o/{slug}`, bookmarkable): `POST /api/auth/staff/login
    {orgSlug, email, password}` resolves the `Person` by `(org, email)` and verifies the password.
  - **Without a slug:** `POST /api/auth/staff/login {email, password}` verifies the password against **every**
    `Person` with that email.
    - Exactly one match verifies → that org.
    - More than one verifies → the response is `200 {choose: [{slug, orgName}], choiceToken}`, listing **only
      the orgs whose password verified**. `choiceToken` is single-use, lasts 2 minutes and is bound to those
      person ids. `POST /api/auth/staff/login/choose {choiceToken, orgSlug}` then mints the session.
    - None verifies → the uniform 401.

    Because orgs are disclosed only after the password verifies for that org, the response does not reveal
    which orgs an email belongs to. Every verify runs PBKDF2, so the per-IP limiter (#480) applies and
    the work per request is capped at 5 candidates. Candidates that are currently locked out are skipped
    without being verified.
  - **Lockout attribution, slugless sign-in.** A Person's failure counter goes up **only when the attempt
    fails as a whole**, that is, when no candidate verifies. In that case every candidate that was tried
    gets one failure. When any candidate verifies, the other candidates' counters are left alone. So five
    good sign-ins to org A never lock out the same email's Person in org B, while a guesser working through
    email-only attempts still runs into every candidate's lockout. With a slug there is exactly one
    candidate and the normal rule applies.
  - **The org-choice record** is its own table, **`LoginChoice`**: `Id`, `TokenHash` (SHA-256), `ExpiresAt`
    (2 min), `ConsumedAt?`, `CreatedFromIpHash`. Its child table **`LoginChoiceCandidate`** holds
    `(ChoiceId, PersonId, OrganizationId)`, one row per password-verified Person. Neither table is scoped;
    `LoginChoice` is a resolution root looked up by hash.
    - `POST /api/auth/staff/login/choose {choiceToken, orgSlug}` mints a session only when the slug matches
      a candidate row.
    - It consumes the **whole** choice, in one statement guarded by `ConsumedAt IS NULL`, so a token can
      never be used for a second org.
    - It changes no credential. `CredentialToken` is not involved, and its purposes stay
      `invite|reset`.
  - **What the session is minted on:** an org-scope session if the person is an org admin, otherwise their
    most recently used staff enrollment in that org. With neither, the response is the uniform 401.
  - **Switching:** the existing `POST /api/staff/active-exercise` switches between the person's enrollments
    in the same org, and into or out of org scope for org admins. **It only ever selects a staff-role
    `Enrollment`, never one with an `Account`**, so a staff session cannot cross into the participant world,
    and it never crosses orgs: changing org means signing in again.
  - **Participants are unaffected:** the exercise host implies the org, so `(ExerciseId, Username)` and
    `(org, email)` are unambiguous.
- **Participant sign-in is unchanged in shape.** The host resolves the exercise (`HostExerciseResolver`),
  and the credential resolves an `Account` *in that exercise*. Sign-in is by username, or by email, which
  is matched to the `Person` with that email in the exercise's org and then to that person's `Enrollment`
  in this exercise. A person with only staff enrollments who
  tries the participant sign-in gets the same uniform 401 as a wrong password.
- **The same credentials work in both worlds** (B1 "one account, separate entry"). The password hash lives on
  `Person`, so both sign-in services verify against it whenever `Enrollment.PersonId` is set (§3).
- **One world per browser origin, across tabs too.** Clearing the other world's token store on sign-in
  (`tokenStore.ts:335-351` already does this) is not enough. Staff tokens live in each tab's own
  `sessionStorage`, so a participant sign-in in tab B cannot clear tab A, and `crossTabSessionSync.ts:86`
  ignores storage changes in staff tabs. So the rule is enforced in two places:
  1. **A cross-tab world-switch broadcast.** A sign-in posts `{world, at}` on a `BroadcastChannel('pulse-world')`
     (with a `storage`-event fallback). Every tab of the *other* world on that origin signs itself out
     (`POST /api/auth/logout`) and lands on its sign-in page.
  2. **A server backstop.** When a session is minted for person P in world W, P's live sessions of the other
     world that were minted **from the same origin** (a new `Session.Origin` column, set from the request
     `Origin` header) are revoked.

  Separate origins (the staff console host and the per-exercise participant hosts) can legitimately hold one
  world each, which is the normal case.
- **Staff console host.** An org-scope session has no exercise host to land on (story 15's frontend gap).
  **Decision (signed off):** one platform staff host (`console.<platform-domain>`, set by the config value
  `StaffConsole:Host`) serves the staff console for every org, with `/o/{slug}` for each org. **Per-exercise
  hosts keep serving staff routes for now**, for backward compatibility. Retiring them is a later decision.
  When staff sign in on an exercise host, the org comes from that exercise, so it works like a slug.

### Decision 1.3 — the Dynamis IdP stub stays as break-glass

`IIdentityProvider` gets a second implementation, `PulsePasswordIdentityProvider` (Person email + hash),
which becomes the default. The config-allowlist `DynamisIdentityProvider` stays as an **ops-only
break-glass** for Dynamis staff and is disabled by config in customer deployments. Entra/SSO stays a future
provider behind the same seam (COR-014 unchanged).

**Interim between A1 and A2.** A1 ships the `Person` password and lockout columns and the Pulse provider, but
invites and resets (`CredentialToken`) arrive in A2. So in A1 the providers are **chained**:
1. If the `Person` has a `PasswordHash`, the Pulse provider is authoritative and there is no fallback.
2. Otherwise, the Dynamis allowlist is tried, keyed on `StaffUser.ExternalSubject`, so every backfilled legacy
   staff member signs in exactly as they do today.

A2's invite flow then gives legacy staff a Pulse password, after which step 2 no longer applies to them.
Customer deployments turn the fallback off once everyone has been invited. New orgs (`POST /api/ops/organizations`,
which sends an invite) therefore land in **A2**; in A1, org admins come from the existing org-admin seeder.

---

## 2. Directory people vs one-off participants

### Decision 2.1 — a one-off participant is an `Account` with no `Person`

- **Directory person:** a `Person` row. They carry across exercises and have org-level credentials.
- **One-off participant:** an `Enrollment` with `PersonId = null` (and its `Account`). They exist only inside that exercise, sign in only
  with that exercise's methods, and are deleted with it. This is exactly today's easy-login roster row,
  so nothing about it changes.
- **Why not an `ExerciseOnly` flag on `Person`?** It would put throwaway people into the org directory,
  and the directory UI would need a filter everywhere. A null `Enrollment.PersonId` states the same fact
  with no new state.

### Decision 2.2 — reconciliation is by email only, and is never silent

- **Roster CSV import** (`/api/staff/roster/import`). For each row:
  - The email matches a `Person` in the exercise's org → the `Enrollment` is created linked (`PersonId` set).
    Its password is the person's; a CSV password column is ignored and reported.
  - Otherwise → a one-off `Account` (as today).
  - A new per-import option, **"Add new people to the org directory"** (default off), creates `Person` rows for
    unmatched rows that have an email, and queues an invite email (§3).
  - Matching is case-insensitive on normalized email. It **never** matches on name or sign-in name.
  - The import preview (it already exists) shows each row as `linked`, `new one-off` or `new directory person`
    before commit.
- **Promote a one-off to the directory:** a roster action that needs an email. If a `Person` with that email
  already exists in the org, the action links to it; otherwise it creates the `Person`. The account's existing
  link, day-word sign-in name and persona binding are kept. If the one-off had a password
  (`Account.CredentialHash`), it is **not** carried over; the person gets an invite to set an org password.
  Only `Person` rows **in the exercise's own org** are ever matched. The same email in another org is a
  different person and is never linked: nothing links across tenants.
- **Participants added from the directory:** the planner picks people from the directory and assigns each a
  role (participant or pio) and a persona (existing, or auto-created citizen as today). This creates linked
  `Enrollment` + `Account` rows.
- **Email is unique per org** (signed off). One consultant who works for two customer orgs is two `Person`
  rows with the same email, one in each org. They are separate people as far as Pulse is concerned, with
  separate passwords.

---

## 3. Credentials

### Decision 3.1 — hashing
Use ASP.NET Core `PasswordHasher<Person>` (PBKDF2-HMAC-SHA512, Identity V3 format, 100k iterations) with
automatic rehash on successful verify. This is the same primitive `ParticipantPasswordHasher` and
`SharedCredentialHasher` already use. Nothing new is added to the dependency or crypto surface.

### Decision 3.2 — password policy (NIST SP 800-63B), Tier-2 sign-off §8.3

| Rule | Staff / org admin (any person with a staff enrollment or OrgRole) | Participant-only person and one-off account |
|---|---|---|
| Minimum length | **12** | **8** |
| Maximum length | 128 | 128 |
| Composition rules | none (800-63B §5.1.1.2) | none |
| Blocklist | embedded top-10k common passwords, plus the org name, email local-part and display name | same |
| Breach check (HIBP k-anonymity) | deferred: needs network egress and Key Vault (#490) first | deferred |
| Expiry | none (rotation only on compromise) | none |
| Lockout | 5 failures → 15 min, doubling to a 4 h cap; per Person/Account, **plus** the existing per-IP limiter (which needs **#480**) | same, reusing the `Account.FailedLoginCount` pattern |
| MFA | not in this wave; TOTP for org admins is a named follow-up | n/a |

If a person is promoted from participant-only to staff, their current password stays valid until they next
change it, but the stronger minimum applies from then on. Forcing a change would lock someone out
mid-exercise.

### Decision 3.3 — one-time tokens for invite and reset
- **New `CredentialToken` table** (not scoped; it is a resolution root, looked up by hash like
  `ParticipantLink`): `Id`, `TokenHash` (SHA-256), `Purpose ∈ invite|reset`, `PersonId?` / `AccountId?`
  (exactly one is set), `OrganizationId`, `ExpiresAt`, `UsedAt?`, `IssuedByPersonId?`, `CreatedAt`.
  - Lifetime: invite 7 days, reset 60 min.
  - Single use. Issuing a new token voids the earlier unused tokens of the same purpose.
  - Using a token sets the password, **revokes every live session for that person or account**, and emits
    `identity.credential.changed`.
- **Staff "forgot password":** `POST /api/auth/password/forgot {email, orgSlug?}` is pre-auth and allowlisted.
  Without a slug, **one** email goes to the address, with one reset link per org where that email has a
  `Person`. The response is the same 202 whatever the case, so nothing is revealed to the requester.
  - It **always returns 202**, with the same body and similar timing whether or not the email exists.
  - It is rate-limited per email hash and per IP.
  - It sends a link to `https://<staff-console-host>/reset#token=…`. The token goes in the fragment so it never
    reaches server logs.
  - `POST /api/auth/password/reset {token, newPassword}` completes the reset.
  - Both routes send `Cache-Control: no-store` (#485).
- **Participant "forgot password":** the same two routes, sent from the exercise host. The link lands on that
  exercise host's participant reset page, inside the participant skin (no COBRA). It is available only if
  the exercise allows the password method (3.4) and the person or account has an email.
- **Admin reset:** in the staff world, an org admin resets staff; a planner or controller resets
  participants in their exercise.
  - The action **emails a reset link**. Staff never see or choose another person's password.
  - For participants **with no email**, the planner can instead mint a **one-time temporary password**. It is
    shown once, works for a single sign-in, and forces a change on first use. This fits the card-sheet
    workflow.
- **Participant reissue** (links and day word) is unchanged: easy-login 03/05 and the existing
  reissue/revoke routes.
- **Email** goes through the existing ACS path. `AcsParticipantLinkMailer` is generalized to an
  `IPulseMailer` with one template per purpose (link, invite, reset). Templates show the
  **participant-facing exercise name** (§8.4) and never the internal one (#376).

### Decision 3.4 — which sign-in methods each exercise allows
New exercise setting, **`SignInMethods`** (flags): `PersonalLink | DayWord | Password`.
- **Default: all three.** The planner can switch any off. At least one participant method must stay on
  whenever participant accounts exist; this is a readiness item.
- The view-only code (`SharedCredential`) is a separate switch and is unchanged (COR-015/016).
- When `Password` is off, `POST /api/auth/login` for that exercise returns the uniform 401.
  Forgot-password from that host returns 202 and sends nothing, so the response does not reveal the setting.

---

## 4. Avatars

### Decision 4.1 — a participant's avatar is their persona's avatar, so it is per exercise
- The in-fiction profile already lives on `Persona.AvatarMediaId` (an exercise-scoped `MediaAsset`).
  **No new participant avatar column is added.** One person playing different personas in different exercises
  therefore has different avatars, as C2 requires.
- **Self-upload:** `PUT /api/me/avatar` (multipart; participant session).
  - It goes through `MediaUploadService` and accepts **images only**.
  - It sets `AvatarMediaId` on **the caller's own bound persona** only when that persona is personal: it is the
    `PersonaAutoCreated` citizen persona, or a persona bound to exactly one account.
  - Org personas, shared personas and cast personas are refused with 403, so a participant cannot restyle
    `@CityOfFairhaven`.
  - Rate-limited with the existing `media-upload` limiter.
- **Staff set from the roster:** `PUT /api/staff/roster/{accountId}/avatar` (planner or controller) does the same
  thing on behalf of the participant.
- **Moderation:** a participant-uploaded asset is tagged `UploadedByAccountId`. It shows in the controller's
  media library under a "Participant uploads" filter. A controller can **revert to the default avatar**,
  which is audited. This keeps the fiction safe without blocking participants.
- **The pipeline gap must close first: images need re-encoding and EXIF stripping.** Phone photos carry GPS
  EXIF, and today the file is stored byte-for-byte. Avatar uploads (and, by the same change, all image
  uploads) are decoded and re-encoded to WebP, capped at 1024 px on the long edge for avatars, with metadata
  dropped. **Library (signed off): SkiaSharp** (MIT), with the `SkiaSharp.NativeAssets.Linux.NoDependencies`
  package for App Service Linux. ImageSharp was rejected because it needs a commercial licence; Magick.NET
  because it is heavy.
- **Watermark:** avatars render at 32–96 px, so they get **no** EXERCISE band. The NFR-008 slot is for
  high-risk templates and full media, and the frontend `ExerciseBands` is not mounted on avatars today. This
  is recorded here so a reviewer does not flag it.

### Decision 4.2 — staff avatars live in the staff world only
- They are stored on `Person.AvatarBlobName`, under the blob prefix `org/{orgId}/people/{personId}.webp`. That
  prefix is outside every exercise prefix, so `MediaScopeGuard` can never serve it to a participant.
- They are served only through `GET /api/org/people/{id}/avatar` and `/api/me/staff-avatar` (staff sessions only).
- **They are never projected onto any participant DTO.** The XC-002 projection test is extended with a
  "no staff avatar field" assertion.
- A staff member who is also a participant elsewhere uses their *persona* avatar there. The staff avatar
  never appears in the fiction.

---

## 5. Lifecycle

### Decision 5.1 — the state machine (additions in bold)

```
            stage (planner, readiness green)          StartEx (controller)
   build ───────────────────────────────▶ staged ─────────────────────────▶ live ⇄ paused (controller)
     ▲  ◀─────────── **unstage** (planner) ──┘                                │
     │                                                                      EndEx (controller)
     │                                                                        ▼
     └──────── **reset** (planner|orgAdmin) ◀── staged | completed ──────────── completed ──archive──▶ archived
                                                **reopen** (controller) ──▶ live      ◀──**unarchive** (orgAdmin)──┘
   **delete** (planner|orgAdmin): build only, never ran (FirstLiveAt null)
   **archive** also from build when FirstLiveAt is set (ran before, then reset): the retirement path
   **duplicate** (planner of the source|orgAdmin): any state → new exercise in build
```

Freeze stays a pause tier (controller), not a state. A5 adds that Freeze and pause refuse participant writes (#379).

### Decision 5.2 — what each new transition means

| Transition | From → To | Keeps | Wipes | Guard |
|---|---|---|---|---|
| **Stage** | build → staged | everything | nothing | planner; readiness has no blocking item (§5.3) |
| **Unstage** | staged → build | everything | nothing | planner; for fixing setup found during the dry run |
| **StartEx** | staged → live | everything | nothing | **controller**; sets `Exercise.FirstLiveAt` if null |
| **EndEx** | live/paused → completed | everything | nothing | **controller**; closes the hub and stops the reaction loop (A5 #375) |
| **Reopen** | completed → live | everything; the scenario clock resumes where it stopped | nothing | **controller**; refused once archived. For "we ended by mistake". Audited |
| **Archive** | completed → archived, **or build → archived when `FirstLiveAt` is set** (a reset exercise being retired) | everything (read-only) | live sessions revoked | planner or org admin |
| **Unarchive** | archived → completed (or → build if it was archived from build) | everything | nothing | org admin only |
| **Reset** | completed **or staged** → build | settings, chrome, sign-in methods, personas (with any live edits), staff library media, run sheet (all items back to *pending*), noise pool, **setup posts** (§5.4), accounts, enrollments, links, view-only code | **conduct data**: conduct posts and their edits, reactions, reposts, `PostMediaItem` rows and **participant-uploaded media** on them, conduct follows (`Follow.IsSetupContent = false`, §5.4), telemetry events, engine review items, inject queue state, runtime state (clock, pause tier), day words, every session | planner or org admin; typed-name confirmation. **The UI offers the AAR/report export first** (from completed). Refused in build, live, paused and archived |
| **Delete** | build → (gone) | — | the exercise and every exercise-scoped row and blob; the hostname is freed | planner or org admin; **only if `FirstLiveAt` is null** (never ran). An exercise that ran and was reset is retired by **archive from build** |
| **Duplicate** | any → new build exercise | see 5.5 | — | planner on the source, or org admin |

- **Reset hard-deletes.** It does not version or run-number the conduct data. Keeping several runs in one
  exercise would push a "which run" dimension into every evaluator query. **To keep a run, don't reset that
  exercise.** Duplicate it and conduct the next run in the copy. The source, with its run, stays as it is
  (and can be archived). Duplicating does not copy conduct data, so duplicating and *then* resetting the
  source still destroys the run. The reset confirmation dialog says this. *(Signed off §8.5.)*
- **Reset from staged** (signed off) clears a dry run: the posts, reactions, telemetry, sessions and day
  words created while the exercise was staged. It keeps everything authored in build. This works because
  `IsSetupContent` is stamped only in **build** (§5.4). Planners who need to add setup content after staging
  **unstage** first.
- Reset and delete run as **one service transaction through `PulseDbContext`**, with the exercise filter
  scoping every delete, plus an outbox step for blob deletes. They replace `Clear-DemoContent.ps1`'s direct
  SQL. The script is then reduced to a wrapper around the reset endpoint.
- Every transition emits `exercise.lifecycle.transitioned` (as today) with the actor's PersonId and role.

### Decision 5.3 — readiness checklist (exercise-build-golive/03)
Blocking items (stage is refused with 409 and the list):
1. At least one controller enrollment.
2. A participant-facing name is set (§8.4).
3. At least one participant `Account`, **or** the view-only code is enabled.
4. Every participant account is bound to a persona.
5. At least one participant sign-in method is on (3.4), if participant accounts exist.
6. The time zone and scenario start time are set.
7. Chrome and watermark are valid (`ComplianceChromeGuard`).
8. No run-sheet item is `needs-repair` (§5.4a).

Warnings (shown, not blocking): no run sheet items; no opening feed; empty noise pool; personas missing avatars;
participants with no sign-in yet issued; no evaluator enrolled.

### Decision 5.4 — setup vs conduct posts
`Post` gets **`IsSetupContent`** (bool, stamped server-side by the write path when the exercise is in
**`build`**). Reset keeps setup posts (the opening feed, pre-exercise history) and deletes every other post.
Posts written in `staged` (dry runs) count as conduct, which is what makes reset from staged useful (§5.2).

**`Follow` gets the same flag.** `Follow.IsSetupContent` is stamped by the same rule: true only when the
exercise is in `build`. `FirstLiveAt` cannot separate setup follows from conduct ones, because it is null
during the first staged dry run and stays set across a reset. Reset deletes conduct follows, and duplicate
copies only setup follows.

**Backfill for existing rows** (in the A3 migration, applied to both `Posts` and `Follows`):
- **Exercise currently in `build`:** every row is setup.
- **Otherwise:** a row is setup when its `CreatedWallClock` is earlier than the exercise's first
  `exercise.lifecycle.transitioned` telemetry event out of `build` (to staged, or straight to live for
  legacy rows). If there is no such event, the row is conduct, which fails safe: reset deletes it and
  duplicate does not copy it.
- **Posts only:** a post whose `Origin` is `participant` is always conduct. Today nothing distinguishes them. `Origin` describes who posted, not when. Inferring from
`CreatedWallClock < FirstLiveAt` breaks after a reopen or a reset, so the flag is explicit.

### Decision 5.4b — dependencies that survive reset (Copilot review 3)
- **Media that is still referenced survives.** *(Copilot review 4 replaced the earlier "clear persona
  references" rule.)* Reset deletes a participant-uploaded `MediaAsset` (row and blob) **only when no
  retained row references it**. Retained rows are:
  - a setup post's `PostMediaItem`;
  - a persona's `AvatarMediaId` or `BannerMediaId`;
  - a run-sheet item's media.

  An asset still referenced by any of these is kept, untouched. This covers two cases:
  - Staff unstaged after a dry run and reused a participant's image in a setup post.
  - A persona's avatar points at the image.

  Every one of those FKs is `DeleteBehavior.Restrict`, so the check-then-delete runs in the reset
  transaction, which makes it race-free. The reset preview lists the assets it keeps and why. Avatars a
  participant uploaded through `/api/me/avatar` are persona configuration and are always kept.
- **Setup replies to conduct posts.** Here is how one can arise: a dry-run post in staged, then unstage,
  then a staff reply in build. Two rules handle it:
  1. **Prevention at the source.** A post written in build may not reply to a conduct post. The write path
     refuses it with 409 `reply-to-conduct`.
  2. **Cleanup for rows that already exist.** Reset treats any post whose parent chain contains a conduct
     post as conduct too, and deletes deepest-first (the `ParentPostId` FK is Restrict). The reset preview
     lists these posts. Duplicate copies a setup post only if its whole parent chain is setup.

### Decision 5.4a — run-sheet items that reply to posts
An `InjectItemPost.ReplyToPostId` can target a published post. `ReplyParentResolver` refuses a missing or
foreign-exercise parent when the inject fires, so both reset and duplicate must handle these explicitly:
- **Reset:** an item whose reply target is a deleted conduct post is set to **`needs-repair`**, not `pending`.
  It cannot fire. It shows on the run sheet with "reply target removed by reset", and the planner re-points
  it or turns it into a top-level post. Targets that are setup posts survive, so those items go back to
  `pending`.
- **Duplicate:** reply targets that are setup posts are **remapped** to the copied posts, because setup posts
  are copied (§5.5). Targets that are conduct posts have no copy, so those items arrive as `needs-repair`.
- **Readiness:** any `needs-repair` item is a **blocking** readiness item (§5.3), so stage is refused until
  it is fixed.

### Decision 5.5 — duplicate
- **Copied, with new ids and every cross-reference remapped:**
  - settings, chrome and sign-in methods;
  - personas, with avatar and banner media remapped. An avatar or banner that points at a
    **participant-uploaded** asset (which is not copied) is **cleared to the default** on the copy;
  - staff library media (blobs server-side copied into the new prefix);
  - the run sheet, all items pending except reply items that need repair (§5.4a);
  - the noise pool;
  - **setup** follows (`IsSetupContent`) between the copied personas, never conduct follows;
  - **staff enrollments** (default on, so the team is carried over);
  - **setup posts** (`IsSetupContent`: the opening feed and pre-exercise history), with their media, pins
    and baselines remapped. *Signed off: this amends C2's "never posts" to "never conduct posts".*
- **Never copied:**
  - conduct posts (anything not `IsSetupContent`);
  - participant accounts, links, day words and sessions;
  - telemetry and conduct data;
  - participant-uploaded media.
- **Optional:** "copy participant roster" re-creates **directory-linked** accounts with their persona bindings and
  no links. One-off accounts are not copied.
- **New:** a hostname, a view-only code (generated, disabled), and the name "Copy of X". State: build.

---

## 6. Content seeding in the app

### Decision 6.1 — a planner uploads the existing pack format
- **Format:** `pulse.demopack.v1` (today's `docs/demo/pack/pack.json` plus a media folder), uploaded as one zip.
  It contains personas, media, the opening feed, pins, the run sheet and the noise pool. Size cap 200 MB.
  The ingest is streamed.
- **Flow:**
  1. `POST /api/staff/content-packs` (planner, exercise in **build** only, so pack posts are always setup content;
     to add content to a staged exercise, unstage it first; content lock, build-golive/05).
     The pack is stored and **validated** with a dry-run report: counts, unknown handles, missing media, schema
     errors. Nothing is written yet.
  2. `POST /api/staff/content-packs/{id}/apply` runs the import as a background job.
  3. `GET .../{id}` returns its progress and results.
  4. The planner sees the report before confirming the apply.
- **Through the services, never the database.** A `ContentPackApplier` calls the same application services
  the endpoints use:
  - `MediaUploadService` (including the new re-encode);
  - persona create/edit (**the create service is new in A4**; there is none today);
  - the post ingest path with `backdate` and baselines (these posts become `IsSetupContent`);
  - pin;
  - `InjectQueueService`;
  - the noise-pool service.

  This is the C# port of `Seed-DemoContent.ps1`'s step order, and it carries the same idempotency.
- **Idempotency:** a new exercise-scoped table **`ContentPackItem`** (`ExerciseId`, `PackId`, `ItemKey`,
  `EntityType`, `EntityId`) replaces the script's local manifest file. Re-applying the same pack updates in
  place and never duplicates.
- **Scripts:** `Seed-DemoContent.ps1` becomes a thin client that zips and uploads, so UAT uses the same path
  customers do.

---

## 7. Multi-tenant from day one

1. **Route families:**
   - `/api/org/*`: org scope. The caller's `OrganizationContext` comes from `Person.OrganizationId`. It is used
     for people, org admins, exercise create/list/duplicate/delete/archive/unarchive, and staff enrollment
     across exercises.
   - `/api/staff/*`: exercise scope from the session, as today.
   - `/api/me/*`: the caller only.
2. **Every id taken from a route or a body is bounded:** `InOrganization(orgId)` for `Person`/`Exercise`, and the
   central exercise filter for scoped entities. **A cross-org id returns the same bare 404 as a missing id.**
   This is the pattern `ExerciseManagementService.cs:306` uses. The C2 brief calls it "DF-22", but DF-22 in
   the code is MSEL import ordering, so this doc calls it **the bare-404 pattern** to avoid confusion.
3. **Tests per new route:**
   - Every id-taking org route is added to the method+path allow-list
     (`CompositionRootWiringTests.TheOrgTierRoutes_TakeOnlyAllowListedExerciseIds`), extended to `personId`
     routes.
   - Each is paired with a foreign-org case.
   - Each exercise route gets a foreign-exercise case (C5).
4. **New entities and their tier:**
   - `Person`: `IOrganizationOwned` (resolution root).
   - `OrgAuditEvent`: `IOrganizationScoped` (central filter).
   - `Enrollment`: `IExerciseScoped` (central filter). Cross-exercise org reads are `TenantChecked`.
   - `CredentialToken`: unscoped resolution root, carrying `OrganizationId` and checked on redemption.
   - `ContentPackItem`, plus a `ContentPack` upload record: `IExerciseScoped`.
   - Staff avatar blobs: under an org prefix.
5. **Audit without an exercise.** `TelemetryEvent.ExerciseId` is non-nullable (and the write-guard refuses
   `Guid.Empty`), so org-scope sign-ins and org-admin actions cannot go there. They go to a new
   **`OrgAuditEvent`** table (`IOrganizationScoped`, so it gets the central org filter):
   - Columns: `Id`, `OrganizationId`, `Kind`, `Outcome`, `ActorPersonId?`, `SubjectPersonId?`, `ExerciseId?`,
     `Payload` (JSON), `OccurredAt`.
   - It records: org-scope sign-in success and refusal, org choice, enrollment grant and revoke (including
     self-grant), people create/disable, org admin grant, password reset issuance, and the exercise
     create/delete/duplicate/archive done from org scope.
   - Exercise-scoped sign-ins and actions stay in `TelemetryEvent` (XC-004), unchanged.
   - A sign-in attempt with **no resolvable org** (unknown email and no slug) has no tenant to belong to. It
     goes only to the structured application log (App Insights), and the per-IP limiter still counts it.
6. **Platform provisioning:** `POST /api/ops/organizations {name, adminEmail}`, gated by the bootstrap secret,
   creates the org and its first org admin `Person` and sends an invite. This is the only thing Dynamis does
   (B1 "org-admin self-service"). `bootstrap-exercise` stays non-production only.

---

## 8. Tier-2 sign-offs — record (Tom, 2026-10-16, interviewed in session)

| # | Item | Outcome |
|---|---|---|
| 8.1 | Identity model | **Approved with amendment:** a real `Enrollment` table replaces `StaffAssignment`; `Account` stays as the participant sign-in facet, hanging off `Enrollment`. One person, one role per exercise |
| 8.2 | Role matrix | **Approved:** create exercise is org admin only; settings are planner only; the view-only code is planner + controller (evaluators refused); stage is planner; archive is planner or org admin |
| 8.3 | Password policy | **Approved as written** |
| 8.4 | Participant-facing name | **Approved:** no fallback; the brand header stands alone |
| 8.5 | Reset semantics | **Approved with amendment:** reset is also allowed from **staged** |
| Q1 | Staff host | **Approved:** one platform console host; per-exercise staff entry is kept for now |
| Q2 | Email scope | **Per org** (not the recommended platform-wide). Org slug in the URL; with no slug, email first and then pick an org (§1.2) |
| Q3 | Image library | **SkiaSharp** |
| Q4 | Duplicate setup posts | **Copy setup posts only** (amends C2) |

### 8.1 This identity model
Sections 1–7: `Person` with a shared-key `StaffUser` facet; the `Enrollment` table (for every role, replacing
`StaffAssignment`) with `Account` as the participant sign-in facet; the org admin as `Person.OrgRole`;
email unique per org with the org slug; a nullable `Session.ExerciseId` for org scope; one world per session
and per origin; one-offs as an `Enrollment` with no `PersonId`.

### 8.2 The role matrix (proved by a route × role matrix test in A1)
Key: ✅ allowed · — refused (403; 404 where the bare-404 pattern applies) · *(L)* lifecycle-gated as well.

| Capability | orgAdmin (org scope) | planner | controller | evaluator | participant / pio | readonly |
|---|---|---|---|---|---|---|
| People directory, org admin grants, staff password reset | ✅ | — | — | — | — | — |
| Create exercise | ✅ | — **(change: today planner and controller can)** | — | — | — | — |
| Rename; archive; reset; delete *(L)* | ✅ | ✅ | — | — | — | — |
| Unarchive | ✅ | — | — | — | — | — |
| Duplicate | ✅ | ✅ (source) | — | — | — | — |
| Assign staff to an exercise | ✅ | ✅ (own exercise; cannot remove the last planner) | — | — | — | — |
| Settings, chrome, practice mode, sign-in methods | via enrollment | ✅ | — **(change: today any staff)** | — | — | — |
| Stage, unstage *(L)* | via enrollment | ✅ | — | — | — | — |
| **Swamped mode, engine autonomy level** | via enrollment | — | **lead controller only** | — | — | — |
| StartEx, pause/resume, EndEx, reopen, Freeze/pause tiers *(L)* | via enrollment | — | ✅ | — | — | — |
| Roster: import, links, day word, email, participant reset/reissue, avatars | via enrollment | ✅ | ✅ | — | — | — |
| View-only code rotate/revoke | via enrollment | ✅ | ✅ | — **(change: today any staff)** | — | — |
| Personas: create, edit, archive | via enrollment | ✅ | ✅ | — | — | — |
| Content pack upload/apply *(L: build)* | via enrollment | ✅ | — | — | — | — |
| Run sheet edit | via enrollment | ✅ | ✅ | — | — | — |
| Fire injects, post as persona, takedown, pin, noise, steering, engine review | via enrollment | — | ✅ | — | — | — |
| Read everything in the exercise (console, feeds, report) | via enrollment | ✅ | ✅ | ✅ | — | — |
| Sim writes (post, reply, react, follow, own avatar) *(L: live **or staged** (dry run); refused when paused or frozen)* | — | — | — | — | ✅ | — |
| Read the fiction | — | — | — | — | ✅ | ✅ |

"Via enrollment" means the org admin enrolls themselves (audited) and then holds that role's row.
Evaluators are refused **every** write (#61), including future annotations until track 5 adds an
evaluator-only annotation route.

**Recorded decision (#481), signed off:** **stage** = planner. **Archive** = planner or org admin. StartEx and
EndEx stay controller-only. The narrowings on create exercise, settings and the view-only code are signed off.

### 8.3 Password policy
§3.2. Staff 12 characters, participants 8, no composition rules, blocklist, progressive lockout, no expiry,
MFA deferred.

### 8.4 Participant-facing exercise name (#180 → #376)
- New `Exercise.ParticipantName` (nullable, ≤ 80 characters).
- `ExerciseScopeDto.exerciseName` projects **`ParticipantName`**, and **never** falls back to the internal `Name`.
  If it is not set, participants see **no exercise name** (the brand header stands alone).
- It is a **blocking** readiness item (§5.3).
- Cards, emails and the join page use the same projection.
- Signed off: no fallback. The internal name can leak the scenario (e.g. "HURREX-26 Cat 4 Landfall Dry Run").

### 8.5 Reset semantics
§5.2 and §5.4. Hard delete of conduct data; setup posts, configuration and people kept; result state `build`;
the report export offered first; from `completed` **or `staged`**; planner or org admin; typed confirmation.

---

## 9. Changes the orchestrator must clear

| Kind | Item | Wave |
|---|---|---|
| **EF migration** | `AdminIdentityFoundation`:<br>• `People` table, with a backfill of one per `StaffUser` (same Id; legacy rows have a null Email until invited)<br>• `StaffUsers.Id` FK → `People.Id`<br>• `Organizations.Slug` (unique; backfilled from Name)<br>• **`Enrollments` table**: StaffAssignment rows migrated with the same Id, plus one per `Account` (Role and PersonaId copied); then **`StaffAssignments` is dropped** and **`Accounts.Role`/`Accounts.PersonaId` are dropped**<br>• `Accounts.EnrollmentId` (unique, non-null after backfill)<br>• `Sessions.PersonId`, **`Sessions.ExerciseId` nullable**<br>• `People.OrgRole`, with orgAdmin enrollments backfilled → planner + OrgRole<br>• `People` password and lockout columns (`PasswordHash`, `PasswordChangedAt`, `FailedLoginCount`, `LockedOutUntil`)<br>• `Enrollments.IsLead` (check: controller only; filtered unique index, one lead per exercise)<br>• `Sessions.Origin` (the cross-tab world backstop)<br>• `LoginChoices` + `LoginChoiceCandidates` (slugless org choice)<br>• **`OrgAuditEvents` table**<br>• `Exercises.FirstLiveAt` (backfilled from lifecycle telemetry where the status is past `staged`)<br>Hand-written SQL in `EXEC`, per OPERATE.md; reversible `Down` | A1 |
| EF migration | `CredentialToken`; `People.AvatarBlobName`; `Exercises.SignInMethods`; `MediaAssets.UploadedByAccountId` | A2 |
| EF migration | `Posts.IsSetupContent`, `Follows.IsSetupContent` (with the §5.4 backfill); `Exercises.ParticipantName` | A3 |
| EF migration | `ContentPack`, `ContentPackItem`; persona archive column | A4 |
| **Frozen shared type** | `Session` (frontend `sessionResolver.ts:47`) / `SessionDto`:<br>• `exerciseId` becomes nullable<br>• adds `personId`, `world: 'staff'\|'participant'` and **`scope: 'exercise'\|'org'`**<br>• `role` becomes `ExerciseRole \| 'orgAdmin'`, as a **discriminated union**: `'orgAdmin'` is valid only with `scope: 'org'`, and an `ExerciseRole` only with `scope: 'exercise'`<br>• a runtime validator `isSessionRole(scope, role)` replaces `isExerciseRole` at `sessionResolver.ts:114`, with tests that both variants pass and mixed combinations are rejected<br>`ExerciseRole` (`roles.ts`): `orgAdmin` leaves the exercise-role union (it becomes an `OrgRole`).<br>`StaffAssignment` (`features/staff/types.ts:36`) becomes `Enrollment`, with the same fields plus `personId`.<br>The staff login request takes `orgSlug?` + `email` instead of `exerciseId` + `username`.<br>Posted on the feature issue per C1.4 **before** A1 merges | A1 |
| Frozen shared type | `ExerciseScopeDto.exerciseName` becomes **`string \| null`** (C# `string?`), sourced from `ParticipantName`. **This changes the shape:** the frontend `ExerciseScope` type and the validator at `exerciseContextResolver.ts:205` must accept null, and every consumer (the header, cards, emails, the join page) renders brand-only. A null-name resolver test is required | A3 |
| **Program.cs** | the `PulsePasswordIdentityProvider` registration; forwarded headers (**#480**) placed before the rate limiter; new route-group maps (one line per feature), in the end-of-wave wiring commit | A1, then each wave |
| **App.tsx / staffRouteRegistry.tsx** | org console routes (people, exercise list), reset page, readiness; additive lines in the wiring commit | A2, A3 |

**Session B:** `ExerciseRole` loses `orgAdmin` in A1. The controller tablet layout is unaffected; the evaluator
layout waits for A1, as C1.5 already says.
**Session C:** no engine schema change before A1's migration is on main. EndEx/hub gating (#375) lands
in A5 and touches `ReactionLoopHost`, so C should coordinate on that file.

---

## 10. Wave cut (refines C2 Phase B; story-agent amends and adds after sign-off)

| Wave | Contents | Existing stories amended | New stories |
|---|---|---|---|
| **A1 Foundation** | `Person` (with password columns; chained provider, §1.3) + facet + `OrgAuditEvent` + cross-tab world rule + **`Enrollment` (replaces `StaffAssignment`; `Account` re-homed)** + org slug + `Session` changes + org-scope sign-in with slug or org choice (story 15) + `PulsePasswordIdentityProvider`; per-route and per-transition role checks (#377/#481/#61); the route × role matrix test; #480 forwarded headers | identity-auth-roles 01, 04, 05, 15; amendment notes on 02, 03, 10, 12 and easy-login 02, 03, 05 (readers move to `Enrollment`); exercise-lifecycle-admin 03; exercise-isolation 05 (switcher) | `16-person-and-enrollments`, `17-role-matrix-enforcement`, `18-forwarded-headers` |
| **A2 People** | `POST /api/ops/organizations` (org + first admin invite); org directory UI; staff invite and assignment; admin and forgot-password reset; participant passwords and reset; sign-in methods; avatars (re-encode first); promote one-off; roster reconciliation | identity-auth-roles 08; easy-login 02 (reconciliation note) | `19-org-directory`, `20-staff-invite-assign`, `21-password-reset-flows`, `22-sign-in-methods`, `23-avatars`, `24-image-reencode` |
| **A3 Exercise management** | Readiness; stage/unstage; StartEx gate; reopen; reset; delete; duplicate; participant name; view-only code UI | exercise-build-golive 01, 03, 04, 05, 06; exercise-lifecycle-admin 01–02 | `exercise-build-golive/07-reset-reopen`, `08-delete` |
| **A4 Setup content** | Persona create, clone, archive; templates and casts; avatar library; content pack upload | persona-management 01, 02, 05 (03 is a duplicate of closed #18, so close it) | `persona-management/06-content-pack-upload` |
| **A5 Lifecycle correctness** | #375, #379, #390, #376, #389, #485 | — | one story per issue |

**Done when** (C2): an org admin, starting from an empty org (created by `POST /api/ops/organizations`), can
invite staff, import participants, create personas, seed content, stage, start, end and duplicate the
exercise, with no Dynamis help. Every "ask Dynamis support" line this work removes from `docs/guide/` is gone.

---

## 11. Review record

**Copilot review (2026-10-16), 8 findings, all accepted and folded in:**
- the org-scope session allow-list (§1.2);
- the cross-tab world rule (§1.2);
- archive from build after reset (§5.1, §5.2);
- duplicate-then-reset guidance (§5.2);
- participant-media avatars on duplicate (§5.5);
- run-sheet reply targets (§5.4a, readiness item 8);
- audit storage without an exercise (`OrgAuditEvent`, §7.5);
- the A1 password columns and the chained interim provider (§1.3, §9).

None of them changes a Tier-2 decision in §8. They close gaps in how those decisions are implemented.

**Copilot review 2 (2026-10-16), on `3d64da4`, 11 findings.** Seven repeated findings that were already fixed
in `025ba1b` and `90e194a`. Four were new and are folded in:
- cross-org lockout attribution (§1.2);
- the `LoginChoice` record, kept separate from `CredentialToken` (§1.2, §3.3);
- follow-edge provenance and the setup/conduct backfill (§5.4, §5.5);
- staged dry-run writes in the role matrix (§8.2).

**Copilot review 3 (2026-10-16), on `f2c3b66`, 9 findings, all accepted.** In the design doc:
- reset dependencies, covering persona media and setup replies to conduct posts (§5.4b);
- the org-scope session role as a discriminated union (§9);
- the nullable `exerciseName` contract change (§9).

In the stories:
- build-golive 06, 07, 09, 10, 11 and 12;
- identity-auth-roles 15, 16, 19, 25 and 26.

The story fixes include:
- control messages vs content broadcasts at EndEx;
- the last-admin rule also covering disable;
- `no-store` as middleware placed before the auth and rate-limit gates;
- #389 rescoped to refused privileged origins.

**Copilot review 4 (2026-10-16), on `e1c0b9d`, 2 findings, both accepted:**
- Reset keeps media that is still referenced, which supersedes clearing persona references (§5.4b).
- Revoking a grant revokes the sessions minted from it (§1.1).

**Added 2026-10-16 (Tom):** the lead controller is `Enrollment.IsLead` in A1 (§1.1, §8.2), at the orchestrator's
request for Session C (#571).
