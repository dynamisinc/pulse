# Story: Exercise lifecycle state machine

**Feature:** Exercise configuration  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** In Progress
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
- [x] Given the Option-B vocabulary already shipped by story 01a, when this story reads or writes a
      lifecycle state, then it uses the authoritative literals from `implementation.md` verbatim and
      introduces **no second vocabulary, no parallel lifecycle column and no projection layer**.
- [x] Given an exercise, when its lifecycle state is read, then it is one of Build / Staged / Live /
      Paused / Completed / Archived, and only the transitions COR-032 allows succeed; a disallowed
      transition is rejected with a 409 and no state change.
- [x] Given a participant request, when the exercise is in Build / Completed / Archived, then the
      participant surface is **not served** (fail closed) — enforced by this story's exported
      **`UseExerciseLifecycleGating()`** middleware covering `/api/feed`, `/api/threads/{id}`,
      `/api/personas`, `POST /api/posts` and all six participant-shell config GETs; **Staged** and
      **Live** are the only participant-accessible states. A shell **variant** change alone does not
      satisfy this AC — a projection cannot refuse service, and `/api/feed` must not still return posts.
      *(Amended by human decision 2: `completed` serves `/api/overlay-state` and nothing else — see
      "Tier-2 human rulings" below. `build` and `archived` remain fully closed, so this AC's letter holds
      for those two.)*
- [x] Given staff and evaluator sessions, when the exercise is in Build (or any non-participant state),
      then gating does **not** apply to them — staff working in Build is the point of Build — and the
      pre-auth allowlist (`/api/exercise-context`, login) is never gated.
- [x] **The overrides actually resolve (projection-override contract):** given a fully composed service
      provider wired in the orchestrator's order, when `IShellVariantProjection` and
      `IOverlayStateProjection` are resolved, then this story's implementations come back — registered
      via `services.Replace(...)`, **never `TryAddScoped`, which against 01b's already-present default is
      a silent no-op that leaves the constant serving** — and drive `/api/shell-state` and
      `/api/overlay-state` end to end.
