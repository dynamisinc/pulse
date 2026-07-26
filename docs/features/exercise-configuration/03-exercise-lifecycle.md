# Story: Exercise lifecycle state machine

**Feature:** Exercise configuration  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-032  ·  **Design decisions:** none  ·  **Issue:** #69
**Review tier:** Tier-2 (schema/contract change, `docs/ORCHESTRATION_MECHANICS.md` §3) — **sign-off GIVEN** (see "Reconciliation decision")

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

COR-032 specifies six different states. That clash has now been **reconciled by an explicit human
decision** (below) — it is not an open question, and it is not resolved inside this story's diff. The
hard constraint that shaped the decision: `src/frontend/src/core/exerciseContext/exerciseContextResolver.ts`
validates `status` against `EXERCISE_STATUSES` and **fails closed on an unknown value** — the provider
then resolves nothing and the participant shell renders nothing. Writing `"staged"` into the existing
column against an un-widened client is a blank participant world, not a type error.

Consumers of the vocabulary today (the migration surface story 01a works through — verified in-repo):
`Data/PulseDbContext.cs` (`HasDefaultValue("scheduled")`), `ExerciseScopeDto.FromExercise`,
`Features/Ops/Bootstrap/BootstrapService.cs` (seeds `Status = "active"`),
`core/exerciseContext/exerciseContextResolver.ts` (`ExerciseStatus` union + `isExerciseStatus` guard,
re-exported via `core/exerciseContext/index.ts`).

### Reconciliation decision — **Option B: widen the frozen vocabulary.** Tier-2 sign-off GIVEN.

Two options were on the table: **A**, a distinct lifecycle column with `Status` kept as a lossy
projection of it; **B**, `Status` itself carrying COR-032's six, with `ExerciseStatus`,
`isExerciseStatus`, the DbContext default, the bootstrap seed and existing rows all migrated.

**The decision is B**, taken by the human, whose reasoning was:

- UAT is an expendable playground that can be blown away at any time, so the data-migration cost is
  ~zero — Option A's main advantage evaporates.
- `scheduled | active | complete | archived` is a **placeholder that predates COR-032**, not a
  requirement. COR-032 is the requirement. Option A would permanently layer a lossy projection over a
  known-wrong vocabulary on the platform's aggregate root.
- Option A's lossiness is substantive, not cosmetic: nothing downstream could ever ask the exercise
  record itself "Staged or Live?" — it would have to consult a different endpoint. That is the wrong
  shape for the aggregate root's own status field.
- E1 is the foundation epic; it was chosen precisely because it is load-bearing, so it gets done right.

**Tier-2 human sign-off for this frozen-contract change has been given** (`docs/ORCHESTRATION_MECHANICS.md`
§3). It is therefore **no longer an orchestration gate** blocking wave 1, and the reach into files
nominally owned by `exercise-isolation/08` (the `ExerciseScopeDto` / resolver seam) is sanctioned — that
reach *is* Option B.

**Where the change actually lands:** not here. The sole-migration-author rule puts the `Status` column
change, the data migration, the `PulseDbContext` default, the `BootstrapService` seed, the additive
frontend guard widening and the `ExerciseScopeDto` pass-through in **story 01a's single migration**
(wave 1). This story layers behavior onto a column that already carries the right vocabulary. The
authoritative string literals are in `implementation.md` → "Lifecycle string literals" — use those exact
strings; do not coin variants.

### ⚠ Residual risk that survives Option B — split-deploy ordering

UAT is a **split deployment** (Azure SWA frontend + App Service backend) whose two halves deploy
independently. A **backend-ahead-of-frontend** deploy writes `staged` / `live` / `paused` into a client
whose `isExerciseStatus` guard fails closed on unknown values → **a blank participant world, not a type
error**.

The mitigation is ordering discipline, and it is cheap because the client change is purely additive:
**widen the frontend `EXERCISE_STATUSES` / `isExerciseStatus` guard FIRST (wave 1, story 01a), then let
the backend emit the new values.** The widened client accepts both the legacy and the COR-032
vocabularies during the transition, so no deploy order can strand it. Retiring the legacy four literals
is a later cleanup, deliberately not bundled here.

### Where the lifecycle is observed
The already-frozen participant-shell endpoints are the surfaces this state machine drives (constants
today, per-exercise data after this story — **same wire shapes, no consumer change**):
- `GET /api/shell-state` → `ShellStateResponse { variant }`, hardcoded `"full"`. The lifecycle decides
  the variant (`full | readOnly | kiosk | preview`).
- `GET /api/overlay-state` → `OverlayStateResponse { state, register, message }`, hardcoded
  `none` / `in-fiction`. **Paused** is where the configurable holding page comes from
  (`state: pause`, `register: in-fiction | out-of-fiction`).

## Acceptance Criteria
- [ ] Given the Option-B vocabulary already shipped by story 01a, when this story reads or writes a
      lifecycle state, then it uses the authoritative literals from `implementation.md` verbatim and
      introduces **no second vocabulary, no parallel lifecycle column and no projection layer**.
- [ ] Given an exercise, when its lifecycle state is read, then it is one of Build / Staged / Live /
      Paused / Completed / Archived, and only the transitions COR-032 allows succeed; a disallowed
      transition is rejected with a 409 and no state change.
- [ ] Given a participant request, when the exercise is in Build / Completed / Archived, then the
      participant surface is **not served** (fail closed) — enforced by this story's exported
      **`UseExerciseLifecycleGating()`** middleware covering `/api/feed`, `/api/threads/{id}`,
      `/api/personas`, `POST /api/posts` and all six participant-shell config GETs; **Staged** and
      **Live** are the only participant-accessible states. A shell **variant** change alone does not
      satisfy this AC — a projection cannot refuse service, and `/api/feed` must not still return posts.
