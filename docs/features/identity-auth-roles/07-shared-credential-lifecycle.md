# Story: Shared-credential lifecycle (rotate / revoke / lockout)

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-016 (NFR-009)  ·  **Design decisions:** none  ·  **Issue:** #64

## Context
The shared read-only password is an internet-facing shared secret on a public hostname and is treated
as such. It supports rotation (announce + grace window), immediate revocation (kills all read-only
sessions), brute-force lockout, and per-IP rate limiting (COR-016, NFR-009).

## Acceptance Criteria
- [ ] The shared password can be **rotated** with an announce + grace window (old password works during
      the grace period, then stops).
- [ ] **Immediate revocation** kills all active read-only sessions at once.
- [ ] Brute-force **lockout** and **per-IP rate limiting** protect the shared-credential login.
- [ ] Lifecycle actions are staff-only (XC-002) and logged (XC-004).

## Out of Scope
The read-only session itself (story 06); posting-endpoint rate limits for named accounts (NFR-009,
handled where posting is built, E2).

## Technical Notes
Security foundation. Treat the shared secret as internet-facing. See implementation.md (story 07).

## Dependencies
Story 06 (the credential/session it governs). Realizes NFR-009 for the shared credential.

## Tests
- Integration: rotation with grace window; revocation kills sessions; lockout + per-IP rate limit
  trigger under brute force.
