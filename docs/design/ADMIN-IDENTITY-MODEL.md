# ADMIN-IDENTITY-MODEL — People, enrollments, credentials and the exercise lifecycle

**Status:** DRAFT — awaiting Tier-2 sign-off (Tom) · **Owner:** Session A (administration) · **Date:** 2026-10-16
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
Organization
  └── Person                    (org-owned; who the human is + their credentials)
        ├── OrgRole?            ("orgAdmin" — the only org-level grant)
        ├── StaffUser           (1:1 facet sharing Person.Id; exists once the person has any staff enrollment)
        │     └── StaffAssignment(ExerciseId, Role ∈ planner|controller|evaluator)   ← staff enrollment
        └── Account*            (exercise-scoped; Account.PersonId → Person)          ← participant enrollment
              Role ∈ participant|pio, PersonaId
```

- **`Person` (new, `IOrganizationOwned`)** has these columns: `Id`, `OrganizationId`, `Email` (normalized, **unique
  platform-wide**, nullable only for legacy rows during migration), `DisplayName`, `PasswordHash?`,
  `PasswordChangedAt?`, `FailedLoginCount`, `LockedOutUntil?`, `OrgRole?`, `AvatarBlobName?`, `DisabledAt?`, `CreatedAt`.
  Like `StaffUser`, it is a *resolution root* at sign-in (looked up by email *in order to* find the
  tenant). It therefore uses `InOrganization` everywhere except the sign-in lookup, which carries an
  `org-scope-exempt(ResolutionRoot)` marker. The sweep test's count is bumped.
- **"Enrollment" is a logical union, not a new table.** A staff enrollment is a `StaffAssignment` row.
  A participant enrollment is an `Account` row whose `PersonId` is set. We keep both tables because every
  participant path in the code (links, day word, roster, persona binding, attribution, rate limits)
  is built on `Account`, and every staff filter is built on `StaffAssignment`. A new `Enrollment` table
  would force a rewrite of finished, Tier-2-signed stories (02, 03, 05, 10–14 and easy-login 01–14)
  for no gain in isolation. The service layer exposes them together as `IEnrollmentDirectory`
  ("all enrollments for person P"), and the people UI reads that.
- **`StaffUser` becomes a 1:1 facet of `Person` that shares the primary key** (`StaffUser.Id == Person.Id`).
  Every existing FK (`Session.StaffUserId`, `ParticipantLink.IssuedByStaffUserId`,
  `ExerciseDayWord.SetByStaffUserId`, telemetry actor ids) stays valid, and no class is renamed while
  Sessions B and C are working in parallel. A migration backfills one `Person` per existing
  `StaffUser`, using the same Id.
- **One person may not hold a staff enrollment and a participant enrollment in the same exercise.**
  The service layer enforces this when it creates either kind; it returns 409 `conflicting-enrollment`.
  A person who is a controller on Exercise A and a participant on Exercise B is fine. Being both
  inside one exercise would break evaluation integrity and the two-worlds rule.
- **The org admin grant is `Person.OrgRole = "orgAdmin"`. It is not an exercise role.** `orgAdmin` leaves the
  `StaffAssignment` role vocabulary. Migration: every existing `orgAdmin` assignment sets the person's
  `OrgRole` and is rewritten to `planner` on that exercise, so the person keeps the access they have today.
  To work *inside* an exercise, an org admin needs an enrollment. They can enroll themselves (audited
  `org.enrollment.self-granted`), but they never get implicit in-exercise powers. This keeps the role
  matrix (§8.2) two-dimensional and auditable.

### Decision 1.2 — a session is minted for one world, and for at most one exercise

| Session kind | Minted from | ExerciseId | Role source | Host binding |
|---|---|---|---|---|
| `participant` | an `Account` (password / link / day word) | the host's exercise | `Account.Role` | must equal the host exercise (as today) |
| `readonly` | the view-only code | the host's exercise | `participant`, IsReadOnly | must equal the host exercise (as today) |
| `staff` | `Person` credentials + a `StaffAssignment` | the selected exercise | `StaffAssignment.Role` | none (as today) |
| `staff` (**org scope**) | `Person` credentials with `OrgRole = orgAdmin` and no exercise selected | **null** | `orgAdmin` | none |

- `Session.ExerciseId` becomes **nullable**, and `Session.PersonId` is added. Null means org scope. That is
  structurally different from `Guid.Empty` (the "unresolved" sentinel the write-guard refuses), which is
  exactly what story 15's AC asks for. Only `/api/org/*` and `/api/session` accept an org-scope session.
  Every exercise-scoped route fails closed on it, because `IExerciseContext.CurrentExerciseId` stays null and the
  existing guards already 401/403 on null.
- **Staff sign-in no longer takes an exercise.** `POST /api/auth/staff/login {email, password}` mints:
  - an org-scope session if the person is an org admin;
  - otherwise a session on their most recently used enrollment.
  It fails with a uniform 401 if they have neither. The existing `POST /api/staff/active-exercise` switches
  between enrollments (and into or out of org scope for org admins). **It can only ever select a
  `StaffAssignment`, never an `Account`**, so a staff session cannot cross into the participant world.
- **Participant sign-in is unchanged in shape.** The host resolves the exercise (`HostExerciseResolver`),
  and the credential resolves an `Account` *in that exercise*. A person with only staff enrollments who
  tries the participant sign-in gets the same uniform 401 as a wrong password.
- **The same credentials work in both worlds** (B1 "one account, separate entry"). The password hash lives on
  `Person`, so both sign-in services verify against it whenever `Account.PersonId` is set (§3).
- **One world per browser origin.** In the SPA, signing into one world clears the other world's token
  store (`tokenStore.ts`). Staff tokens use `sessionStorage` and participant tokens use `localStorage`. Today a
  staff member browsing an exercise host where they are also a participant could hold both. The
  server-side rule already makes a single session one world; this closes the client-side half.
- **Staff console host.** An org-scope session has no exercise host to land on (story 15's frontend gap).
  **Decision:** one platform staff host (e.g. `console.<platform-domain>`) serves the staff console for
  every org. Per-exercise hosts keep serving staff routes too, for backward compatibility. The host is
  configuration, not code: `StaffConsole:Host`. → **Open question for Tom (Q1):** the hostname, and
  whether per-exercise staff entry is retired later.

### Decision 1.3 — the Dynamis IdP stub stays as break-glass

`IIdentityProvider` gets a second implementation, `PulsePasswordIdentityProvider` (Person email + hash),
which becomes the default. The config-allowlist `DynamisIdentityProvider` stays as an **ops-only
break-glass** for Dynamis staff and is disabled by config in customer deployments. Entra/SSO stays a future
provider behind the same seam (COR-014 unchanged).

---

## 2. Directory people vs one-off participants

### Decision 2.1 — a one-off participant is an `Account` with no `Person`

- **Directory person:** a `Person` row. They carry across exercises and have org-level credentials.
- **One-off participant:** an `Account` with `PersonId = null`. They exist only inside that exercise, sign in only
  with that exercise's methods, and are deleted with it. This is exactly today's easy-login roster row,
  so nothing about it changes.
- **Why not an `ExerciseOnly` flag on `Person`?** It would put throwaway people into the org directory,
  and the directory UI would need a filter everywhere. A null FK states the same fact with no new state,
  and today's roster is already that shape.

### Decision 2.2 — reconciliation is by email only, and is never silent

- **Roster CSV import** (`/api/staff/roster/import`). For each row:
  - The email matches a `Person` in the exercise's org → the `Account` is created linked (`PersonId` set).
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
  A cross-org email collision is refused with 409 and never linked: email is unique platform-wide, and
  linking across tenants is never allowed.
- **Participants added from the directory:** the planner picks people from the directory and assigns each a
  role (participant or pio) and a persona (existing, or auto-created citizen as today). This creates linked
  `Account` rows.

### Open questions
- **Q2:** Email unique **platform-wide** (chosen: one sign-in box, no org picker), or unique per org (a
  consultant working for two customers keeps one email, but sign-in then needs an org selector)? The
  recommendation is platform-wide; the cost is that a consultant needs two emails.

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
- **Staff "forgot password":** `POST /api/auth/password/forgot {email}` is pre-auth and allowlisted.
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
  dropped. → **Q3:** the library. The recommendation is **SkiaSharp** (MIT). ImageSharp needs a commercial
  licence for this use, and Magick.NET is heavy.
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
     └──────── **reset** (planner|orgAdmin) ◀──────────────────────────── completed ──archive──▶ archived
                                                **reopen** (controller) ──▶ live      ◀──**unarchive** (orgAdmin)──┘
   **delete** (planner|orgAdmin): build only, never ran
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
| **Archive** | completed → archived | everything (read-only) | live sessions revoked | planner or org admin |
| **Unarchive** | archived → completed | everything | nothing | org admin only |
| **Reset** | completed → build | settings, chrome, sign-in methods, personas (with any live edits), staff library media, run sheet (all items back to *pending*), noise pool, **setup posts** (§5.4), accounts, enrollments, links, view-only code | **conduct data**: conduct posts and their edits, reactions, reposts, `PostMediaItem` rows and **participant-uploaded media** on them, follows created after `FirstLiveAt`, telemetry events, engine review items, inject queue state, runtime state (clock, pause tier), day words, every session | planner or org admin; typed-name confirmation. **The UI offers the AAR/report export first.** Refused when not completed |
| **Delete** | build → (gone) | — | the exercise and every exercise-scoped row and blob; the hostname is freed | planner or org admin; **only if `FirstLiveAt` is null** (never ran). An exercise that ran and was reset can only be archived |
| **Duplicate** | any → new build exercise | see 5.5 | — | planner on the source, or org admin |

- **Reset hard-deletes.** It does not version or run-number the conduct data. Keeping several runs in one
  exercise would push a "which run" dimension into every evaluator query. If a team needs both runs, they
  **duplicate** before resetting. → **Tier-2 sign-off §8.5.**
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

Warnings (shown, not blocking): no run sheet items; no opening feed; empty noise pool; personas missing avatars;
participants with no sign-in yet issued; no evaluator enrolled.

### Decision 5.4 — setup vs conduct posts
`Post` gets **`IsSetupContent`** (bool, stamped server-side by the write path when the exercise is in
`build` or `staged`). Reset keeps setup posts (the opening feed, pre-exercise history) and deletes conduct
posts. Today nothing distinguishes them. `Origin` describes who posted, not when. Inferring from
`CreatedWallClock < FirstLiveAt` breaks after a reopen or a reset, so the flag is explicit.

### Decision 5.5 — duplicate
- **Copied, with new ids and every cross-reference remapped:**
  - settings, chrome and sign-in methods;
  - personas, with avatar and banner media remapped;
  - staff library media (blobs server-side copied into the new prefix);
  - the run sheet, all items pending;
  - the noise pool;
  - the follow graph between personas;
  - **staff enrollments** (default on, so the team is carried over).
- **Never copied:**
  - posts, including setup posts (C2: "never posts"). The opening feed is re-seeded from the pack (§6) or
    rebuilt;
  - participant accounts, links, day words and sessions;
  - telemetry and conduct data;
  - participant-uploaded media.
- **Optional:** "copy participant roster" re-creates **directory-linked** accounts with their persona bindings and
  no links. One-off accounts are not copied.
- **New:** a hostname, a view-only code (generated, disabled), and the name "Copy of X". State: build.
- → **Q4:** should the **setup posts** be copied? Copying the opening feed is what planners will expect. C2
  says "never posts". The recommendation is to copy setup posts only, and never conduct posts. That needs
  Tom to amend C2.

---

## 6. Content seeding in the app

### Decision 6.1 — a planner uploads the existing pack format
- **Format:** `pulse.demopack.v1` (today's `docs/demo/pack/pack.json` plus a media folder), uploaded as one zip.
  It contains personas, media, the opening feed, pins, the run sheet and the noise pool. Size cap 200 MB.
  The ingest is streamed.
- **Flow:**
  1. `POST /api/staff/content-packs` (planner, exercise in **build or staged** — content lock, build-golive/05).
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
   - `CredentialToken`: unscoped resolution root, carrying `OrganizationId` and checked on redemption.
   - `ContentPackItem`, plus a `ContentPack` upload record: `IExerciseScoped`.
   - Staff avatar blobs: under an org prefix.
5. **Platform provisioning:** `POST /api/ops/organizations {name, adminEmail}`, gated by the bootstrap secret,
   creates the org and its first org admin `Person` and sends an invite. This is the only thing Dynamis does
   (B1 "org-admin self-service"). `bootstrap-exercise` stays non-production only.

---

## 8. Tier-2 sign-offs requested (the five from C2)

### 8.1 This identity model
Sections 1–7: `Person` with a shared-key `StaffUser` facet; enrollments = `StaffAssignment` ∪ linked `Account`;
the org admin as `Person.OrgRole`; nullable `Session.ExerciseId` for org scope; one world per session and per
origin; one-offs as `Account` with no `PersonId`.

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
| StartEx, pause/resume, EndEx, reopen, Freeze/pause tiers *(L)* | via enrollment | — | ✅ | — | — | — |
| Roster: import, links, day word, email, participant reset/reissue, avatars | via enrollment | ✅ | ✅ | — | — | — |
| View-only code rotate/revoke | via enrollment | ✅ | ✅ | — **(change: today any staff)** | — | — |
| Personas: create, edit, archive | via enrollment | ✅ | ✅ | — | — | — |
| Content pack upload/apply *(L: build/staged)* | via enrollment | ✅ | — | — | — | — |
| Run sheet edit | via enrollment | ✅ | ✅ | — | — | — |
| Fire injects, post as persona, takedown, pin, noise, steering, engine review | via enrollment | — | ✅ | — | — | — |
| Read everything in the exercise (console, feeds, report) | via enrollment | ✅ | ✅ | ✅ | — | — |
| Sim writes (post, reply, react, follow, own avatar) *(L: live, not frozen)* | — | — | — | — | ✅ | — |
| Read the fiction | — | — | — | — | ✅ | ✅ |

"Via enrollment" means the org admin enrolls themselves (audited) and then holds that role's row.
Evaluators are refused **every** write (#61), including future annotations until track 5 adds an
evaluator-only annotation route.

**Recorded decision (#481):** **stage** = planner. **Archive** = planner or org admin. StartEx and EndEx stay controller-only.
→ **Q5:** Is the narrowing on *create exercise* (org admin only) and *settings* (planner only, so a controller
mid-exercise cannot flip practice mode) what you want?

### 8.3 Password policy
§3.2. Staff 12 characters, participants 8, no composition rules, blocklist, progressive lockout, no expiry,
MFA deferred.

### 8.4 Participant-facing exercise name (#180 → #376)
- New `Exercise.ParticipantName` (nullable, ≤ 80 characters).
- `ExerciseScopeDto.exerciseName` projects **`ParticipantName`**, and **never** falls back to the internal `Name`.
  If it is not set, participants see **no exercise name** (the brand header stands alone).
- It is a **blocking** readiness item (§5.3).
- Cards, emails and the join page use the same projection.
- → **Q6:** No fallback (recommended: the internal name can leak the scenario, e.g. "HURREX-26 Cat 4 Landfall
  Dry Run"), or fall back to the brand or app name?

### 8.5 Reset semantics
§5.2 and §5.4. Hard delete of conduct data; setup posts, configuration and people kept; result state `build`;
the report export offered first; only from `completed`; planner or org admin; typed confirmation.

---

## 9. Changes the orchestrator must clear

| Kind | Item | Wave |
|---|---|---|
| **EF migration** | `AdminIdentityFoundation`:<br>• `People` table, with a backfill of one per `StaffUser` (same Id)<br>• `StaffUsers.Id` FK → `People.Id`<br>• `Accounts.PersonId` (nullable FK)<br>• `Sessions.PersonId`<br>• **`Sessions.ExerciseId` nullable**<br>• `People.OrgRole`, with orgAdmin assignments backfilled → planner + OrgRole<br>• `Exercises.FirstLiveAt` (backfilled from lifecycle telemetry where the status is past `staged`)<br>Hand-written SQL in `EXEC`, per OPERATE.md | A1 |
| EF migration | `CredentialToken`; `People` password, lockout and avatar columns; `Exercises.SignInMethods`; `MediaAssets.UploadedByAccountId` | A2 |
| EF migration | `Posts.IsSetupContent`; `Exercises.ParticipantName` | A3 |
| EF migration | `ContentPack`, `ContentPackItem`; persona archive column | A4 |
| **Frozen shared type** | `Session` (frontend `sessionResolver.ts:47` / `SessionDto`): `exerciseId` becomes nullable; adds `personId` and `world` (`staff`/`participant`). `ExerciseRole` (`roles.ts`): `orgAdmin` leaves the exercise-role union and becomes an `OrgRole`. Posted on the feature issue per C1.4 **before** A1 merges | A1 |
| Frozen shared type | `ExerciseScopeDto.exerciseName` changes its source to `ParticipantName` (same field name and shape) | A3 / A5 |
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
| **A1 Foundation** | `Person` + facet + `Session` changes + org-scope sign-in (story 15) + `PulsePasswordIdentityProvider`; per-route and per-transition role checks (#377/#481/#61); the route × role matrix test; #480 forwarded headers | identity-auth-roles 01, 04, 05 (note), 15; exercise-lifecycle-admin 03 | `16-person-and-enrollments`, `17-role-matrix-enforcement`, `18-forwarded-headers` |
| **A2 People** | Org directory UI; staff invite and assignment; admin and forgot-password reset; participant passwords and reset; sign-in methods; avatars (re-encode first); promote one-off; roster reconciliation | identity-auth-roles 08; easy-login 02 (reconciliation note) | `19-org-directory`, `20-staff-invite-assign`, `21-password-reset-flows`, `22-sign-in-methods`, `23-avatars`, `24-image-reencode` |
| **A3 Exercise management** | Readiness; stage/unstage; StartEx gate; reopen; reset; delete; duplicate; participant name; view-only code UI | exercise-build-golive 01, 03, 04, 05, 06; exercise-lifecycle-admin 01–02 | `exercise-build-golive/07-reset-reopen`, `08-delete` |
| **A4 Setup content** | Persona create, clone, archive; templates and casts; avatar library; content pack upload | persona-management 01, 02, 05 (03 is a duplicate of closed #18, so close it) | `persona-management/06-content-pack-upload` |
| **A5 Lifecycle correctness** | #375, #379, #390, #376, #389, #485 | — | one story per issue |

**Done when** (C2): an org admin, starting from an empty org (created by `POST /api/ops/organizations`), can
invite staff, import participants, create personas, seed content, stage, start, end and duplicate the
exercise, with no Dynamis help. Every "ask Dynamis support" line this work removes from `docs/guide/` is gone.
