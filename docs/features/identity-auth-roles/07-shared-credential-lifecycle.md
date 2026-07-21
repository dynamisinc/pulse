# Story: Shared-credential lifecycle (rotate / revoke / lockout) [TIER-2]

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-016 (NFR-009)  ·  **Design decisions:** none  ·  **Issue:** #64
**Stack:** backend  ·  **Review:** Tier-2 (human sign-off — internet-facing shared secret)

## Context
The shared read-only password is an internet-facing shared secret on a public hostname and is treated
as such. It supports rotation (announce + grace window), immediate revocation (kills all read-only
sessions), brute-force lockout, and per-IP rate limiting (COR-016, NFR-009).

**Phase B2 backend build (`docs/BACKEND_ROADMAP.md` §4) — [TIER-2].** This story builds the lifecycle
controls over the `SharedCredential` (story 06): rotation with a grace window, immediate revocation that
kills all active read-only sessions, brute-force lockout, and per-IP rate limiting — the NFR-009
realization for the shared credential.

## Acceptance Criteria
- [ ] The shared password can be **rotated** with an announce + grace window (old password works during
      the grace period, then stops).
- [ ] **Immediate revocation** kills all active read-only sessions at once.
- [ ] Brute-force **lockout** and **per-IP rate limiting** protect the shared-credential login.
- [ ] Lifecycle actions are staff-only (XC-002) and logged (XC-004).

### Backend — lifecycle controls (COR-016, NFR-009)
- [ ] `POST /api/staff/shared-credential/rotate` (staff-only) sets a new password and a grace window
      during which the previous password still authenticates; after the window it stops. Both passwords
      are stored hashed; the plaintext is shown to staff once and never persisted in the clear.
- [ ] `POST /api/staff/shared-credential/revoke` (staff-only) immediately invalidates the credential
      **and terminates every active read-only session** for the exercise at once (no grace).
- [ ] Repeated failed shared-cred logins trigger a **lockout** (per-IP and/or global), and the
      shared-cred login endpoint is **per-IP rate-limited** — realizing NFR-009 for the shared secret.
- [ ] Lifecycle state (current grace window, lockout state) is exercise-scoped and staff-only (XC-002);
      no participant path can read or trigger it.

### Cross-cutting
- [ ] **Isolation (XC-001/COR-001):** rotation/revocation/lockout act only on the caller's active
      exercise's `SharedCredential` and its sessions; they can never affect another exercise's credential
      or sessions. `SharedCredential` remains `IExerciseScoped` (story 06).
- [ ] **Telemetry (XC-004):** rotation, revocation, a lockout trip, and (from story 06) shared-cred login
      failures each emit an XC-004 event against the locked v0 envelope (wall + scenario time, actor,
      channel) — `actor.kind: 'system'`, `actor.role` = the acting staff role + `actingHumanId` for
      staff-initiated rotate/revoke; `channel: 'system'`; event types `credential.rotated` /
      `credential.revoked` / `auth.lockout` (open vocab, additive). Scenario time uses the exercise's
      stored scenario time until the COR-050 backend clock (B3) lands.
- [ ] **Content security (NFR-004 / NFR-009):** the lifecycle endpoints validate/sanitize input and are
      staff-authz-gated; passwords are hashed and never logged; the login lockout/rate-limit is the
      internet-facing abuse-resistance control.

## Out of Scope
The read-only session + credential itself (story 06 — this story governs its lifecycle); posting-endpoint
rate limits for named accounts (NFR-009, handled where posting is built, E2); the staff surface that
triggers rotate/revoke (a candidate console tool — the endpoints are the deliverable here); the backend
native scenario clock (COR-050, Phase B3).

## Technical Notes
Security foundation + backend. Treat the shared secret as internet-facing. Owns
`src/Pulse.WebApi/Features/Identity/` shared-cred lifecycle slice: `SharedCredentialLifecycleEndpoints`
(`/api/staff/shared-credential/rotate`, `/revoke`), the rotation/grace + lockout + rate-limit logic, and
`AddSharedCredentialLifecycle()`. Reuses ASP.NET Core rate-limiting middleware. Follows the
`Features/Social/*` endpoint pattern; route base `/api`. See implementation.md (story 07).

## Dependencies
Story 06 (the `SharedCredential` + view-only session it governs). `backend-host/02` +
`AddExerciseScoping` (Phase B0, landed). Realizes NFR-009 for the shared credential.

