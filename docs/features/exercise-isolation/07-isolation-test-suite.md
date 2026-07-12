# Story: Standing cross-exercise isolation test suite

**Feature:** Exercise isolation  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-007  ·  **Design decisions:** none  ·  **Issue:** #50

## Context
Isolation is not asserted once — it is a **standing test suite** that attempts cross-exercise access on
every participant-facing endpoint, extended as endpoints are added, and includes stored-XSS attempts
(COR-007, NFR-004). This is the guardrail that keeps the worst-possible failure from regressing.

## Acceptance Criteria
- [ ] A dedicated isolation test suite attempts cross-exercise access on each participant-facing
      endpoint and asserts it fails closed (403/404 / empty).
- [ ] The suite includes **stored-XSS** attempts (a script in a post) and asserts it never executes in
      another session (NFR-004).
- [ ] Adding a new participant-facing endpoint without a corresponding isolation test is treated as a
      gap (documented convention; enforced in review by `code-review`).
- [ ] The suite runs as part of the normal test run and gates once CI exists.

## Out of Scope
CI setup itself (none yet — flag when added); the endpoints under test (each channel's own stories).

## Technical Notes
Foundation/testing. Grows with the API surface — every new participant endpoint gets an isolation case.
Coordinate with `testing-agent`. See implementation.md (story 07).

## Dependencies
Stories 01/02 (the guarantees under test); endpoints from E2–E6 as they land.

## Tests
- This story *is* the test suite: cross-exercise read attempts fail closed; stored-XSS never executes
  cross-session.
