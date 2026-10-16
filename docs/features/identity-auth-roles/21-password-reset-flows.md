# Story: Password reset flows (CredentialToken, forgot, admin reset, temporary password)

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-011, COR-017, COR-012, NFR-009  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §3.2, §3.3, §3.4  ·  **Issue:** #576
**Stack:** fullstack  ·  **Review tier:** Tier-2 (security)  ·  **Wave:** A2

## Context
Staff and participants need to recover access without Dynamis support ([`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §3.2, §3.3). Introduces the `CredentialToken` table, forgot/reset routes, admin reset, the one-time temporary password, and the NIST 800-63B password policy.

## Acceptance Criteria
- [ ] **Policy (§3.2).** Given a new password, then staff/org-admin require 12+ characters, participant-only/one-off 8+, max 128, no composition rules, a top-10k blocklist plus org name/email local-part/display name; violations return a specific, non-leaking error. Promotion keeps the old password valid until next change.
- [ ] **Lockout.** 5 failures lock 15 min, doubling to a 4 h cap, per Person/Account, plus the per-IP limiter (#480).
- [ ] **Forgot.** `POST /api/auth/password/forgot {email, orgSlug?}` always returns 202 with the same body and similar timing whether or not the email exists, is rate-limited per email hash and per IP, and (no slug) sends **one** email with one reset link per org where the email has a `Person`. Link is `https://<host>/reset#token=...` (fragment, never in logs).
- [ ] **Reset.** `POST /api/auth/password/reset {token, newPassword}` redeems a single-use token (reset 60 min, invite 7 days), sets the password, **revokes every live session** for that person/account and emits `identity.credential.changed`. Issuing a new token voids earlier unused tokens of the same purpose. An expired/used token returns the uniform error.
- [ ] **Admin reset.** An org admin resets staff; a planner or controller resets participants in their exercise. The action **emails a reset link**; staff never see or choose another person's password. Evaluator is refused.
- [ ] **Temporary password.** For a participant with no email, a planner/controller can mint a one-time temporary password: shown once, valid for one sign-in, forces a change on first use.
- [ ] **Participant forgot** is served from the exercise host in the participant skin and only when the exercise allows the Password method (story 22) and an email exists; otherwise 202 with nothing sent.
- [ ] `Cache-Control: no-store` on both routes (also story 26 / #485). Tokens are stored only as SHA-256 hashes.
- [ ] Isolation (XC-001/002, COR-001/002/007; brief C5): every new route has a foreign-exercise test **and** a foreign-org test; a cross-tenant id returns the same bare 404 as a missing id (the bare-404 pattern, design doc §7.2); id-taking org routes join the `CompositionRootWiringTests` allow-list.
- [ ] Telemetry (XC-004): the action emits an event (wall + scenario time, acting `PersonId` and role, channel `system`) per the v0 schema, in the same unit of work as the mutation.
- [ ] Two worlds: staff reset page uses COBRA; the participant reset page uses the exercise brand skin, no COBRA, no default MUI look, mobile-first; no internal exercise name shown (#376).
- [ ] Accessibility (NFR-001): WCAG 2.1 AA; keyboard-operable; status/error states are never color-only; async results announced via a live region.
- [ ] User guide (C5 docs-as-done): `docs/guide/getting-started.md` is updated in the same PR (and `tools/guide-screenshots` if a screen changed), or the PR states "no guide impact". and `troubleshooting.md` (forgot password; temporary password card workflow).

### Copilot review 5 fold (2026-10-16)
- [ ] Any credential change (reset, invite redeemed, temporary password set, password change) invalidates, in the same transaction, **every** outstanding `CredentialToken` of both purposes for that identity, and every unconsumed `LoginChoiceCandidate`. Tests cover reset followed by redeeming an older invite, an older reset link and an older org choice; all three fail.

## Out of Scope
TOTP/MFA for org admins; HIBP breach check (#490); participant reissue of links/day word (easy-login, unchanged).

## Technical Notes
Both worlds. Paths: `Features/Identity/Credentials/*`, `IPulseMailer` templates (link, invite, reset), `PasswordPolicy` + embedded blocklist, staff `ResetPage`, participant `ParticipantResetPage`. **Orchestrator clearance first:** the wave EF migration, `Program.cs` route-group lines, and `App.tsx` / `staffRouteRegistry.tsx` additive lines go through the orchestrator's end-of-wave wiring commit; builders export one `Add*()`/`Map*()` line and do not edit them.

## Dependencies
Wave A2, after A1. Owns `CredentialToken`; 20 consumes it. Needs 18 (#480) for the IP limiter claim.

## Tests
Policy unit tests; token lifecycle tests (single use, expiry, voiding); anti-enumeration timing/shape test; session-revocation test; foreign-org/exercise route tests; RTL for both reset pages.