## Tests
- Integration: rotation with a grace window (old password works, then stops); revocation kills all active
  read-only sessions immediately; lockout + per-IP rate limit trigger under brute force.
- Integration: lifecycle actions are staff-only, exercise-scoped, and emit the expected XC-004 events;
  a revoke on exercise A never affects exercise B.

### Test linkage (backend build)
Rotate (grace window, hashed-only, once, telemetry):
- `SharedCredentialLifecycleServiceTests.Rotate_LiveCredential_SetsFreshPassword_RetiresOldIntoGrace_EmitsRotatedTelemetry`
- `SharedCredentialLifecycleServiceTests.Rotate_RevokedCredential_ReenablesWithNewPassword_ButNeverResurrectsKilledSecretIntoGrace`
- `SharedReadOnlyLoginGraceAndLockoutTests.Login_DuringGraceWindow_PreviousPasswordAuthenticates_AsDoesCurrent`
- `SharedReadOnlyLoginGraceAndLockoutTests.Login_AfterGraceWindowExpires_PreviousPasswordRejected_ButCurrentStillWorks`

Revoke (immediate; terminates all read-only sessions):
- `SharedCredentialLifecycleServiceTests.Revoke_TerminatesAllActiveReadOnlySessions_MarksRevoked_EmitsRevokedTelemetry`

Brute-force lockout (+ per-IP rate limit is story 06's `SharedReadOnlyEndpointsHttpTests.SharedLogin_ExceedsPerIpRateLimit_Returns429`):
- `SharedReadOnlyLoginGraceAndLockoutTests.Login_RepeatedFailures_TripLockout_ThenCorrectPasswordRejected_EmitsAuthLockout`
- `SharedReadOnlyLoginGraceAndLockoutTests.Login_WhileLockoutExpired_CorrectPasswordAuthenticates`
- `SharedReadOnlyLoginGraceAndLockoutTests.Login_Success_ResetsFailedAttemptCounter`
- `SharedReadOnlyLoginGraceAndLockoutTests.Login_FailedAttempt_IncrementsFailedAttemptCounter_BelowThreshold`
- `SharedReadOnlyLoginGraceAndLockoutTests.Login_DisabledCredential_WrongPassword_DoesNotAccrueLockout`

Staff-only + logged (XC-002/XC-004):
- `SharedCredentialLifecycleEndpointsHttpTests.Rotate_NoAuthenticatedStaffSession_Returns401`
- `SharedCredentialLifecycleEndpointsHttpTests.Revoke_NoAuthenticatedStaffSession_Returns401`
- `SharedCredentialLifecycleServiceTests.Rotate_NoStaffSession_FailsClosed_Unauthenticated_CredentialUntouched`
- `SharedCredentialLifecycleServiceTests.Revoke_NoStaffSession_FailsClosed_Unauthenticated_NoSessionsTerminated`

Isolation (XC-001/COR-001 — extends exercise-isolation/07):
- `SharedCredentialLifecycleIsolationTests.Revoke_OnExerciseA_LeavesExerciseBCredentialAndReadOnlySessionsUntouched`
- `SharedCredentialLifecycleIsolationTests.Rotate_OnExerciseA_DoesNotMutateExerciseBCredential`
- `SharedCredentialLifecycleIsolationTests.Lockout_IsPerExercise_LockingExerciseADoesNotLockExerciseB`
- `SharedCredentialLifecycleIsolationTests.Grace_IsPerExercise_ExerciseAPreviousPasswordNeverAuthenticatesOnExerciseB`

XC-004 unit-of-work (one SaveChanges) + not-provisioned (404) + DI coexistence:
- `SharedCredentialLifecycleServiceTests.Rotate_PersistsInOneSaveChangesCall`
- `SharedCredentialLifecycleServiceTests.Revoke_PersistsInOneSaveChangesCall`
- `SharedCredentialLifecycleServiceTests.Rotate_NoCredentialProvisioned_NotProvisioned`
- `SharedCredentialLifecycleServiceTests.Revoke_NoCredentialProvisioned_NotProvisioned`
- `SharedCredentialLifecycleEndpointsHttpTests.AddSharedCredentialLifecycle_ComposesWithAddSharedReadOnly_WithoutDuplicatingTheHasher`
- `SharedCredentialLifecycleEndpointsHttpTests.AddSharedCredentialLifecycle_DoesNotRegisterRateLimiterPolicyOptions`
