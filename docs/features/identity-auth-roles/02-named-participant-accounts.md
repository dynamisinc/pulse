# Story: Named participant accounts (provisioned, no self-signup)

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-011  ·  **Design decisions:** none  ·  **Issue:** #59
**Stack:** fullstack  ·  **Review:** Tier-1

## Context
Active roles — anyone who posts, publishes, or DMs (PIOs, comms players) — get **exercise-provisioned
named accounts** (bulk import or planner-created). There is **no self-registration** on participant
paths, and fake sign-up UI theater is omitted normatively (phishing-pattern optics on a government
training site) (COR-011).

**Phase B2 backend build (`docs/BACKEND_ROADMAP.md` §4).** This story builds the participant `Account`
entity (scoped to exactly one exercise), the planner **bulk CSV import** + individual create, and the
participant credential login that mints a story-03 session. No self-registration endpoint exists on any
participant path. **`stack: fullstack`** because the staff-console CSV import panel is a real,
usable-in-B2 planner surface (COBRA, staff world); the participant login **page theming** stays out of
scope (COR-030). *(If the orchestrator prefers to balance the wave, the import UI is separable into a
backend-only slice + a follow-up frontend story — the backend endpoints stand alone; default here is
fullstack.)*

## Acceptance Criteria
- [ ] Planners can provision named participant accounts by bulk import (CSV, mirroring Cadence's bulk
      import) or individually.
- [ ] There is **no self-registration** on any participant path, and **no fake sign-up UI**.
- [ ] A provisioned account belongs to exactly one exercise (COR-004) and carries its role(s).
- [ ] Provisioning is a staff/planner action (staff world), never participant-facing (XC-002).

### Backend — Account entity, provisioning, participant login (COR-011)
- [ ] An `Account` entity (participant named account: display identity, role(s), one exercise) is added
      to `PulseDbContext` via the B0 create-then-extend pattern (new `DbSet` + `OnModelCreating` config +
      migration). **`Account` IS `IExerciseScoped`** — it belongs to exactly one exercise, so it carries
      a non-nullable `ExerciseId` and is covered by the global query filter + write-guard.
- [ ] `POST /api/staff/accounts/import` (CSV, staff/planner-only) creates scoped accounts in the caller's
      active exercise; `POST /api/staff/accounts` creates one account. Both stamp `ExerciseId` from the
      resolved scope (never a client-supplied exerciseId).
- [ ] `POST /api/auth/login` verifies a participant credential against an `Account` **in the
      host-resolved exercise** (story 08) and, on success, issues a story-03 session; there is **no**
      registration/self-signup endpoint reachable on a participant path.
- [ ] A login against an account that does not belong to the host's exercise fails closed (never
      resolves a cross-exercise account).

### Cross-cutting
- [ ] **Isolation (XC-001/COR-001):** an `Account` is bound to one exercise; a participant login on
      exercise A's host can only match an A account, and an account list/query is staff-only and
      A-scoped. A leaked/guessed account id from exercise B is invisible on A. Extends the standing suite
      (`exercise-isolation/07`) with an accounts case.
- [ ] **Telemetry (XC-004):** participant **login success and failure** emit an XC-004 event at this
      endpoint against the locked v0 envelope (wall + scenario time, actor, channel) — success:
      `eventType: 'login'`, `actor.kind: 'participant'`, `participantId` = accountId, `channel: 'system'`;
      failure: `payload.outcome = 'failure'`, no session identity (target = the attempted handle,
      sanitized). Scenario time uses the exercise's stored scenario time until the COR-050 backend clock
      (B3) lands.
- [ ] **Content security (NFR-004):** CSV import fields — **especially display names, which render in the
      staff console AND on participant surfaces (a stored-XSS surface)** — are validated and HTML-
      sanitized on ingest; oversized/malformed CSV is rejected; MIME/size validated. Login inputs are
      sanitized. The login endpoint is per-IP rate-limited (NFR-009). A stored script in an imported
      display name never executes in another session (extends the stored-XSS suite, COR-007).

## Out of Scope
Read-only shared access (story 06); the session issuance mechanism (story 03 — this story *calls* it);
org-account grants (story 09, deferred); the **login page theming** (exercise-configuration COR-030);
per-account posting rate limits (NFR-009, handled where posting is built, E2); the participant landing
route after login (`exercise-isolation/04` / `app-shell/01`).

