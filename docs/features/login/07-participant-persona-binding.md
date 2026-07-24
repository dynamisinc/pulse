# Story: Participant persona binding — provision a participant account with a posting persona

**Feature:** Login  ·  **Epic:** E1 — Platform Core & Exercise Isolation  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-011, COR-018, SOC-001, SOC-003 (COR-001, COR-015)  ·  **Design decisions:** none  ·  **Issue:** #342

## Context
A participant can now SEE engine-approved and manual-persona posts in the feed (PR #338), but a participant cannot CREATE a post, because their account has no bound persona. `Account.PersonaId` is nullable and nothing in the ops/bootstrap surface ever sets it: the `bootstrap-exercise` participant sub-request (`BootstrapParticipantAccountRequest`) has no `personaId` field, and `BootstrapService` never assigns one. So `ParticipantLoginService` issues a session with `personaId` null, the frontend `canPost` is false, and the composer stays hidden ("Posting isn't available on this account"). This is the remaining half of the participant compose flow that PR #338 wired end to end but which is inert without a bound persona; today the only way to bind one is a manual `UPDATE Accounts SET PersonaId = ...`.

## Acceptance Criteria
- [ ] The `bootstrap-exercise` participant-account sub-request accepts an optional `personaId` (a seeded persona instance id) and persists it onto `Account.PersonaId`, validated to belong to the same exercise (COR-001) and to an existing persona.
- [ ] Alternatively or additionally, a guarded ops endpoint binds (or rebinds) a persona to an existing participant account by username, with the same secret gate and fail-closed scope as the other ops endpoints.
- [ ] Given a participant whose account has a bound persona, when they sign in, then `Session.personaId` is populated, the participant composer is available, and a post they publish persists via `POST /api/posts` (origin `participant`) and reaches other participants (PR #338).
- [ ] Given a participant account with no bound persona, the composer remains absent (COR-015 observer style), never a broken or enabled control.
- [ ] The binding is auditable (XC-004) and never lets a participant post as a persona from another exercise (COR-001).

## Out of Scope
- Letting a participant choose or switch personas at runtime (this is provisioning-time binding).
- Controller post-as-persona (persona-operation, already shipped).
- Any change to `POST /api/posts` itself (the write path already accepts an `authorPersonaId`; this story is about provisioning the account to have one).

## Technical Notes
`Account.PersonaId` (nullable) and `ParticipantLoginService` already carry the persona through to `Session.personaId`; the gap is purely provisioning. Prefer extending the bootstrap participant sub-request (least new surface) plus a small rebind ops endpoint for already-provisioned accounts. Validate the `personaId` against the exercise's seeded persona cast (`Personas`), fail closed on a cross-exercise or unknown id.

## Dependencies
Login story 05 (the bootstrap seam, #308) that this extends; engine-content-seed (the persona cast a participant would be bound to); PR #338 (the participant compose + feed write path this makes reachable).

## Tests
- Backend: bootstrap with a `personaId` binds it; login returns the `personaId`; a cross-exercise `personaId` is rejected; a missing binding yields a null-persona session.
- Frontend: with a bound persona the composer is available and publishes live; without one it stays absent.
