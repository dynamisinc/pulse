# Story: Practice/sandbox flag

**Feature:** Exercise configuration  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-033  ·  **Design decisions:** none  ·  **Issue:** #70

## Context
A practice/sandbox flag lets staff run rehearsals whose data is **excluded from evaluation exports**
(COR-033) — so a load rehearsal or a controller dry-run doesn't pollute the AAR.

The flag's **column ships in story 01's single migration** (feature.md "Single-migration rule"); this
story owns its behavior: setting it, reading it, and the staff-visible indicator. **E10 (evaluation
export) is Phase 4 and does not exist yet**, so the deliverable here is the flag plus a documented,
tested read seam E10 will filter on — not the export filtering itself.

## Acceptance Criteria
- [ ] Given a planner with a staff session, when they flag an exercise practice/sandbox, then the flag
      persists on that exercise and defaults to off for every exercise that has never been flagged.
- [ ] Given the flag is set, when a consumer asks whether an exercise's data is evaluation-eligible,
      then a single documented server-side seam answers it — so E10's export filtering has exactly one
      thing to read and no consumer re-derives the rule.
- [ ] Given the flag is set, when the exercise runs, then it remains **otherwise fully functional** for
      the rehearsal (no channel, engine or telemetry behavior changes because of the flag).
- [ ] Given the flag is set, when a staff surface renders, then the practice/sandbox state is clearly
      indicated — with icon + text, **never color alone** (NFR-001) — so a rehearsal is never mistaken
      for real conduct.
- [ ] **Isolation / staff-only (XC-001/002):** given the flag, when it is read or written, then it is a
      staff-world value scoped by the server-resolved exercise, never exposed on a participant surface
      and never settable from a client-supplied exercise parameter.
- [ ] **The seam actually resolves:** given a fully composed service provider wired in the orchestrator's
      order, when `IEvaluationEligibility` is resolved, then this story's implementation comes back and
      answers correctly for a flagged and an unflagged exercise — proving `AddPracticeMode()` is
      genuinely wired, not just that the service class works in isolation (a slice can merge fully green
      with its composition-root wiring never executed).

## Out of Scope
The evaluation export itself and its filtering (E10, Phase 4 — this story only publishes the seam); the
readiness-dashboard load rehearsal (exercise-build-golive COR-042 / NFR-002); any participant-visible
indication of practice mode (there is none — XC-002).

## Technical Notes
**Staff world.** The indicator component is COBRA (`@/theme/styledComponents`, FontAwesome, MUI 9
`sx`-only) and lives in `src/frontend/src/features/planner/`; the orchestrator mounts it and edits the
planner barrel + README (integration seams — see implementation.md). **Keep this story's client-contract
types local to `services/practiceModeService.ts`** — do not append to `features/planner/types.ts`, which
belongs to the account-import contract and would collide with the other wave-3 builder. Backend behavior
lands in the `Features/ExerciseConfiguration/` slice story 01b creates. No schema work here. See
implementation.md (story 04).

**Composition root (orchestrator-owned — two lines, no builder edits `Program.cs`).** This slice exports its
own pair from `Features/ExerciseConfiguration/PracticeMode/PracticeModeExtensions.cs`:
`builder.Services.AddPracticeMode();` (after `AddPulsePersistence` / `AddExerciseScoping` /
`AddStaffIdentity`, and by convention after `AddExerciseConfiguration()`) and
`app.MapPracticeModeEndpoints();`. No middleware ordering constraint. **The wiring is required, not
optional:** `IEvaluationEligibility` has no fail-safe default registered anywhere else, deliberately — a
missing registration must be a loud DI failure, never a silent "everything is eligible" that leaks rehearsal
data into an AAR. The frontend panel mounts with one line, `<PracticeModePanel />`, in
`ExerciseSettingsPage.tsx` (plus the barrel/README lines).

## Dependencies
Story 01 (settings slice + the flag column in its migration). Consumed later by E10 export
(Phase 4). Supports the load rehearsal (COR-042).

## Tests

**Backend** — `src/Pulse.WebApi.Tests/Features/ExerciseConfiguration/PracticeMode/`

