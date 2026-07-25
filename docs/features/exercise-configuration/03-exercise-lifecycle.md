# Story: Exercise lifecycle state machine

**Feature:** Exercise configuration  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-032  ·  **Design decisions:** none  ·  **Issue:** #69
**Review tier:** **Tier-2 — human sign-off required** (schema/contract change, `docs/ORCHESTRATION_MECHANICS.md` §3)

## Context
The exercise lifecycle: **Build → Staged → Live → Paused → Completed (EndEx) → Archived** (COR-032).
Build is staff-only content development; Staged opens participant access to the ambient world before
the scenario starts; Live is post-StartEx with the clock running; Paused shows a configurable holding
page. Participants access Staged and Live only.

### ⚠ Frozen-contract hazard — read before writing a line of code

`Exercise.Status` **already exists** (`src/Pulse.WebApi/Data/Entities/Exercise.cs`) and stores a
**different, frozen vocabulary**: `scheduled | active | complete | archived`. Its XML doc states it is
stored *"verbatim as the frozen frontend vocabulary (`exerciseContextResolver.ts`)"*, and
`Features/ExerciseResolution/ExerciseScopeDto.FromExercise` projects it straight onto the **frozen**
`ExerciseScope.status` wire field served by `GET /api/exercise-context`.

COR-032 specifies six different states. **These two vocabularies must be reconciled explicitly by this
story — a builder must not quietly widen the stored column.** The hard constraint:
`src/frontend/src/core/exerciseContext/exerciseContextResolver.ts` validates `status` against
`EXERCISE_STATUSES` and **fails closed on an unknown value** — the provider then resolves nothing and
the participant shell renders nothing. Writing `"staged"` into the existing column with today's client
deployed is a blank participant world, not a type error.

Known consumers of the vocabulary today (verify before changing anything):
`Data/PulseDbContext.cs` (`HasDefaultValue("scheduled")`), `ExerciseScopeDto.FromExercise`,
`Features/Ops/Bootstrap/BootstrapService.cs` (seeds `Status = "active"`),
`core/exerciseContext/exerciseContextResolver.ts` (`ExerciseStatus` union + `isExerciseStatus` guard,
re-exported via `core/exerciseContext/index.ts`).

**The two options this story must choose between (and record the choice + rationale in the story before
building):**

| | **Option A — distinct lifecycle column + projection** | **Option B — widen the frozen vocabulary, migrate consumers** |
|---|---|---|
| Shape | New `LifecycleState` column carrying the COR-032 six; `Status` stays as-is and becomes a **derived projection** of it (e.g. Build→`scheduled`, Staged/Live/Paused→`active`, Completed→`complete`, Archived→`archived`). | `Status` itself carries the COR-032 six; `ExerciseStatus`, `isExerciseStatus`, `ExerciseScopeDto` docs, the DbContext default and the bootstrap seed all move with it, plus a data migration for existing rows. |
| Pros | No wire break; `/api/exercise-context` and its runtime guard are untouched; no cross-feature file edits; deployable in any order. | One vocabulary, no lossy mapping, no dual-write drift. |
| Cons | Two vocabularies to keep in sync; the projection is **lossy** — Staged / Live / Paused all collapse to `active`, so any consumer needing that distinction must read a different signal (`/api/shell-state`, `/api/overlay-state`), which must then be stated explicitly. | Breaks a frozen wire contract *and* its fail-closed client guard: an un-upgraded client blanks the participant shell. Requires a coordinated frontend+backend deploy and edits files owned by other features (`exercise-isolation/08`). |

Whichever is chosen, these invariants hold: `GET /api/exercise-context` keeps returning a value the
deployed client's guard accepts; the participant-shell DTOs are not reshaped; and the decision is
recorded here with its rationale. **This is a schema/contract change — Tier-2 human sign-off before
merge; do not decide it inside a build agent.**

### Where the lifecycle is observed
The already-frozen participant-shell endpoints are the surfaces this state machine drives (constants
today, per-exercise data after this story — **same wire shapes, no consumer change**):
- `GET /api/shell-state` → `ShellStateResponse { variant }`, hardcoded `"full"`. The lifecycle decides
  the variant (`full | readOnly | kiosk | preview`).
