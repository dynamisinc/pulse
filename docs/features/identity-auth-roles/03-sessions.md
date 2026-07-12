# Story: Short-lived exercise-bound sessions

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-012  ·  **Design decisions:** none  ·  **Issue:** #60

## Context
Sessions are short-lived with refresh; a participant session is bound to **one exercise and one
account** (or one read-only session per COR-015) (COR-012). This keeps the session's exercise scope
unambiguous — the anchor the isolation guarantee (COR-001) relies on.

## Acceptance Criteria
- [ ] Authenticated sessions are short-lived with a refresh mechanism; expiry forces re-auth.
- [ ] A participant session is bound to exactly one exercise and one account (or one read-only session,
      story 06); the session carries the exercise scope used by central filtering (exercise-isolation
      story 01).
- [ ] Session tokens do not leak secrets to the browser beyond what's required; refresh is handled
      securely.

## Out of Scope
The shared-credential lifecycle (story 07); the identity provider integration (story 05); force-logout
by controllers (story 08).

## Technical Notes
Foundation. Session encodes exercise + account (or read-only ephemeral identity). See implementation.md
(story 03).

## Dependencies
Story 01 (roles); exercise-isolation (scope binding). Consumed by every authenticated request.

## Tests
- Integration: a session is bound to one exercise/account; refresh works; expiry forces re-auth.