## Technical Notes
Staff-world provisioning + participant login. **Backend** owns `src/Pulse.WebApi/Features/Identity/`
account slice: the `Account` entity + `PulseDbContext` config + migration, `AccountEndpoints`
(`/api/staff/accounts/import`, `/api/staff/accounts`, `/api/auth/login`), `AddParticipantAccounts()`.
**Frontend** owns the staff-console CSV import panel `features/planner/components/AccountImport.tsx`
(COBRA, mirrors Cadence's bulk-import UX) — reuses `@/theme/styledComponents`. Follows the
`Features/Social/*` endpoint pattern; route base `/api`. See implementation.md (story 02).

## Dependencies
`backend-host/02-persistence-efcore` + `AddExerciseScoping` (Phase B0, landed). Story 01 (roles); story
03 (session issuance — login mints a session through it); exercise-isolation story 08 (host-resolved
exercise the login matches against). Feeds the participant landing (`exercise-isolation/04`).

## Tests
- Integration: CSV import creates exercise-scoped accounts; no self-registration endpoint exists on
  participant paths; a duplicate/oversized/malformed CSV is rejected.
- Integration: participant login against an in-exercise account issues a session; a cross-exercise
  account never resolves.
- Security: a stored `<script>` in an imported display name is sanitized and never executes in another
  session (extends the stored-XSS suite).
- Integration: login success/failure emit the expected XC-004 events.

### Backend test linkage (Wave 3 build)
Under `src/Pulse.WebApi.Tests/Features/Identity/Accounts/`. DB-touching tests are `[RequiresDockerFact]`
(real SQL via Testcontainers; skip cleanly locally, run in CI); the rest are `[Fact]`.
- **Provision by import or individually (AC "bulk import or individually"):**
  `AccountProvisioningServiceTests.Import_ValidCsv_CreatesAllRows_InActiveExercise`,
  `AccountProvisioningServiceTests.Create_Success_StampsScope_HashesCredential_NormalizesRole`;
  parser shape `AccountCsvParserTests.*`.
- **No self-registration / provisioning is staff-only (AC XC-002):** only `/api/auth/login` is
  participant-facing and it is login-only (no create). Staff-only gate:
  `AccountProvisioningServiceTests.Create_NoStaffSession_FailsClosed_Unauthenticated_NoWrite`,
  `AccountProvisioningServiceTests.Import_NoStaffSession_FailsClosed_Unauthenticated_NoWrite`,
  `AccountEndpointsHttpTests.StaffCreateAccount_NoStaffSession_Returns401`,
  `AccountEndpointsHttpTests.StaffImport_NoStaffSession_Returns401`.
- **Belongs to one exercise + stamped from scope (AC COR-004, backend "stamp ExerciseId from the resolved
  scope"):** `AccountProvisioningServiceTests.Create_Success_StampsScope_HashesCredential_NormalizesRole`,
  `AccountLoginIsolationTests.StaffCreate_LandsOnlyInTheActiveExercise`,
  `AccountLoginIsolationTests.StaffImport_LandsOnlyInTheActiveExercise`.
- **Participant login issues a session (AC `POST /api/auth/login`):**
  `ParticipantLoginServiceTests.Login_Success_IssuesParticipantSession_EmitsSuccessTelemetry_RecordsLastLogin`;
  fail-closed credential/scope paths `ParticipantLoginServiceTests.Login_WrongPassword_*`,
  `Login_UnknownHandle_*`, `Login_CredentialLessAccount_Rejected`, `Login_UnresolvedScope_*`.
- **Cross-exercise login fails closed (AC "fails closed" / XC-001, extends `exercise-isolation/07`):**
  `AccountLoginIsolationTests.Login_HandleProvisionedInExerciseB_IsNotValidOnExerciseAHost_ButIsValidOnB`.
- **Telemetry XC-004 (login success + failure):**
  `ParticipantLoginServiceTests.Login_Success_IssuesParticipantSession_EmitsSuccessTelemetry_RecordsLastLogin`,
  `ParticipantLoginServiceTests.Login_WrongPassword_Rejected_NoSession_EmitsIdentitylessFailure`,
  `ParticipantLoginServiceTests.Login_Success_AccountMutationAndTelemetry_ShareOneSaveChangesCall`.
- **Content security NFR-004 (sanitize, size/MIME, malformed, rate limit, hashing):**
  `AccountProvisioningServiceTests.Create_SanitizesDisplayNameOnIngest`,
  `AccountProvisioningServiceTests.Import_SanitizesDisplayName_StoredScriptNeverPersistsAsMarkup`,
  `AccountFieldRulesTests.TryNormalizeDisplayName_StripsScriptMarkup`,
  `AccountProvisioningServiceTests.Import_MalformedCsv_FailsClosed`, `AccountCsvParserTests.Parse_*Malformed*`,
  `AccountEndpointsHttpTests.StaffImport_OversizedFile_Returns400`,
  `AccountEndpointsHttpTests.StaffImport_EmptyFile_Returns400`,
  `AccountEndpointsHttpTests.ParticipantLogin_ExceedsPerIpRateLimit_Returns429`,
  `ParticipantPasswordHasherTests.*`.
- **Role guard (participant Account may not carry a staff role, XC-002):**
  `AccountProvisioningServiceTests.Create_StaffRole_IsRejectedAsInvalid`,
  `AccountFieldRulesTests.TryNormalizeRole_NonParticipantRoles_AreRejected`.
- **Composition root:** `AccountRegistrationTests.*`.