`PracticeModeEndpointsTests` (real SQL, `[RequiresDockerFact]`, `MsSqlCollection`):
- `Get_ExerciseThatWasNeverFlagged_ReportsPracticeModeOff_AndEvaluationEligible` (AC1, AC2)
- `Put_FlaggingTheExercise_PersistsAndSurvivesAReload_AndTurnsOffEvaluationEligibility` (AC1, AC2)
- `Put_ClearingTheFlag_RestoresEvaluationEligibility` (AC1, AC2)
- `Put_WithoutIsPracticeMode_Returns400_AndLeavesTheFlagUnchanged` (AC1)
- `Put_MissingBody_Returns400` (AC1)
- `Get_NoStaffSession_Returns401_FailClosed` (AC5)
- `Get_StaffNotAssignedToTheResolvedExercise_Returns403_FailClosed` (AC5)
- `Get_UnresolvedScope_Returns401_FailClosed` (AC5)
- `Put_NoStaffSession_Returns401_AndWritesNothing` (AC5)
- `Put_InExerciseA_NeverFlagsExerciseB_EvenWhenTheBodyNamesIt` (AC5 — cross-exercise write, fails closed)
- `Get_InExerciseA_NeverReportsExerciseBsFlag` (AC5 — cross-exercise read)
- `FlaggingPracticeMode_LeavesEveryParticipantShellConfigByteIdentical_AndMentionsItNowhere` (AC3, AC5)
- `Put_ThatFlipsTheFlag_EmitsExactlyOnePracticeModeTelemetryEvent` (AC3 — one XC-004 audit event, the flag
  changes no other telemetry)
- `Put_ThatChangesNothing_PersistsNothingAndEmitsNoTelemetry` (AC3)

`EvaluationEligibilitySeamTests` (real SQL; the seam resolved from a fully composed, running host):
- `Verdict_ForAnExerciseThatWasNeverFlagged_IsEligible` (AC1, AC2, AC6)
- `Verdict_ForAFlaggedExercise_IsNotEligible_AndSaysWhy` (AC2, AC6)
- `Verdict_WithNoResolvedScope_IsNotEligible_FailingClosed` (AC2, AC5)
- `Verdict_ForAScopeWithNoExerciseRow_IsNotEligible_FailingClosed` (AC2)
- `Verdict_IsReadLive_SoFlaggingAnExerciseTakesEffectImmediately` (AC2)
- `Verdict_InExerciseA_IsUnaffectedByExerciseBsFlag` (AC5)

`PracticeModeRegistrationTests` (pure DI, plain `[Fact]`, deliberately OUTSIDE `MsSqlCollection`):
- `AddPracticeMode_RegistersTheSeamAndTheServiceAtScopedLifetime` (AC6)
- `AddPracticeMode_RegistersThisStorysEligibilityImplementation_NotSomeOtherRule` (AC6)
- `AddPracticeMode_CalledTwice_StillLeavesASingleEligibilityDescriptor` (AC6)
- `AddPracticeMode_WinsOverAPreExistingEligibilityRegistration_RegardlessOfOrder` (AC6)
- `ComposedProvider_ResolvesTheSeamAndTheService_InTheOrchestratorsOrder` (AC6)
- `ComposedProvider_ResolvesTheSeamPerScope_NeverAsASingleton` (AC6)

**Frontend** — `src/frontend/src/features/planner/`

`PracticeModePanel.test.tsx`:
- `states REAL CONDUCT with an icon and text for an exercise that was never flagged` (AC4)
- `states PRACTICE / SANDBOX with a DIFFERENT icon and DIFFERENT text when flagged` (AC4)
- `says the excluded-from-exports consequence in words when flagged` (AC4)
- `renders the server eligibility verdict rather than re-deriving it from the flag` (AC2, AC4)
- `announces loading in a status region while the flag is in flight` (AC4)
- `reports a load failure with an icon and text, not color alone` (AC4)
- `sends the explicit boolean and nothing else` / `clears the flag with an explicit false` (AC1)
- `re-renders from the SERVER response after a save` (AC1, AC2)
- `keeps the save button disabled until the planner actually changes the flag` (AC1)
- `reports a save failure with an icon and text, and leaves the stored state showing` (AC4)

`practiceModeService.test.ts`:
- `reads the staff route with NO exercise parameter (the scope is server-resolved)` (AC5)
- `PUTs only the flag — the body names no exercise` (AC5)
- `returns the server verdict verbatim for a flagged exercise` (AC2)
- `clears the flag with an explicit false, never by omitting it` (AC1)
- `fails closed on a malformed body …` / `fails closed on an empty body` /
  `fails closed on a malformed write response` (AC5 — a malformed body never renders as "not a rehearsal")
- `translates a 401/403/404 into a PracticeModeError carrying the status`,
  `reports a network failure with no status`, `surfaces the server reason from a 400 …` (AC5)
