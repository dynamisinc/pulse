# Story: Shared read-only access (view-only session) [TIER-2]

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-015  ·  **Design decisions:** none  ·  **Issue:** #63
**Stack:** backend  ·  **Review:** Tier-2 (human sign-off — internet-facing shared secret)

## Context
For the "hundred passive participants" case: each exercise can enable a generic credential (exercise
URL + shared password) granting a **view-only session** — full read access to all enabled channels,
no posting/reacting/following/DMs. Account-management burden must be near zero. Read-only sessions get
an **ephemeral session identity** so telemetry (XC-004) can still count views/reach without per-user
provisioning; default landing is **All Posts** (or the Portal once E3 lands), never the Following feed
(COR-015).

**Phase B2 backend build (`docs/BACKEND_ROADMAP.md` §4) — [TIER-2].** This story builds the shared
credential (a `SharedCredential` entity scoped to one exercise), the shared-cred login that mints a
**view-only** story-03 session with an **ephemeral telemetry identity**, and the write-path denial for
that session. The shared password is an internet-facing secret on a public hostname and is reviewed as
such (its **lifecycle** — rotation/revoke/lockout/rate-limit — is story 07).

## Acceptance Criteria
- [ ] An exercise can enable a shared credential (URL + password) that grants a view-only session with
      read access to all enabled channels.
- [ ] A read-only session cannot post, react, follow, or DM (write paths denied), and requires no
      per-user provisioning.
- [ ] Each read-only session gets an **ephemeral identity** so views/reach are counted in telemetry
      (XC-004) without a named account.
- [ ] The default read-only landing/feed is **All Posts** (or the Portal once E3 lands) — never the
      Following feed (which is empty for non-following accounts).

### Backend — shared credential, view-only session, ephemeral identity (COR-015, NFR-009)
- [ ] A `SharedCredential` entity (one per exercise: the hashed shared password + enabled flag) is added
      to `PulseDbContext` via the B0 create-then-extend pattern (new `DbSet` + config + migration).
      **`SharedCredential` IS `IExerciseScoped`** (one exercise) — carries a non-nullable `ExerciseId`,
      covered by the global filter + write-guard.
- [ ] `POST /api/auth/shared` verifies the shared password **against the host-resolved exercise's**
      `SharedCredential` (story 08) and, on success, issues a story-03 session with `isReadOnly: true`
      and an **ephemeral `accountId`/`actingHumanId`/session identity** (no named `Account`).
- [ ] The password is stored hashed (never plaintext); the endpoint is per-IP rate-limited (full
      brute-force lockout/rotation/revocation is story 07).
- [ ] A read-only session's write paths are **denied server-side** (post/reply/react/follow/DM return
      403) — never merely hidden in the UI.

### Cross-cutting
- [ ] **Isolation (XC-001/COR-001):** a shared-cred session is scoped to exactly the host's exercise; it
      can never read another exercise's content, and the shared password of exercise A never authenticates
      on exercise B's host. Extends the standing suite (`exercise-isolation/07`) with a read-only-session
      case.
- [ ] **Telemetry (XC-004):** shared-cred login (success **and** failure) emits an XC-004 event against
      the locked v0 envelope (wall + scenario time, actor, channel); the ephemeral identity is carried in
      `actor.sessionId` for reach counting (COR-015), `channel: 'system'`. Actor `kind` is **`'system'`**
      — a shared read-only session is not a named participant, so it emits `actor.kind: 'system'` with
      `actor.sessionId` = the ephemeral session id and **no** `participantId`. This satisfies the locked v0
      `superRefine` (which requires `participantId` only when `kind === 'participant'`) without reopening
      the frozen envelope. Scenario time uses the exercise's stored scenario time until the COR-050 backend
      clock (B3) lands.
- [ ] **Content security (NFR-004 / NFR-009):** the shared-cred login input is validated; the endpoint is
      per-IP rate-limited (lockout is story 07); the hashed password is never logged or returned.

## Out of Scope
The credential **lifecycle** — rotation/revocation/lockout/per-IP-limit tuning (story 07); the session
issuance mechanism (story 03 — this story *calls* it); the feeds themselves (E2 SOC-080/081); the **All
Posts landing route** — realized by `app-shell/01` / `exercise-isolation/04` off the session's
`isReadOnly` flag (this story sets the flag + ephemeral identity, not the route); the login page theming
(COR-030); the backend native scenario clock (COR-050, Phase B3).

## Technical Notes
Backend (the ephemeral identity is telemetry-bearing but not a provisioned account). Owns
`src/Pulse.WebApi/Features/Identity/` shared-cred slice: the `SharedCredential` entity +
`PulseDbContext` config + migration, `SharedCredentialEndpoints` (`/api/auth/shared`),
`AddSharedReadOnly()`, and the server-side write-path denial for read-only sessions. Follows the
`Features/Social/*` endpoint pattern; route base `/api`. The `isReadOnly` flag on the frozen `Session`
shape drives the All-Posts landing in `app-shell/01`. See implementation.md (story 06).