- `GET /api/overlay-state` → `OverlayStateResponse { state, register, message }`, hardcoded
  `none` / `in-fiction`. **Paused** is where the configurable holding page comes from
  (`state: pause`, `register: in-fiction | out-of-fiction`).

## Acceptance Criteria
- [ ] **Reconciliation recorded first:** given the frozen `Status` vocabulary above, when this story
      starts, then the chosen option (A or B) and its rationale are written into this file and signed
      off by a human (Tier-2) — and `GET /api/exercise-context` continues to return a value the
      deployed `isExerciseStatus` guard accepts.
- [ ] Given an exercise, when its lifecycle state is read, then it is one of Build / Staged / Live /
      Paused / Completed / Archived, and only the transitions COR-032 allows succeed; a disallowed
      transition is rejected with a 409 and no state change.
- [ ] Given a participant request, when the exercise is in Build / Completed / Archived, then the
      participant surface is not served (fail closed); **Staged** and **Live** are the only
      participant-accessible states.
- [ ] Given the exercise is **Paused**, when a participant's shell resolves, then `GET /api/overlay-state`
      returns the configurable holding page (`state: pause` with the configured `register` and
      `message`) in the **unchanged frozen `OverlayStateResponse` shape**, and `GET /api/shell-state`
      returns the variant the lifecycle dictates in the unchanged frozen `ShellStateResponse` shape.
- [ ] Given each state, when another subsystem reads it, then the documented behavior hooks are exposed
      for build/go-live, the clock and the engine to consume (e.g. Staged: clock not started, scheduled
      content held) — as a server-side seam, not a duplicated copy of the state per feature.
- [ ] **Telemetry (XC-004):** given a lifecycle transition, when it is performed by a staff/Director
      account, then one v0 telemetry envelope is emitted carrying wall + scenario time, the acting
      human, and the from/to states.
- [ ] **Isolation (XC-001/002, COR-001):** given a lifecycle read or transition, when it is handled,
      then the exercise comes from the server-resolved scope and never a client parameter; a
      cross-exercise transition attempt returns 403/404 and extends the standing isolation suite.

## Out of Scope
The gated go-live/StartEx actions themselves (exercise-build-golive COR-043); the clock (exercise-clock
COR-050); the holding-page **content authoring** UI; EndEx specifics (exercise-clock COR-054); the
controller's tiered pause / Freeze (E7 CTL-023 — `world-steering`, in flight; this story consumes the
overlay-state write path it introduces rather than competing with it); reshaping any frozen DTO.

## Technical Notes
**Backend / staff world.** Foundation state machine other features subscribe to; Staged vs Live is the
key distinction. The lifecycle column ships in **story 01's single migration** (feature.md
"Single-migration rule") — this story adds behavior, not schema, unless option B's data migration is
signed off, in which case it is authored as a second, serial migration after story 01's has merged.

**In-flight collision:** the unmerged `feature/world-steering-wave2` umbrella rewrites
`Features/ParticipantShell/ParticipantShellEndpoints.cs`, making `/api/overlay-state` a real write path
with SignalR push, and edits `Program.cs`. This story must land **after** that work integrates and
build on it. See implementation.md → "Integration hazards".

See implementation.md (story 03).

## Dependencies
Story 01 (settings slice, the lifecycle column in its migration, the constants→service refactor of the
shell-config endpoints); `exercise-isolation/04` + `/06` (participant route guard, archived separation);
`world-steering` Wave 2 (the overlay-state write path). Consumed by exercise-build-golive (transitions),
exercise-clock (Live starts the clock), E8 (dormant until Live).

## Tests
- Unit: allowed transitions enforced; disallowed transitions 409 with no state change.
- Integration: participants blocked outside Staged/Live; Paused serves the holding page through the
  frozen overlay-state shape.
- Contract: `/api/exercise-context`, `/api/shell-state` and `/api/overlay-state` responses still satisfy
  the frontend runtime guards after the change (the regression that catches a silent vocabulary widen).
- Telemetry: a transition emits exactly one v0 envelope with from/to states and the acting human.