- [ ] Given staff and evaluator sessions, when the exercise is in Build (or any non-participant state),
      then gating does **not** apply to them — staff working in Build is the point of Build — and the
      pre-auth allowlist (`/api/exercise-context`, login) is never gated.
- [ ] **The overrides actually resolve (projection-override contract):** given a fully composed service
      provider wired in the orchestrator's order, when `IShellVariantProjection` and
      `IOverlayStateProjection` are resolved, then this story's implementations come back — registered
      via `services.Replace(...)`, **never `TryAddScoped`, which against 01b's already-present default is
      a silent no-op that leaves the constant serving** — and drive `/api/shell-state` and
      `/api/overlay-state` end to end.
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
COR-050); the holding-page **content authoring** UI; EndEx specifics (exercise-clock COR-054); **any
schema or migration work** (story 01a owns it — including the `Status` vocabulary); reshaping any frozen
DTO.

## Technical Notes
**Backend / staff world.** Foundation state machine other features subscribe to; Staged vs Live is the
key distinction. **This story authors no schema and no migration** — story 01a's single migration
already delivers the widened `Status` column, so this story is transition rules, gating, projections and
telemetry only.

Everything it ships lives under `Features/ExerciseConfiguration/Lifecycle/`: the state machine, the two
projection implementations (registered with `services.Replace(...)` — see implementation.md's
projection-override contract), and the `UseExerciseLifecycleGating()` middleware the orchestrator wires
into `Program.cs`. It adds no `Map*` and **edits no other slice's endpoint file**. Do not read
`statePillConfig.ts`'s `scheduled ≡ staged` alias as a lifecycle mapping — the authoritative legacy→new
mapping is implementation.md's table.

### The `/api/overlay-state` collision is known, accepted and yours to reconcile
The unmerged `feature/world-steering-wave2` umbrella rewrites the `/api/overlay-state` handler in
`Features/ParticipantShell/ParticipantShellEndpoints.cs` into a real write path with SignalR push, and
edits `Program.cs`. The human has decided to **proceed on all waves and absorb the conflict at merge
time** rather than sequence around it. Two things follow for this story's builder:

- The textual conflict surface is small and known: world-steering rewrites **only** the
  `/api/overlay-state` handler. `chrome-config`, `brand-tokens`, `channel-nav-config` and `shell-state`
  are untouched by it.
- **The semantic conflict is the real one.** World-steering's CTL-023 Freeze and COR-032's Paused
  holding page target the **same surface and the same register** (`OverlayStateResponse`'s `state` /
  `register`). Do **not** add a second, parallel pause mechanism alongside it: reconcile explicitly —
  decide and document how a COR-032 `Paused` lifecycle state and a CTL-023 Freeze compose into one
  overlay state, and route through world-steering's write path rather than beside it.

See implementation.md → "Integration hazards" and (story 03).

## Dependencies
Story 01a and 01b — **both shipped, merged and wired** (the widened `Status` vocabulary, the single
migration, the settings slice, the constants→projection refactor of the shell-config endpoints, and the
`IShellVariantProjection` / `IOverlayStateProjection` seams with their constant-preserving defaults, all
on disk); `exercise-isolation/04` (#47, **Complete** — the participant route guard and the session-kind
seam the gating middleware reads to leave staff/evaluator sessions alone); `world-steering` Wave 2's
overlay-state write path — **a merge-time reconciliation, not a scheduling blocker** (decision recorded
above). Consumed by exercise-build-golive (transitions),
exercise-clock (Live starts the clock), E8 (dormant until Live).

### `exercise-isolation/06` (#49) is a **mutual** dependency — here is the split
`/06` (archived separation) is **Not Started** and names "exercise lifecycle (exercise-configuration
COR-032)" as *its* dependency, while this story names `/06`. The cycle is resolved by splitting the
Archived behavior, not by sequencing:

- **This story owns now:** the `archived` state, the transitions into it, and **participant access
  refusal** while in it (the gating middleware). Nothing data-layer.
- **`/06` owns later:** archived content never appearing in any *other* exercise's live queries, and the
  self-contained AAR-exportable set — a query/scoping concern layered on the central filter.

So: **do not invent a parallel archived-exclusion query mechanism**, and do not carry an AC asserting
cross-exercise archived exclusion — this story cannot meet one. `/06` builds that against the state
shipped here.

## Tests
- Unit: allowed transitions enforced; disallowed transitions 409 with no state change.
- Integration: in Build/Completed/Archived a participant session gets **no service** from `/api/feed`,
  `/api/threads/{id}`, `/api/personas`, `POST /api/posts` or the six shell GETs (assert the feed
  specifically — that is the AC a variant-only implementation would fake); staff/evaluator sessions and
  the pre-auth allowlist are unaffected; Paused serves the holding page through the frozen
  overlay-state shape.
- DI: the contributed shell-variant and overlay-state projections win from a fully composed provider.
- Contract: `/api/exercise-context`, `/api/shell-state` and `/api/overlay-state` responses still satisfy
  the frontend runtime guards once real lifecycle values flow through them (the regression that proves
  story 01a's widened guard actually covers what this story emits).
- Telemetry: a transition emits exactly one v0 envelope with from/to states and the acting human.
- Overlay composition: a COR-032 `Paused` state and a CTL-023 Freeze produce **one** coherent overlay
  state, not two competing ones.
