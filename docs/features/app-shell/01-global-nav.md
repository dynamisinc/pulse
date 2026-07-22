# Story: Role-aware global nav (participant landing + staff entry/switcher)

**Feature:** App shell & role-aware navigation  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** COR-004, COR-005  ·  **Design decisions:** none  ·  **Issue:** —
**Stack:** frontend  ·  **Review:** Tier-1

## Context
Today the app has five flat, hardcoded routes (`/`, `/evaluator`, `/console`, `/shell`, `*`) reachable
only by typing the URL — because there was no session/role/exercise state to route on. Phase B2 lands
that state (real `useSession`/`useRole`/`useExerciseContext` + `StaffAssignment`), so this story replaces
the flat routes with a **role-aware entry**: a **participant/PIO** is routed straight to their exercise's
landing surface with no picker (COR-004); **staff** (controller/evaluator/planner) reach the console /
evaluator surfaces plus the cross-exercise **switcher** (COR-005). This is the E1 nav realization the
roadmap sequences *after* identity (`docs/BACKEND_ROADMAP.md` §4).

## Acceptance Criteria
- [x] Given a resolved **participant/PIO** session, when they enter the app, then they are routed
      directly to their exercise's landing surface (`ParticipantShellRoute` — Social feed in pilot mode)
      — **no exercise picker, no exercise list, no staff surface reachable** (COR-004, XC-002). Composes
      the participant landing route guard (`exercise-isolation/04`).
- [x] Given a resolved **staff** session, when they enter the app, then they reach the staff surfaces
      (console / evaluator) with the **exercise switcher** available (pre-conduct), composing the switcher
      from `exercise-isolation/05` fed by `GET /api/staff/assignments`.
- [x] Given an **unresolved / expired** session, when the app loads, then it fails closed to the login
      entry (or a fail-closed guard state) — never a default surface, never a cross-world surface.
- [x] The nav routes **only** on the resolved role/scope from `useSession`/`useRole`/`useExerciseContext`
      — never on a user-chosen exercise (COR-004); there is no client-supplied `exerciseId` anywhere in
      the routing.

### Cross-cutting
- [x] **Two-worlds (D0 §2):** the participant entry mounts the per-brand skin (COBRA-free by
      construction — no `cobraTheme` ancestor, no default MUI look); the staff entry mounts the COBRA
      `StaffShellFrame` surfaces; the switcher renders **only** on staff surfaces and is impossible to
      confuse with a participant view (XC-002). The nav never mounts COBRA on a participant path or a
      brand skin on a staff path.
- [x] **Accessibility (NFR-001):** the nav and switcher are keyboard-operable with accessible labels;
      **focus is managed on route change** (focus moves to the new surface's landmark, not lost to
      `<body>`); any severity/active-state indication is not color-only.
- [x] **Isolation (XC-001):** no participant-facing nav element exposes exercise selection, simulation
      status, or platform administration (XC-002); the cross-exercise switcher is the single staff-only
      exception (COR-005).

## Out of Scope
The login page + its theming (exercise-configuration COR-030); the backend session/exercise/staff
endpoints (identity-auth-roles/03/05, exercise-isolation/08 — this story *consumes* the live seams); the
participant route guard internals (`exercise-isolation/04`) and the switcher internals
(`exercise-isolation/05`) — this story **composes** them; the conduct-time static identity badge
(console-shell/03, D5-012(g)); the actual mounted surfaces (participant-shell, console, evaluator —
already built); the `App.tsx` route-table edit itself (orchestrator-owned composition-root edit).

## Technical Notes
World: **routing glue** (world-neutral root; world-specific only at hand-off). Owns
`src/frontend/src/features/app-shell/` — a `RoleAwareEntry` component + the route-table contribution
that replaces the five flat routes, reading `useSession()`/`useRole()`/`useExerciseContext()` and
delegating to the participant guard (`exercise-isolation/04`) and staff switcher
(`exercise-isolation/05`). Mounts the **existing** `ParticipantShellRoute` / `EvaluatorDashboardRoute` /
`ControllerConsoleRoute`. MUI 9 `sx`-only on any staff chrome; FontAwesome icons only. The `App.tsx`
route-table swap is the **orchestrator-owned Integration seam** (implementation.md). See implementation.md
(story 01).

## Dependencies
Live seams flipped in B2: identity-auth-roles/03 (`useSession`, `/api/session`), exercise-isolation/08
(`useExerciseContext`, `/api/exercise-context`), identity-auth-roles/05 (`StaffAssignment` +
`/api/staff/assignments`). Composes `exercise-isolation/04` (participant guard) and
`exercise-isolation/05` (switcher). Mounts existing participant-shell / console / evaluator surfaces.

## Tests
- Component/integration: a participant session routes to the landing surface with no picker and no staff
  surface reachable; a staff session reaches console/evaluator with the switcher; an unresolved/expired
  session fails closed to login.
- Two-worlds: the participant entry has no COBRA ancestor; the switcher is absent on participant paths.
- A11y: focus moves to the new surface's landmark on route change; nav + switcher are keyboard-operable.

## Delivered (Phase B2)
Built and tested on the B2 Wave-4 merges on `feature/identity-backend`: the role-aware `RoleAwareEntry` +
route-table contribution, reading the live `useSession()`/`useRole()`/`useExerciseContext()` and
delegating to the participant landing guard (`exercise-isolation/04`) and the staff switcher
(`exercise-isolation/05`). The `App.tsx` route-table swap replacing the five flat routes was the
orchestrator-owned integration edit and is done. Both code-review gates (Gate-1, Gate-2) clean; umbrella
green — frontend `build:check` clean and the feature's suites green.

Incidentally, this integration closed the previously-deferred **WR-002** finding (the participant 404
leaking COBRA staff chrome via the old flat catch-all route) — the role-aware route table replaces that
catch-all with a fail-closed, world-correct guard state.

Tracked follow-ups (not blockers to Complete):
- **The planner role has no Phase-1 surface to route to** — fails closed by design (no dedicated planner
  landing exists yet this phase); revisit once a planner surface lands.
- **The staff switcher mounts as a pre-conduct banner**, not yet docked into `StaffHeader` — that docking
  is a follow-up once `console-shell/03`'s conduct-aware chrome lands.
- **`USE_MOCK_SESSION` / `USE_MOCK_EXERCISE_CONTEXT` remain deferred to backend deployment** — this story
  consumes the live seams' contracts today via the frontend's mock-first posture; flipping to a reachable
  backend is a follow-up integration step, not a gap in this story's build.

No GitHub issue exists for this story (markdown-only, per its header); status is tracked in this file
only.