## Dependencies
`backend-host/02-persistence-efcore` + `AddExerciseScoping` (Phase B0, landed). Story 03 (session
issuance — this mints a view-only session through it); exercise-isolation story 08 (host-resolved
exercise the credential is checked against). Lifecycle in story 07. Landing consumed by `app-shell/01`.

## Tests
- Integration: a shared-credential session is read-only (every write path returns 403), gets an
  ephemeral telemetry identity, and is scoped to the host's exercise.
- Integration: the shared password of exercise A never authenticates on exercise B's host.
- Integration: shared-cred login success/failure emit the expected XC-004 events with the ephemeral
  `actor.sessionId`.

### Test coverage (linked; `[RequiresDockerFact]` unless noted — real SQL Server via Testcontainers, skip cleanly on a Docker-less box and run in CI)
Backend slice under `src/Pulse.WebApi/Features/Identity/SharedAccess/`; tests under
`src/Pulse.WebApi.Tests/Features/Identity/SharedAccess/`.

- **View-only session + ephemeral identity + read access (AC1/AC3):**
  `SharedReadOnlyLoginServiceTests.Login_CorrectPassword_MintsReadOnlySessionWithEphemeralIdentity_EmitsSuccessTelemetry`;
  `SharedReadOnlyWriteDenialIsolationTests.SharedLogin_MintsViewOnlySession_ThenThatSessionIsDeniedASimWrite_ButCanRead`.
- **Server-side write-path denial — read-only cannot post/react/follow/DM (AC2, backend 403):**
  `SharedReadOnlyWriteDenialIsolationTests.SharedLogin_MintsViewOnlySession_ThenThatSessionIsDeniedASimWrite_ButCanRead`,
  `SharedReadOnlyWriteDenialIsolationTests.NonReadOnlySession_PassesTheWriteGuard`,
  `SharedReadOnlyWriteDenialIsolationTests.AnonymousWrite_IsNotAReadOnly403_ButFailsClosedOnUnresolvedScope`.
- **Default landing is `isReadOnly`-driven, not the Following feed (AC4):** the backend sets
  `isReadOnly: true` + `role: participant` on the minted session (asserted in
  `SharedReadOnlyWriteDenialIsolationTests.SharedLogin_...ButCanRead` and
  `SharedReadOnlyLoginServiceTests.Login_CorrectPassword_...`); the All-Posts route itself is `app-shell/01`.
- **`SharedCredential` IS `IExerciseScoped` (backend AC):** covered by the Wave-0 standing suite
  `Data.AccountAndSharedCredentialIsolationTests` (filter / fail-closed / IDOR for `SharedCredential`).
- **`POST /api/auth/shared` checks the HOST-resolved credential (backend AC + isolation):**
  `SharedReadOnlyWriteDenialIsolationTests.ExerciseAPassword_OnExerciseBHost_FailsClosed`,
  `SharedReadOnlyWriteDenialIsolationTests.WrongPassword_OnCorrectHost_FailsClosed`,
  `SharedReadOnlyLoginServiceTests.Login_ExerciseAPassword_DoesNotAuthenticateAgainstExerciseBCredential`,
  `SharedReadOnlyLoginServiceTests.Login_UnresolvedScope_FailsClosed_NoSession_NoTelemetry`.
- **Password stored hashed (slow KDF), never plaintext/logged (backend AC, NFR-009):** `[Fact]`
  `SharedCredentialHasherTests.*` (no-plaintext, salted, verify, fail-closed).
- **Per-IP rate limit (NFR-009):** `[Fact]`
  `SharedReadOnlyEndpointsHttpTests.SharedLogin_ExceedsPerIpRateLimit_Returns429`.
- **Disabled / revoked / absent credential fails closed (story-06 read of `IsEnabled`/`RevokedAt`/`CurrentHash`):**
  `SharedReadOnlyLoginServiceTests.Login_DisabledCredential_Rejected_NoSession`,
  `Login_RevokedCredential_Rejected_NoSession`, `Login_NoCredentialForExercise_Rejected_NoSession`,
  `Login_WrongPassword_Rejected_NoSession_EmitsFailureTelemetryWithNoIdentity`.
- **Isolation — read-only session for A sees zero B rows (XC-001, standing-suite extension):**
  `SharedReadOnlyWriteDenialIsolationTests.SharedLogin_...ButCanRead` (asserts A's post present, B's absent).
- **Telemetry (XC-004) success + failure, one `SaveChanges`, ephemeral `actor.sessionId`:**
  `SharedReadOnlyLoginServiceTests.Login_CorrectPassword_...EmitsSuccessTelemetry`,
  `Login_WrongPassword_...EmitsFailureTelemetryWithNoIdentity`,
  `Login_Success_TelemetryEvent_PersistsInOneSaveChangesCall`.
- **Fast fail-closed HTTP paths (no DB):** `[Fact]`
  `SharedReadOnlyEndpointsHttpTests.SharedLogin_NullBody_Returns400`, `SharedLogin_MissingPassword_Returns400`.
