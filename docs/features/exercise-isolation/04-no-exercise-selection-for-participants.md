# Story: Participants have no exercise-selection concept

**Feature:** Exercise isolation  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** COR-004  ·  **Design decisions:** none  ·  **Issue:** #47
**Stack:** frontend  ·  **Review:** Tier-1

## Context
Participants never choose or perceive an exercise. Login lands directly in their exercise's landing
surface (the Social feed in pilot mode, the Portal in Phase 3), and an account belongs to exactly one
exercise (COR-004, XC-002).

**Phase B2 make-real (`docs/BACKEND_ROADMAP.md` §4).** This story now builds on **real** session +
exercise resolution: the frozen `useSession()` (identity-auth-roles/03) and `useExerciseContext()`
(exercise-isolation/08) are live behind their flipped mock seams. This story owns the **participant
landing route guard** — the participant arm of role-aware nav (`app-shell/01`): a resolved participant
(or read-only) session lands on its exercise's landing surface with no picker; a staff role, an
unresolved scope, or an expired session is denied the participant fiction (fail-closed). The read-only
All-Posts default (identity-auth-roles/06) is realized here off the session's `isReadOnly` flag.

## Acceptance Criteria
- [x] Given a participant credential, when they log in, then they land directly in their exercise's
      landing surface — no exercise picker, no exercise list, no simulation-status or admin surface.
- [x] A participant account belongs to exactly one exercise; there is no UI path to switch exercises.
- [x] In pilot mode (pre-Portal) the landing surface is the Social feed (Master §4); the story does not
      hard-code the Portal.
- [x] No participant-facing surface exposes the concept of exercise selection, simulation status, or
      platform administration (XC-002).
- [x] **Make-real route guard:** given a live `useSession()`/`useExerciseContext()`, when the
      participant route mounts, a **participant/PIO** role with a resolved scope renders the landing
      surface; a **staff** role, an **unresolved** scope, or an **expired** session is redirected/denied
      (never rendered into the participant fiction) — fail-closed.
- [x] **Read-only landing:** a session with `isReadOnly: true` (identity-auth-roles/06) lands on **All
      Posts**, never the Following feed (COR-015).

## Out of Scope
The staff switcher (story 05); the actual landing surfaces (E2 feed / E3 portal); the login page
theming (exercise-configuration COR-030).

## Technical Notes
Participant world. Routing resolves the exercise from the session (per-exercise hostname, story 08) —
not from a user choice. See implementation.md (story 04).

Related requirements gap (session 3, COMPONENTS.md divergence #5): participants currently see no
exercise-session identity at all, while the console shows it persistently (COR-005). Whether the
participant frame should carry session identity — without violating this story's "no exercise
concept" ACs — is tracked as `exercise-configuration/05-participant-exercise-identity.md`; the ACs
above are unchanged until that decision lands.

## Dependencies
Story 08 (host resolution + `/exercise-context`, live) and identity-auth-roles/03 (session, live) — both
flipped to their real backends in B2. identity-auth-roles/06 (the `isReadOnly` flag for the All-Posts
default). Consumed by / composed with `app-shell/01` (the participant arm of role-aware nav). Shapes
every participant entry point.

## Tests
- Component/integration: participant login routes straight to the landing surface with no exercise
  picker; no admin/status surface is reachable.

## Delivered (Phase B2)
Built and tested on the B2 Wave-4 merges on `feature/identity-backend`: the participant landing route
guard against the live `useSession()`/`useExerciseContext()` seams — a resolved participant/PIO session
renders the landing surface; a staff role, an unresolved scope, or an expired session is redirected/
denied, fail-closed, with no COBRA chrome ever mounted on the participant path. The read-only
(`isReadOnly: true`) session lands on All Posts, never Following (COR-015). Both code-review gates
(Gate-1, Gate-2) clean; umbrella green — frontend `build:check` clean and the feature's suites green.

Tracked follow-up (not a blocker to Complete):
- **The non-read-only PIO landing default (which feed surface a resolved, non-read-only participant
  lands on) is `feeds-discovery/01`'s call**, layered on by the feed consumer once that story lands —
  this guard routes to the participant landing surface without hard-coding a feed choice.

Markdown status flipped to Complete. Not closing the GitHub issue — it closes when the umbrella→main
PR merges.
