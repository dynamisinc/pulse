# Story: UAT bootstrap seam (guarded one-time seed endpoint)

**Feature:** Login & UAT go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Complete (PR #310, merged)
**Requirements:** COR-008, COR-011, COR-014, COR-015 (enablement — no login/session logic changes)
**Design decisions:** none  ·  **Issue:** #308
**Stack:** backend  ·  **Review:** Tier-2 (new auth-adjacent surface + a new secret — the always-Critical
review class per `FEATURE_ORCHESTRATION_PLAYBOOK.md`)

## Context

**The chicken-and-egg problem, precisely.** Every write path in the Complete `identity-auth-roles`
backend requires something that, in a freshly-provisioned environment, does not yet exist:

- `POST /api/staff/accounts[/import]` (participant accounts) requires an **authenticated staff session
  with an active exercise**.
- `POST /api/staff/active-exercise` requires an **existing `StaffAssignment`** row.
- `POST /api/auth/staff/login` **will** auto-provision a `StaffUser` row on a credential match (per
  `StaffLoginServiceTests.Login_AuthenticatedButNotAssigned_Forbidden_ProvisionsUser_NoSession_
  EmitsFailure`) — but returns `403 NotAssigned` and issues **no session** until a `StaffAssignment`
  already links that `StaffUser` to an `Exercise`.
- There is no endpoint anywhere that **creates** an `Exercise` row.
- `POST /api/staff/shared-credential/rotate` **rotates** an existing `SharedCredential` — it 404s
  (`NotProvisioned`) when the exercise has none; **there is no endpoint that creates the first one**
  either (flagged here, not silently patched into story 06/07 — those stories are Complete and reviewed;
  this is new scope, not a fix to them).

An empty database — today's actual UAT state — has no path out of this through the existing HTTP surface
at all. This story adds the one guarded seam that does.

**Modeled on an existing precedent, not invented from nothing.** `DynamisIdentityProviderOptions` (the
staff allowlist) already documents exactly this shape: *"a documented development / stand-in mechanism...
The default is EMPTY — with no configured accounts every login fails closed."* This story's bootstrap
endpoint is the same pattern applied to environment seeding: **disabled by default, fails closed when
unconfigured, never reachable in a real customer-facing deployment** (see `feature.md`'s note that
Organization-tenant multi-customer go-live, `exercise-isolation/11`, is still deferred — this is a
Phase-1/pilot/UAT tool, not a multi-tenant admin API).

## Acceptance Criteria

- [x] A new configuration section (e.g. `Authentication:Bootstrap:Secret`, mirroring
      `DynamisIdentityProviderOptions.SectionName`'s pattern) gates the endpoint entirely: **empty/unset
      by default**, and an empty configured secret means the endpoint always rejects (never "any secret
      works") — the same fail-closed contract as the staff allowlist.
      Verified: `BootstrapOptions.Secret` defaults to `string.Empty`; `BootstrapSecretGate.IsAuthorized()`
      explicitly ANDs `!string.IsNullOrEmpty(configuredSecret)` so an unconfigured secret can never
      authorize any presented value.
- [x] `POST /api/ops/bootstrap-exercise` requires the configured secret presented in a header (e.g.
      `X-Bootstrap-Secret`), compared in **constant time** (mirroring `DynamisIdentityProvider`'s secret
      comparison) and never logged; a missing/wrong secret returns `404` (not `401`/`403` — this endpoint
      should not even confirm its own existence to an unauthorized caller).
      Verified: `BootstrapSecretGate.SecretsMatch()` hashes both sides to SHA-256 and compares with
      `CryptographicOperations.FixedTimeEquals` (run unconditionally, so enabled/disabled take the same
      code path — no timing oracle); `BootstrapEndpoints.BootstrapAsync` maps `Rejected ->
      Results.NotFound()`.
- [x] **Given** a valid secret and a request naming a `hostname` (e.g. `pulse-uat.cobrasoftware.com`)
      with no existing `Exercise` for that hostname, **when** called, **then** it creates one `Exercise`
      row (name, hostname, time zone, `status: 'active'`) and returns its id; **given** a hostname that
      already resolves to an `Exercise`, **when** called again, **then** it returns the existing exercise
      (idempotent — safe to re-run against an already-bootstrapped environment, never a duplicate).
      Verified: `BootstrapService.BootstrapAsync` resolves-by-hostname first (`exerciseCreated =
      exercise is null`); `RunProvisioningAsync` only constructs a new `Exercise` (`status: "active"`)
      when none was found; a `DbUpdateException` on the concurrent-first-bootstrap race re-resolves and
      reuses the winner rather than erroring.
- [x] **Given** the request also names an existing allowlisted staff identity (by `username`, matched
      against `DynamisIdentityProviderOptions`) and a role, **when** called, **then** it creates (or
      reuses, if the `StaffUser` was already auto-provisioned by a prior failed login attempt) the
      `StaffUser` row and a `StaffAssignment` linking it to the bootstrapped `Exercise` at that role —
      unblocking `POST /api/auth/staff/login` for that identity on the next attempt.
      Verified: `ValidateStaff()` matches `username` case-insensitively against the allowlist and
      requires a non-empty `Secret`/`ExternalSubject`; `ProvisionStaffAsync` resolves-or-creates the
      `StaffUser` by `ExternalSubject` and the `StaffAssignment` by `(StaffUserId, ExerciseId)`, never
      clobbering an existing role.
- [x] **Given** the request also asks for a `SharedCredential` to be enabled, **when** called, **then** it
      creates the exercise's **first** `SharedCredential` row (hashed, never plaintext-persisted — reuse
      `ISharedCredentialHasher`/`SharedCredentialPasswordGenerator` from story 06/07, do not reimplement
      hashing) and returns the generated plaintext password **exactly once**, in this response, the same
      "hand it back once, only the hash persists" contract `SharedCredentialRotateResponseDto` already
      uses.
      Verified: `ProvisionSharedCredentialAsync` calls `SharedCredentialPasswordGenerator.Generate()` +
      the injected `ISharedCredentialHasher.Hash()` (reused, not reimplemented); the plaintext is present
      on `BootstrapSharedCredentialResponseDto.Password` only when `Created: true` (omitted via
      `JsonIgnore(WhenWritingNull)` on an idempotent re-run).
- [x] **Given** the request also asks for one participant `Account`, **when** called, **then** it creates
      it in the bootstrapped exercise (reusing `AccountProvisioningService`'s validation/sanitization —
      do not duplicate its display-name sanitization logic) — this is a convenience so a fresh environment
      has at least one working participant login without a second manual step, not a replacement for the
      staff-console import panel (`identity-auth-roles/02`'s `AccountImport.tsx`), which remains the real
      per-exercise onboarding path once a staff session exists.
      Verified: `ValidateAccount()` calls `AccountFieldRules.TryNormalizeUsername` /
      `TryNormalizeDisplayName` / `TryNormalizeRole` / `TryValidatePassword` (the shared rules, not a
      fork); `ProvisionAccountAsync` reuses an existing same-handle account rather than duplicating it.

### Cross-cutting

- [x] **Isolation (XC-001/COR-001):** every row this endpoint creates is stamped with the **newly created
      exercise's own id** — never a client-supplied `exerciseId` for any *other* existing exercise (this
      endpoint creates an exercise, it does not attach data to an arbitrary existing one it wasn't asked
      to create). Extends the standing suite (`exercise-isolation/07`) with a bootstrap-creates-correctly-
      scoped-rows case.
      Verified: `BootstrapExerciseRequest` has no `exerciseId` field at all (its own doc comment states
      this explicitly); every scoped write (`Account`, `SharedCredential`, `TelemetryEvent`) is stamped
      with the internally-resolved `exerciseId` variable only.
      **Test coverage confirmed** (`BootstrapServiceTests.Bootstrap_ScopedRows_StampedWithNewExerciseId_
      AndFailClosedIsolated`, `src/Pulse.WebApi.Tests/Features/Ops/Bootstrap/BootstrapServiceTests.cs:125`):
      it asserts the seeded `Account`/`SharedCredential` carry the created exercise's own id, that a
      **different** exercise's scope sees zero of those rows, and — guarding the obvious false positive —
      that the rows physically exist under `IgnoreQueryFilters()`, so the cross-exercise zero is the read
      filter closing the door rather than an empty table. Composition-root reachability is separately
      guarded by `CompositionRootWiringTests.cs` (added in PR #317).
- [x] **Telemetry (XC-004):** a successful bootstrap call emits one XC-004 event (`actor.kind: 'system'`,
      a fixed `bootstrap` actor id, `channel: 'system'`, event type `exercise.bootstrapped` — additive,
      open vocab) so a one-time seed against a real environment leaves an audit trail, not a silent write.
      Verified: `BuildBootstrapTelemetry()` sets exactly those fields (`SystemActorKind = "system"`,
      `BootstrapActorId = "bootstrap"`, `SystemChannel = "system"`, `BootstrappedEventType =
      "exercise.bootstrapped"`) and is added to the same unit of work as the seed rows (one `SaveChangesAsync`).
- [x] **Content security (NFR-004):** the exercise name, hostname, and any display names accepted here go
      through the **same** sanitization/validation the existing account-import path already applies
      (reuse, do not reinvent) — this is exactly the same stored-XSS surface CSV import already guards.
      Verified: `ExerciseHostName.TryNormalize()` for the hostname, `AccountFieldRules.TryNormalizeDisplayName`
      for both the exercise name and the participant display name — all shared, not forked.
- [x] **NFR-009 (abuse resistance):** per-IP rate-limited (its own named policy, mirroring the
      `staff-login`/`shared-login` pattern) even though it is secret-gated — defense in depth against a
      leaked/guessed secret being brute-forced.
      Verified: `AddOpsBootstrap()` registers the named `ops-bootstrap` policy (fixed-window, 10/minute
      per remote IP), and `MapBootstrapEndpoints()` applies `.RequireRateLimiting(BootstrapRateLimitPolicy)`.

## Out of Scope

Any change to `identity-auth-roles/02/03/05/06/07`'s existing endpoints or entities — this is an
**additive** slice alongside them, sharing their services/hashers by reference, not editing their files.
A general-purpose multi-tenant provisioning API (explicitly not this — see Context). Removing or
disabling this endpoint once bootstrapped (story 06 covers the operational decision of whether/how it
stays gated in a real deployment). The staff-console CSV import UI (already built, `AccountImport.tsx`)
— this endpoint's optional single-`Account` convenience does not replace it.

## Technical Notes

World: **backend, ops-only** (no participant- or staff-session gate — the secret header *is* the gate,
by design, since no session can exist yet). New slice:
`src/Pulse.WebApi/Features/Ops/Bootstrap/` (`BootstrapEndpoints.cs`, `BootstrapOptions.cs` mirroring
`DynamisIdentityProviderOptions`'s shape, `BootstrapService.cs`). Reuses (does not fork):
`ISharedCredentialHasher`/`SharedCredentialPasswordGenerator` (story 06/07), `AccountProvisioningService`'s
sanitization path (story 02), `DynamisIdentityProviderOptions` to resolve the named staff identity's
external subject (story 05 of `identity-auth-roles`). New `PulseDbContext` writes only (no schema change
— `Exercise`, `StaffUser`, `StaffAssignment`, `Account`, `SharedCredential` all already exist). Follows the
`Features/Social/*` minimal-API endpoint-extension pattern; route base `/api` (namespaced `/api/ops/*` to
read distinctly from `/api/staff/*`). `Program.cs` wiring is a single orchestrator-owned `AddOpsBootstrap()`
+ `MapBootstrapEndpoints()` pair, same as every other B2 slice. See `docs/features/login/implementation.md`
for the reuse map and Wave-1 slot.

## Dependencies

`identity-auth-roles/02` (`AccountProvisioningService`, Complete), `/05`
(`DynamisIdentityProviderOptions`, Complete), `/06`/`/07` (`ISharedCredentialHasher`,
`SharedCredentialPasswordGenerator`, Complete). No dependency on stories 01–04 of this feature (backend-
only, runs in parallel with the frontend Wave-1 story). Consumed by story 06 (the runbook that actually
calls this endpoint against UAT).

## Tests

- Integration: an unconfigured (empty) `Authentication:Bootstrap:Secret` makes the endpoint reject every
  call with `404`, regardless of the presented header.
- Integration: a correct secret + a fresh hostname creates one `Exercise`; calling again with the same
  hostname returns the same exercise, not a duplicate (idempotency).
- Integration: bootstrapping a `StaffAssignment` for an allowlisted username unblocks
  `POST /api/auth/staff/login` for that username against the newly created exercise on the next call.
- Integration: the `SharedCredential` created here authenticates via `POST /api/auth/shared` using the
  one-time plaintext password returned in the bootstrap response.
- Security: the bootstrap secret comparison is constant-time (timing-attack test, mirroring
  `SharedCredentialHasherTests`'s precedent); the secret is never present in logs.
- Telemetry: a successful bootstrap emits the `exercise.bootstrapped` XC-004 event.