- [x] Given the exercise is **Paused**, when a participant's shell resolves, then `GET /api/overlay-state`
      returns the configurable holding page (`state: pause` with the configured `register` and
      `message`) in the **unchanged frozen `OverlayStateResponse` shape**, and `GET /api/shell-state`
      returns the variant the lifecycle dictates in the unchanged frozen `ShellStateResponse` shape.
      *(Met via human decision 3: until it landed, the register was hardcoded `out-of-fiction` and
      dominated everything, so "configurable" was unreachable by construction. The register is now
      CTL-023's to author, which is what COR-032 points at.)*
- [x] Given each state, when another subsystem reads it, then the documented behavior hooks are exposed
      for build/go-live, the clock and the engine to consume (e.g. Staged: clock not started, scheduled
      content held) — as a server-side seam, not a duplicated copy of the state per feature.
- [x] **Telemetry (XC-004):** given a lifecycle transition, when it is performed by a staff/Director
      account, then one v0 telemetry envelope is emitted carrying wall + scenario time, the acting
      human, and the from/to states.
- [x] **Isolation (XC-001/002, COR-001):** given a lifecycle read or transition, when it is handled,
      then the exercise comes from the server-resolved scope and never a client parameter; a
      cross-exercise transition attempt returns 403/404 and extends the standing isolation suite.

### ⚠ Why this is **In Progress**, not Complete — the wiring has not landed

Every AC above is built and proven against a host composed *exactly* as the orchestrator will compose it
(`ExerciseLifecycleTestHost`), but **none of the three composition-root lines is in `Program.cs` yet** —
`Program.cs` is orchestrator-owned and this branch adds nothing to it (`W-001` is the merger's guard, and a
guard written here would be red until the merge). Until those lines land, the following ACs are **inert at
runtime**, however green their tests are:

| Wiring line the orchestrator adds | ACs it activates |
|---|---|
| `builder.Services.AddExerciseLifecycle();` | AC5, AC6 (the two `Replace`d projections; without it 01b's constants keep serving) |
| `app.UseExerciseLifecycleGating();` — **after** `UseExerciseResolution()` and `UseSessionAuthentication()` | AC3, AC4 (unwired, the gate refuses nothing at all) |
| `app.MapExerciseLifecycleEndpoints();` | the HTTP halves of AC2 (the 409), AC8 and AC9 (the staff read/transition pair is 404 until mapped) |

This is the exact failure mode recorded for the bootstrap endpoint (a slice merged fully green with its
`Add*`/`Map*` never called): **grep the composition root after merge.** The story flips to Complete when the
wiring is in `Program.cs`, not before.

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
into `Program.cs`. It **edits no other slice's endpoint file**. Do not read
`statePillConfig.ts`'s `scheduled ≡ staged` alias as a lifecycle mapping — the authoritative legacy→new
mapping is implementation.md's table.

> **Correction (as built).** This paragraph previously read "It adds no `Map*`". That was wrong and
> contradicted both implementation.md (whose file list for this story includes `LifecycleEndpoints.cs`) and
> AC2, which requires an HTTP surface that can return **409** for a disallowed transition. The story ships its
> own `MapExerciseLifecycleEndpoints()` in its **own** folder — `GET /api/staff/exercise-lifecycle` and
> `POST /api/staff/exercise-lifecycle/transition`, both staff-gated by the shared
> `EngineCockpitStaffAuthorizationFilter` and taking **no** exercise id in any form. It still adds nothing to
> 01b's `ExerciseConfigurationExtensions.cs` and maps nothing on any participant route.

### Tier-2 human rulings, folded post-Gate-1 (product decisions, not defect fixes)

Gate 1 came back **clean, 0 Critical** (1056/1056 executed against real SQL). The three changes below are
**human decisions taken on the reviewer's recommendation**, recorded here so the next reader sees *why* the
code looks the way it does and does not "correct" it back.

**Decision 1 — `staged → full`, not `readOnly`.** `readOnly` is not a cosmetic downgrade:
`mountContract.ts`'s `affordancesAvailable(variant) => variant === 'full'` gates `useFeedStream`
(`Feed.tsx`: `useFeedStream({ enabled: affordances })`), the "▲ N new posts" pill and authoring — so a
`readOnly` Staged shipped **no realtime stream, no pill and no composer**: a frozen snapshot, with no error,
during precisely the pre-StartEx familiarization window COR-032 gives Staged for. It also contradicted this
story's own AC7 hooks, where `staged` declares `AmbientWorldRuns = true` and `ParticipantWritesAccepted =
true`. **The hooks were right; the projection was the half that disagreed** — so the projection moved and the
hooks did not. Pinned (with the reason) by
`LifecycleProjectionTests.ShellVariantProjection_Staged_IsFull_BecauseAffordancesAreGatedOnFullAlone`.

**Decision 2 — `completed` is carved out of the refusal set for `/api/overlay-state` only.** `paused` was
already carved out because *an overlay cannot render if the overlay endpoint is refused*. `completed` has the
identical need: `endex` is a first-class literal in the frozen `OverlayStateResponse` union and COR-054's
whole point is a **participant-visible** end-of-exercise overlay. As originally built, `live → completed` made
`/api/overlay-state` start 403ing, so EndEx could never display. Scope is exact: the **overlay endpoint**, not
`/api/feed` — a completed run's content stays un-browsable — and `build` / `archived` remain fully closed, so
AC3's letter still holds for those two. Lives on `ExerciseLifecycleStates.IsOverlayStateServed` +
`ExerciseLifecycleGatedRoutes.IsOverlayState`; proven by
`ExerciseLifecycleGatingTests.InCompleted_TheOverlayEndpointIsServedWhileTheFeedStaysRefused`.

**Decision 3 — the lifecycle contributes an *unspecified* register; CTL-023 chooses.** `FromLifecycle`
previously hardcoded `out-of-fiction`, and rule 2 made `out-of-fiction` dominate — so a lifecycle pause forced
out-of-fiction *permanently*, even once world-steering merges and supplies a controller-authored `in-fiction`
register. COR-032 explicitly says the holding page is configurable **in-fiction or out-of-fiction**, so
in-fiction was **unreachable by construction** and a COR-032 pause broke fiction by default (a D0 §4 cost).
The lifecycle now authors **no** register (`Register: null`); domination applies only **between two explicitly
chosen registers**; a lone choice stands; and the `out-of-fiction` floor applies only when **neither** side
chose — preserving the fail-closed default when nothing else speaks while letting CTL-023 choose in-fiction.
Proven by `OverlayComposition_ASteeringChosenInFictionRegister_SurvivesAConcurrentLifecyclePause` and
`OverlayComposition_OutOfFictionDominates_BetweenTwoExplicitlyChosenRegisters`.

**Deliberately NOT changed here** (recorded so a later reader does not read the omissions as oversights):
`W-001` (a composition-root guard for the three wiring lines) is the **merger's**, and would be red on this
branch; `W-004` (participant writes accepted during `paused`) is **CTL-023's job** — hazard 1 forbids a second
write-refusal mechanism in this slice, and it is a named merge obligation; `W-006` (`/hubs/exercise` un-gated)
keeps its scope discipline, but its code comment was changed from an assurance to a **named risk** — "nothing
publishes into a build/completed/archived exercise" is an *assumption*, not an invariant (nothing consumes
`ScenarioContentFires`, and the reaction loop does not deregister on `completed`).

### Lifecycle → shell-variant mapping (as built, **amended by human decision 1**)

| State | `ShellStateResponse.variant` | Why |
|---|---|---|
| `build` | `preview` | only staff reach it (participants are refused upstream); they are previewing a world under construction |
| `staged` | `full` | **decision 1.** `full` is the only variant `affordancesAvailable()` grants, and Staged's ambient world is meant to stream and be posted into (its own AC7 hooks say `AmbientWorldRuns` and `ParticipantWritesAccepted`) |
| `live` | `full` | the interactive shell. Staged shares it; what Live adds is the clock and scenario content, neither of which is a shell-variant concern |
| `paused` | `readOnly` | the holding page covers the shell; nothing beneath it may be authored |
| `completed` / `archived` | `readOnly` | the run is over; a staff reader sees a frozen world |
| anything unrecognized | `readOnly` | fail closed, the same direction the frontend's own default already uses |

`kiosk` is never produced by the lifecycle — it is an unattended-display concern, not a lifecycle one.

### Overlay reconciliation with CTL-023, as built (integration hazard 1)

This story adds **no second pause mechanism**: it writes no overlay state, owns no overlay store and pushes
nothing over SignalR. It reads a one-method seam, `ISteeringOverlaySource`, whose shipped default
(`NoSteeringOverlaySource`) reports "no steering overlay is active", and joins it with the lifecycle's own
contribution in one pure function, `LifecycleOverlayComposer.Compose`. The three rules:

1. **A non-pause steering overlay (`broadcast` / `endex`) wins outright.** Those are authored,
   message-bearing controller actions the lifecycle cannot express; hiding a Break Fiction broadcast behind a
   holding page is a safety failure.
2. **Two pauses become ONE pause, joined field by field.** `state` is `pause` if *either* side asks for it —
   so a CTL-023 Resume does **not** lift a COR-032 lifecycle Pause, and ending the lifecycle Pause does not
   lift a still-held Freeze (a naive "steering wins" rule gets both backwards). `register` (**amended by
   decision 3**): composed only from the sides that actually **chose** one — `out-of-fiction` dominates
   `in-fiction` *between two explicit choices* (world-steering's own `CoerceRegister` direction), a lone
   choice simply stands, and when neither side chose one the composer falls back to `out-of-fiction`. The
   **lifecycle chooses nothing**, so a controller-authored `in-fiction` holding page survives a concurrent
   COR-032 pause, while the fail-closed default is unchanged when CTL-023 is silent. `message`: the steering
   message when it carries one, else the lifecycle's. The join is idempotent.
3. **Neither active → the shipped Phase-1 constant** (`none` / `in-fiction` / empty), byte for byte.

**Commutativity is domain-limited (reviewer S-001) — the earlier flat claim was wrong.** `Compose` is
commutative over the *reachable* domain, because `FromLifecycle` only ever yields `none` or an
unspecified-register `pause`; swapping those two arguments cannot change the answer. It is **not** commutative
in general: `Compose(none, broadcast)` → `broadcast` while `Compose(broadcast, none)` → `pause`, because rule 1
is a deliberate **steering-side privilege** — only an authored controller overlay may outrank a holding page.
Callers must keep passing the lifecycle contribution first. Both halves are pinned by tests
(`OverlayComposition_IsCommutativeAcrossTheTwoContributions`,
`OverlayComposition_IsNotCommutativeInGeneral_BecauseRule1IsASteeringSidePrivilege`).

**The merge is a one-file adapter:** register an `ISteeringOverlaySource` that projects
`OverlayStateService.Get(exerciseId)` onto `OverlayContribution`, with
`services.Replace(ServiceDescriptor.Singleton<ISteeringOverlaySource, WorldSteeringOverlaySource>())`.
Nothing else in this slice changes, and the rules above become the reconciled behaviour of both features.
World-steering's `OverlayStateWire` and this slice's `LifecycleOverlayWire` are the same string constants
(not a second mechanism) — collapse onto whichever home survives.

**Where "configurable" actually lands (amended by decision 3).** COR-032 says Paused shows "a configurable
holding page (in-fiction or out-of-fiction, **CTL-023**)" — i.e. the requirement itself points the register at
CTL-023, which is the seam above. There is no per-exercise holding-page column on `Exercise` (01a authored
none, and this story authors no migration), and holding-page **content authoring** is out of scope, so the
lifecycle contributes an **unspecified** register and an **empty** message: it says only "a pause is in
effect". With CTL-023 silent the composer's floor still resolves to `out-of-fiction`, and the participant
shell renders its own static copy — exactly what world-steering/08 does — but when CTL-023 *does* author a
register, that choice is what participants see.

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

### Shipped tests (`src/Pulse.WebApi.Tests/Features/ExerciseConfiguration/Lifecycle/`)

Pure suites (plain `[Fact]`/`[Theory]`, **outside `MsSqlCollection`** so they run Docker-less);
SQL-backed suites are `[RequiresDockerFact]` / `[RequiresDockerTheory]` inside `MsSqlCollection`.

| AC | Test |
|---|---|
| AC1 | `ExerciseLifecycleStateMachineTests.All_IsExactlyTheSixAuthoritativeCor032Literals_InOrder` · `.TryParse_NeverEmitsACoinedOrCasedVariant` · `.TryParse_MapsTheLegacyVocabulary_PerTheAuthoritativeTable` · `.TryParse_RejectsAnUnknownLiteral` · `ExerciseLifecycleServiceTests.TransitionAsync_AllowedTransition_PersistsTheNewStateOnTheStatusColumn` (no parallel column) · `.TransitionAsync_ALegacyRow_TransitionsAsItsCanonicalEquivalentAndPersistsTheNewVocabulary` · `ExerciseLifecycleEndpointsTests.Transition_WithALegacyTargetLiteral_PersistsTheCanonicalSpelling` |
| AC2 | `ExerciseLifecycleStateMachineTests.IsTransitionAllowed_AllowsTheCor032Chain` · `.IsTransitionAllowed_RefusesEverythingOffTheChain` · `.IsTransitionAllowed_RefusesASelfTransition` · `.AllowedTransitionsFrom_Archived_IsEmpty_AndArchivedIsTerminal` · `.IsTransitionAllowed_TreatsALegacyRowAsItsCanonicalEquivalent` · `.AllowedTransitionsFrom_AnUnknownState_IsEmpty` · `ExerciseLifecycleEndpointsTests.Transition_Disallowed_Returns409AndChangesNothing` · `.Transition_Allowed_Returns200AndPersistsTheNewState` · `.Transition_WithANonVocabularyTarget_Returns400` · `.GetLifecycle_ReturnsTheStateItsAllowedTransitionsAndItsBehaviourHooks` · `ExerciseLifecycleServiceTests.TransitionAsync_DisallowedTransition_IsRefusedAndChangesNothing` · `.TransitionAsync_UnknownTargetLiteral_IsInvalidAndChangesNothing` · `.TransitionAsync_ARowWithAnUnknownStoredStatus_IsRefused` |
| AC3 | `ExerciseLifecycleGatingTests.InBuildCompletedOrArchived_TheParticipantFeedIsNotServed` (**names `/api/feed` and asserts the seeded post body is absent**) · `.InLive_TheSameFeedServesTheSeededPost` (the control that makes the refusal meaningful) · `.InArchived_EveryCoveredGetRouteIsRefused` · `.InArchived_TheThreadReadIsRefused` · `.InArchived_ThePostWriteIsRefusedBeforeTheHandlerRuns` · `.InStagedLiveOrPaused_TheParticipantSurfaceIsServed` · `.ALegacyRow_IsGatedByItsMappedState` · `.AnUnknownStatusLiteral_FailsClosed` · `ExerciseLifecycleGatedRoutesTests.Paths_AreExactlyTheCoveredSetImplementationMdNames` · `.IsGated_CoversEveryParticipantWorldRoute` · `.IsGated_MatchesWholeSegmentsNotStringPrefixes` · `ExerciseLifecycleStateMachineTests.IsParticipantAccessible_MatchesCor032` · `.IsParticipantAccessible_FailsClosedOnAnUnknownState` · `.IsParticipantAccessible_FollowsTheLegacyMapping` |
| AC3 — **decision 2** (the `completed` overlay carve-out) | `ExerciseLifecycleGatingTests.InCompleted_TheOverlayEndpointIsServedWhileTheFeedStaysRefused` (both halves in one state) · `.InBuildOrArchived_EvenTheOverlayEndpointIsRefused` (the carve-out's boundary, unknown literals included) · `ExerciseLifecycleCompositionTests.OverlayState_ForACompletedExercise_IsStillServed_SoEndExCanRender` · `ExerciseLifecycleStateMachineTests.IsOverlayStateServed_AddsCompletedToTheParticipantAccessibleStates` · `.IsOverlayStateServed_DoesNotWidenParticipantAccess` · `ExerciseLifecycleGatedRoutesTests.IsOverlayState_IsTheOverlayRouteAlone` |
| AC4 | `ExerciseLifecycleGatingTests.AStaffSession_IsExemptFromTheGate` · `.TheStaffExemption_DoesNotDoubleAsAnAuthorizationGate` · `.ASharedReadOnlySession_IsGatedLikeAParticipant_NotExemptAsStaff` (**reviewer S-005** — the COR-015 shared observer named directly, driven through the REAL `CurrentStaffSessionAccessor` over real `readonly`- and `staff`-kind session rows, so the refusal cannot pass vacuously) · `.ThePreAuthAllowlistIsNeverGated` · `.WithAnUnresolvedScope_TheGatePassesThroughToTheEndpointsOwn401` · `ExerciseLifecycleGatedRoutesTests.IsGated_NeverTouchesTheAuthStaffOpsOrHealthSurface` |
| AC5 | `ExerciseLifecycleRegistrationTests.AddExerciseLifecycle_ReplacesBothProjectionDefaults_InTheOrchestratorsOrder` · `.ContributedProjections_ResolveFromAFullyComposedProvider` · `.ContributedProjections_WinEvenWhenAddExerciseLifecycleRunsBeforeTheDefaults` · `.HadTheProjectionsBeenContributedWithTryAdd_TheConstantsWouldSilentlyKeepServing` · `.AddExerciseLifecycle_CalledTwice_StillLeavesOneDescriptorPerProjection` · `.AddExerciseLifecycle_RegistersTheLifecycleServiceAtScopedLifetime` · `ExerciseLifecycleCompositionTests.ShellState_IsDrivenByTheLifecycle_EndToEnd` · `.ShellState_ForABuildExercise_IsPreview_ProvingReplaceBeatsTheConstantDefault` |
| AC6 | `LifecycleProjectionTests.OverlayProjection_Paused_ServesTheHoldingPage` · `.ShellVariantProjection_MapsEachLifecycleStateOntoItsVariant` · `.ShellVariantProjection_Staged_IsFull_BecauseAffordancesAreGatedOnFullAlone` (**decision 1**, pinned with its reason) · `.ShellVariantProjection_OnlyEverEmitsAFrozenVariantLiteral` · `.ShellVariantProjection_FailsClosedToReadOnly_OnAnUnknownStatus` · `.OverlayProjection_WithoutPauseOrFreeze_IsTheShippedPhase1Constant` · `ExerciseLifecycleCompositionTests.OverlayState_ForAPausedExercise_ServesTheHoldingPage_EndToEnd` · `.OverlayState_ForALiveExercise_IsTheShippedConstant_EndToEnd` · `.ShellState_KeepsTheFrozenSingleFieldShape` · `.ShellState_IsDrivenByTheLifecycle_EndToEnd` (now asserts `staged → full` end to end) |
| AC7 | `ExerciseLifecycleStateMachineTests.BehaviourOf_Staged_OpensParticipantAccessButHoldsTheClockAndScenarioContent` · `.BehaviourOf_Live_IsTheOnlyStateThatRunsTheClockAndFiresScenarioContent` · `.BehaviourOf_TheClosedStates_RunNothingAndAdmitNobody` · `.BehaviourOf_Paused_ServesParticipantsButAdvancesNothing` · `.BehaviourOf_AnUnknownState_IsTheFullyClosedSet` · `ExerciseLifecycleServiceTests.GetAsync_ExposesTheStateItsAllowedTransitionsAndItsBehaviourHooks` |
| AC8 | `ExerciseLifecycleServiceTests.TransitionAsync_EmitsExactlyOneV0TelemetryEnvelopeWithTheFromAndToStates` · `.TransitionAsync_StampsThePersistedScenarioInstant_RatherThanTheServerClock` (and the "emits nothing" half of `.TransitionAsync_DisallowedTransition_IsRefusedAndChangesNothing`) |
| AC9 | `ExerciseLifecycleServiceTests.TheScopeIsTheOnlyExerciseSelector_AServiceBoundToAneverTouchesB` · `.WithAnUnresolvedScope_ReadAndTransitionBothFailClosed` · `.GetAsync_WithNoExerciseRowForTheResolvedScope_IsNotFound` · `ExerciseLifecycleEndpointsTests.ACrossExerciseTransitionAttempt_Is403AndMovesNeitherExercise` · `.AClientSuppliedExerciseId_IsNeverAScopeSelector` · `.WithoutAStaffSession_BothRoutesAre401` · `.WithAnUnresolvedScope_TheReadIs401` · `ExerciseLifecycleGatingTests.TheGateReadsTheResolvedScopeOnly_ANamedOtherExerciseChangesNothing` |
| Overlay composition (hazard 1) | `LifecycleProjectionTests.OverlayComposition_LifecyclePauseAndFreeze_ProduceOneCoherentOverlay` · `.OverlayComposition_FreezeResumedWhileLifecycleStillPaused_KeepsTheHoldingPage` · `.OverlayComposition_LifecycleResumedWhileFreezeStillHeld_KeepsTheFreeze` · `.OverlayComposition_BroadcastDuringALifecyclePause_WinsOutright` · `.OverlayComposition_FreezeAlone_ShowsTheFreeze` · `.OverlayComposition_IsCommutativeAcrossTheTwoContributions` (now a theory over the reachable domain) · `.NoSteeringOverlaySource_NeverReportsAnActiveOverlay` · `ExerciseLifecycleRegistrationTests.SteeringOverlaySource_DefaultsToTheFailClosedFloor_AndIsReplaceableByWorldSteering` · `ExerciseLifecycleCompositionTests.AContributedSteeringOverlaySource_ComposesWithTheLifecyclePause_EndToEnd` (now asserts the controller's `in-fiction` register survives) |
| Overlay composition — **decision 3** (the register is CTL-023's) | `LifecycleProjectionTests.OverlayComposition_TheLifecycleAuthorsNoRegister` · `.OverlayComposition_ASteeringChosenInFictionRegister_SurvivesAConcurrentLifecyclePause` · `.OverlayComposition_OutOfFictionDominates_BetweenTwoExplicitlyChosenRegisters` · `.OverlayComposition_WithNoAuthoredRegisterOnEitherSide_FallsBackToOutOfFiction` |
| Overlay composition — **reviewer S-001** (the commutativity claim, narrowed) | `LifecycleProjectionTests.OverlayComposition_IsNotCommutativeInGeneral_BecauseRule1IsASteeringSidePrivilege` |

**Not shipped as an automated test (documented gap):** the frontend runtime-guard *contract* regression in
the bullet list above. This story is backend-only and owns no frontend file; `isExerciseStatus`'s widened
superset and `statePillConfig.ts`'s exhaustive `Record` are story 01a's, and their guard tests shipped with
it. The two backend halves of that contract *are* pinned here —
`ExerciseLifecycleCompositionTests.ShellState_KeepsTheFrozenSingleFieldShape` and
`OverlayState_ForAPausedExercise_ServesTheHoldingPage_EndToEnd` assert the frozen keys — but nothing here
drives a frontend hook.
