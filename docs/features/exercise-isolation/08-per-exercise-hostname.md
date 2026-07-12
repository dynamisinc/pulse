# Story: Per-exercise hostname (subdomain)

**Feature:** Exercise isolation  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-008  ·  **Design decisions:** none  ·  **Issue:** #51

## Context
Each exercise gets its own subdomain (e.g. `atl-cie.{platform-domain}.com`), optionally a
customer-branded domain (the Looking Glass pattern). The hostname scopes the participant session's
exercise, is the participant's only entry point (URL + shared password is the entire onboarding), and
no shared/marketing domain is ever participant-visible (COR-008).

## Acceptance Criteria
- [ ] A participant reaching an exercise's hostname has their session scoped to that exercise (pairs
      with story 04 — no exercise picker).
- [ ] No shared or marketing domain is participant-visible; the exercise hostname + shared credential
      (COR-015) is the complete onboarding.
- [ ] Hostname/certificate/DNS provisioning is automated (wildcard/automated cert + DNS) with a stated
      lead-time SLA.
- [ ] An optional customer-branded domain is supported per exercise.

## Out of Scope
The shared credential itself (identity-auth-roles COR-015); network-filter readiness (story 09); the
landing surface (story 04 / E2).

## Technical Notes
Foundation/infra. Wildcard + automated certificate/DNS provisioning; the host maps to an exercise for
session scoping. Backend/infra-heavy — frontend resolves exercise from host. See implementation.md
(story 08).

## Dependencies
Hosting/infra (Azure); story 04 (host-scoped routing); COR-015 shared credential.

## Tests
- Integration: a request to an exercise host resolves to that exercise's scope; unknown host is
  rejected.
