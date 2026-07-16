# Story: Mock ExerciseContext provider (Wave-0 frontend seam)

**Feature:** Exercise isolation  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-001, COR-004 (XC-001, XC-002)  ·  **Design decisions:** none  ·  **Issue:** —

## Context
Every participant-facing frontend module needs a single, trustworthy answer to "which exercise is this
session in" before it can render anything — the frontend half of the central-scoping guarantee
(COR-001) and the "no exercise selection" guarantee (COR-004). Story 01 defines the backend
query-filter/interceptor; story 04 defines the participant router with no picker, host-resolved from
the per-exercise hostname (story 08) and auth. Neither, on its own, gives Wave-0 frontend code a
**standalone** provider to build against today. This story delivers that seam now, behind a mock
resolver, so it — and the scenario-time and telemetry seams building in parallel — can be built and
consumed in isolation before the hostname/auth wiring (story 04/08) lands. It is deliberately narrow:
it resolves and exposes exactly one exercise's scope; it does not decide *which* exercise from a host
or session (that is story 04's later extension of this same module).

## Acceptance Criteria
- [ ] Given the app is wrapped in `ExerciseContextProvider`, when any descendant calls
      `useExerciseContext()`, then it receives `{ exerciseId, exerciseName, timeZone, status }` for
      exactly one exercise, resolved via a mock `resolveExerciseContext()` routed through the shared
      axios client (`core/services/api.ts`).
- [ ] Given no provider is mounted, when a component calls `useExerciseContext()`, then it **throws**
      (fail-closed) rather than returning `undefined`, a default scope, or an aggregate scope.
- [ ] The provider exposes no exercise list, no picker, and no simulation-status/admin surface —
      `useExerciseContext()` returns a single bound scope only, never a collection (COR-004, XC-002).
- [ ] Given the mock resolver fails or returns no scope, when the provider initializes, then it fails
      closed (an error/guard state) — never falling back to an unscoped or cross-exercise render
      (COR-001, XC-001).
- [ ] `exerciseId` and `timeZone` are plain, stable fields on the returned scope, shaped so the
      scenario-time and telemetry seams can consume them later from their own call sites — without this
      module reaching into either.

## Out of Scope
Host/subdomain resolution (story 08); the real auth-derived session scope (story 04, which **extends**
this module rather than replacing it); the staff cross-exercise switcher (story 05); any real backend
endpoint (mock only at this phase — a single fixed exercise); wiring `timeZone`/`exerciseId` into
`scenarioTime`/telemetry (that happens in the *consumers* later — the shell mount contract, `PostCard`,
etc. — not in this module).

## Technical Notes
World: **platform/foundation** — a pure `core/` module, no UI chrome, no COBRA, no participant skin.

Deliverable: `src/frontend/src/core/exerciseContext.tsx` exporting `ExerciseContextProvider` and
`useExerciseContext()`. The mock `resolveExerciseContext()` returns one fixed exercise (id, name,
time zone, status) via `core/services/api.ts` — a mocked response today, swappable for a real endpoint
later with no consumer changes.

**Decoupled at v0; wired at the edges later.** This provider must **not** import the scenario-time
clock (`core/clock/`) or the telemetry emitter (`core/telemetry/`) — the three foundation seams
(this one, `exercise-clock/04`, `telemetry/01`) build in parallel, in isolated worktrees, and none may
import another at v0. `exerciseId` and `timeZone` are exposed on the context value precisely so that
*consumers* — the shell mount contract, `PostCard`, etc. — can later call
`formatScenarioTime(instant, timeZone)` and stamp telemetry envelopes with `exerciseId` themselves; this
module has no knowledge of either seam.

See `implementation.md` (story 10) for the reuse-map update and the note on story 04's later extension
of this file.

## Dependencies
None (Wave 0). Story 04 later extends this module with host-resolution + a participant route guard;
story 08 (hostname) and auth feed story 04, not this story.

## Tests
- Unit: `useExerciseContext()` outside a provider throws; inside a provider it returns a single scope
  object with `exerciseId`/`exerciseName`/`timeZone`/`status`; a failed/empty mock resolution fails
  closed (no default/aggregate scope is ever rendered).
