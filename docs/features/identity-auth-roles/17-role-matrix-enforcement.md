# Story: Role-matrix enforcement (per-route, per-transition) with a route x role matrix test

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** In Review
**Requirements:** COR-010, COR-013 (+ P0 #377, #481, #61)  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §8.2, §5.1  ·  **Issue:** #573
**Stack:** backend  ·  **Review tier:** Tier-2 (security)  ·  **Wave:** A1

## Context
The lifecycle transition endpoint is guarded only by "assigned staff", with **no role check** (#377/#481), and
evaluators are not refused every write (#61). Tom signed off the role matrix ([`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §8.2). This story enforces it per
route and per lifecycle transition and proves it with a route x role matrix test. Staff world.

## Acceptance Criteria
- [ ] **Transitions are role-checked.** Given the lifecycle endpoint, then stage/unstage = planner; archive = planner or
      org admin; StartEx, pause/resume, EndEx, reopen, Freeze/pause tiers = controller; unarchive = org admin only (returns to the prior state). Archive is also allowed from `build` when `FirstLiveAt` is set (planner or org admin).
      Any other role gets 403 and the state is unchanged.
- [ ] **Narrowings land.** Create exercise is org admin only (planner/controller refused); settings, chrome, practice mode
      are planner only (controller refused); view-only code rotate/revoke is planner + controller (evaluator refused).
- [ ] **Evaluator writes nothing (#61).** Every exercise-content and administration mutating route refuses `evaluator` with no state change; evaluator reads the
      exercise (console, feeds, report).
- [ ] **Org admin has no implicit exercise power.** Org-scope session on an exercise-scoped route is refused; "via enrollment"
      rows apply only when the org admin holds that enrollment.
- [ ] **Route x role matrix test.** Given every mapped route enumerated from endpoint metadata, then each is asserted for
      orgAdmin, planner, controller, evaluator, participant/pio and readonly against the §8.2 table; a route with no
      matrix entry fails the build. Includes the lifecycle-gated (L) cases.
- [ ] **Bare-404 pattern:** a foreign-exercise or foreign-org id returns the same 404 as a missing id, before the role check leaks existence.
- [ ] Isolation (XC-001/002, COR-001/002/007; brief C5): every new route has a foreign-exercise test **and** a foreign-org test; a cross-tenant id returns the same bare 404 as a missing id (the bare-404 pattern, design doc §7.2); id-taking org routes join the `CompositionRootWiringTests` allow-list.
- [ ] Telemetry (XC-004): the action emits an event (wall + scenario time, acting `PersonId` and role, channel `system`) per the v0 schema, in the same unit of work as the mutation.
- [ ] User guide (C5 docs-as-done): `docs/guide/planner-guide.md` (role table) and `controller-guide.md` are updated in the same PR, or the PR states "no guide impact".

### Copilot review 2 fold (2026-10-16, ADMIN-IDENTITY-MODEL §8.2)
- [ ] In the matrix, participant sim writes are allowed in `live` **and `staged`** (dry runs), and refused when paused or frozen. The matrix test asserts both.

### Lead controller (Tom, 2026-10-16; ADMIN-IDENTITY-MODEL §8.2)
- [ ] *(Raise-only, Option A, signed off by Tom 2026-10-16; design doc §12.)* The five raise routes listed below require a **lead** controller. Other controllers, planners and evaluators get 403 on a raise, and any controller may lower. The matrix records this inside the controller column, as "raise: lead only; lower: any controller". There is no separate lead column. The test asserts both directions for the lead, a non-lead controller, a planner and an evaluator.

### Orchestrator review fold (2026-10-16, ADMIN-IDENTITY-MODEL §8.2)
- [ ] The lead gate is a filter that reads `Enrollment.IsLead` **live** on each request (a sibling of `EngineCockpitControllerRoleFilter`), keyed on the session's `PersonId` and never on a body `actingHumanId`.
- [ ] The routes it covers: `POST /api/engine/autonomy/swamped-mode`, `/api/engine/autonomy/restore`, `/api/engine/settings/autonomy-default`, `/api/engine/settings/tier-policy` and `/api/engine/generation-provider/restore`, under **raise-only** semantics (Option A). Raising (swamped on, autonomy up, `autonomy/restore`, `generation-provider/restore`) requires the lead. Lowering (swamped off, autonomy down, the kill switch, `cut-to-fake`) is open to **any controller**. The test covers both directions for lead, non-lead controller, planner and evaluator.
- [ ] The matrix includes a "set lead controller" row: planner ✅; every other role 403.

### Copilot review 5 fold (2026-10-16)
- [ ] Setup authoring is separate from conduct posting. In **build**, planners and controllers may post as a persona (setup and backdated posts) and pin, using the composer flows in build-golive/01 and persona-management/04. In **staged and live**, conduct posting is controller-only. The matrix test covers a planner posting in build (allowed) and in live (403).

### Copilot review 6 fold (2026-10-16)
- [ ] Self-service session operations are explicit rows in the matrix. `/api/auth/refresh`, `/api/auth/logout`, `GET /api/session` and `/api/me/*` reads are allowed for every authenticated session. `GET /api/staff/assignments` and `POST /api/staff/active-exercise` are allowed for **staff-world sessions only** (evaluators and org admins included; own enrollments only). **Participant and readonly sessions are refused on both**, even when the same Person is staff elsewhere. Tests cover an evaluator refreshing, logging out and switching between two of their own evaluator enrollments, and a participant session (link and day word) refused on both staff operations.

### Orchestrator review fold (2026-10-16, M-003 / L-002)
- [ ] `tier-policy`: a PUT is a **raise** if any tier moves towards more autonomy. A mixed PUT needs the lead (test).
- [x] UI (A1 frontend): while swamped mode is on, a **non-lead controller** sees an **OFF-only** swamped-mode control (the shipped `useSwampedMode` / engine-review-cockpit/03 hides it from non-leads today). Turning it on stays lead-only. Component test for lead, non-lead and planner.

### Frontend (wave A1c, 2026-10-16): the UI hides or disables what the server now refuses
The client mirrors the matrix in one place, `src/frontend/src/core/auth/rolePermissions.ts` (`can()` and
`usePermissions()`, reading `Session.role` and the server's `Session.isLead`; never inferred, fail closed). This is
convenience only: the server is the authority.
- [x] **Role gating per the matrix.** Create exercise is org admin only; org-row Rename and Archive are hidden for a
      controller; settings, chrome and practice mode are planner only (a read-only notice in words for anyone else);
      StartEx and EndEx are controller only; the roster, day-word and view-only-code surface is planner + controller
      (a text notice for an evaluator); inject create/update/delete/reorder/import and persona edit stay visible to
      planners (fire, hold and skip stay controller); staff post and pin are planner + controller in `build`, controller
      only otherwise. Tests: [`rolePermissions.test.tsx`](../../../src/frontend/src/core/auth/rolePermissions.test.tsx)
      (every action x every role), [`roleGating.test.tsx`](../../../src/frontend/src/features/exerciseLifecycleAdmin/roleGating.test.tsx),
      [`ExerciseSettingsPage.roleGating.test.tsx`](../../../src/frontend/src/features/planner/pages/ExerciseSettingsPage.roleGating.test.tsx),
      [`ParticipantAdminSurface.roleGating.test.tsx`](../../../src/frontend/src/features/participantAdmin/ParticipantAdminSurface.roleGating.test.tsx),
      [`useCanControl.roles.test.tsx`](../../../src/frontend/src/features/controller/access/useCanControl.roles.test.tsx),
      [`RunSheetRow.test.tsx`](../../../src/frontend/src/features/controller/runSheet/RunSheetRow.test.tsx) (planner case),
      [`ExerciseLifecycleControl.test.tsx`](../../../src/frontend/src/features/controller/lifecycle/ExerciseLifecycleControl.test.tsx) (planner/evaluator refused).
- [x] **Lead gate, raise-only (Option A).** `SwampedModeToggle` renders its switch only for `canControl && isLead`; a
      non-lead controller gets "Turn swamped mode off" (icon + text) behind a confirmation; autonomy raise, tier-policy
      raise (ambient < standard < auto), the generation-provider Restore, the kill switch's step back to Live and the
      degraded Restore are disabled for a non-lead with the visible text "Only the lead controller can raise this";
      lowering stays open to every controller. `isLead` is the session's; the mock `useControllerIdentity().isLead` is
      gone. Tests: [`SwampedModeToggle.test.tsx`](../../../src/frontend/src/features/controller/engine/components/SwampedModeToggle.test.tsx),
      [`EngineSettingsPanel.leadGate.test.tsx`](../../../src/frontend/src/features/controller/engine/components/EngineSettingsPanel.leadGate.test.tsx),
      [`EngineControlBar.leadGate.test.tsx`](../../../src/frontend/src/features/controller/engine/console/EngineControlBar.leadGate.test.tsx),
      [`useSwampedMode.test.tsx`](../../../src/frontend/src/features/controller/engine/hooks/useSwampedMode.test.tsx).
- [ ] *Not built (no UI exists yet):* stage/unstage buttons, view-only code rotate/revoke screen, "set lead controller"
      control, staff follow button, unarchive. They are in the helper's table so they are gated the day they land.
- [ ] *Gap:* the org-row Archive button is enabled only for a completed exercise; the server also allows archive from
      `build` once `FirstLiveAt` is set. The org-exercise DTO carries no such flag yet.
- [x] *Closed 2026-10-17 (see the planner console item above):* `/staff/console` admitted controller and evaluator only (`staffRouteRegistry.tsx`, orchestrator-owned), so a
      planner cannot reach the build-time post/pin/inject surfaces in the console; the component gates are ready.

### Ambient-policy lead gate and WR-2 session attribution (2026-10-17)
- [x] **Ambient policy is a lead-gated raise.** `POST /api/engine/settings/ambient-policy` answers 403 and changes nothing
      when a **non-lead** controller RAISES the policy. A raise is: moving the mode to autonomous from a mode that is not
      autonomous; while already autonomous, a higher `maxPerMinute` or `maxPerHour`; while already autonomous, an added topic
      or persona in the allow lists. Lowering (off/review, lower caps, removed entries) is open to any controller. The lead
      reads `Enrollment.IsLead` live, so a kill-switch demotion between the snapshot and the set turns a non-lead no-op into a
      refused raise (race tests below).
- [x] **Lead-gated raises are judged at write time.** Swamped-mode on, autonomy-default, tier-policy and the ambient
      policy re-read the lead flag when the write is applied (not from an earlier snapshot), so a demotion between the
      read and the write refuses the raise. Pause-tier now attributes to the session person, like the other engine routes.
- [x] **WR-005: Rename/Archive follow the per-row `canManage`.** `GET /api/org/exercises` sends `canManage` on every
      row (an org admin any row; a planner only the exercises they plan). The client shows Rename/Archive only when
      `canManage` and the role gate both hold; a row missing the field (older backend) falls back to org admin only.
- [x] **WR-005 follow-ups:** WR-002 (planner chip), WR-004 (swamped-off confirm focus), SG-004 (`scheduled` is build).
- [x] **WR-2 session attribution.** The acting human recorded for engine review actions (approve, veto, kill switch,
      autonomy default) is the **session's** person, never a body `actingHumanId`. A spoofed body value is not recorded.
- [x] **UI mirrors the ambient gate** (`AmbientChatterSection`). A non-lead controller cannot choose Autonomous (from a
      non-autonomous mode) and cannot save an edit that would raise (same rule as the server, `ambientRaiseKind`): the
      control is disabled with the visible text "Only the lead controller can raise this" (icon + words, `aria-describedby`).
      Lowering edits stay enabled. A 403 response shows the same reason inline and does not flip the panel read-only.
- [x] **Planner console access** (Tom-approved 2026-10-17; commits `7a842db6`, `5eecb754`). `/staff/console` now admits the
      planner, which closes the earlier gap; the persona tool and dock follow the persona-edit permission.

## Out of Scope
The new transitions themselves (reset/reopen/delete/unstage bodies: exercise-build-golive 07-08); the lifecycle write gate for participants (A5 #379).

## Technical Notes
Staff world. Build one declarative route-policy attribute / filter, not scattered `if`s. Files: `LifecycleEndpoints.cs`,
`Features/ExerciseLifecycleAdmin/*`, settings/view-only-code endpoints, `Pulse.WebApi.Tests/.../RoleMatrixTests.cs` (new). **Orchestrator clearance required first (A1):** the EF migration `AdminIdentityFoundation`, `Program.cs` edits, `App.tsx` / `staffRouteRegistry.tsx` edits and every frozen-type change (`Session`/`SessionDto`, `ExerciseRole`, `StaffAssignment` -> `Enrollment`, the staff login request) go through the orchestrator; post the frozen-type changes on the feature issue before A1 merges (brief C1.4). Builders export one `Add*()`/`Map*()` line each; they do not edit `Program.cs`.

## Dependencies
Wave A1 after 16 (reads `Enrollment.Role`). Feeds identity 04 and exercise-lifecycle-admin 01/03.

## Tests
`RoleMatrixTests` (the matrix), per-transition tests, the standing isolation suite with foreign-org cases.

All under `src/Pulse.WebApi.Tests/Features/Identity/RoleMatrix/` unless noted.
- `RoleMatrixTests.EveryMappedMutatingRoute_HasAnExplicitMatrixRow_AndEveryRowIsMapped` (AC5: unlisted route fails)
- `RoleMatrixTests.PreAuthRows_AreExactlyTheAnonymousAllowlistedMutatingRoutes` (AC5, self-service rows)
- `RoleMatrixTests.EveryProbedRoute_AnswersEachRoleAsTheMatrixSays` (AC2, AC3, AC4, AC5; orgAdmin/planner/controller/lead/evaluator/participant/pio/readonly/anonymous)
- `LifecycleTransitionRoleTests.Transition_IsAppliedOnlyForItsRole_AndARefusalLeavesTheStateUnchanged` (AC1, AC4, telemetry AC)
- `LifecycleTransitionRoleTests.NotYetBuiltTransitions_AreAlreadyRoleChecked_TheRightRoleReachesTheStateMachine` (AC1: unstage/reopen)
- `LifecycleTransitionRoleTests.ArchiveFromBuild_IsAllowedForThePlannerOnlyOnceTheExerciseHasGoneLive` (AC1)
- `LifecycleTransitionRoleTests.AnOrgAdmin_ActsInTheExerciseOnlyThroughTheEnrollmentTheyHold` (AC4)
- `OrgRowActionRoleTests.CreateExercise_IsOrgAdminOnly` (AC2)
- `OrgRowActionRoleTests.Rename_ByAPlanner_ReachesOnlyTheirOwnExercise_AndEveryOtherIdIsTheSameBare404` (bare-404, isolation AC)
- `OrgRowActionRoleTests.Archive_OnTheOrgTier_IsAllowedFromBuildOnceTheExerciseHasGoneLive` (AC1)
- `OrgRowActionRoleTests.SetLead_IsPlannerOnly` (orchestrator fold: set-lead row)
- `LeadControllerGateTests.RaiseNeedsTheLead_LowerIsAnyController_PlannerAndEvaluatorNeither` (lead folds, L-002)
- `LeadControllerGateTests.ANonLead_ClaimingTheLeadsIdInTheBody_IsStillRefused_AndAPromotionTakesEffectLiveWithoutReSignIn` (lead filter live, session-keyed)
- `StaffAuthoringTests.StaffPostAsPersona_FollowsSetupVsConduct`, `StaffAuthoringTests.StaffPin_FollowsSetupVsConduct` (Copilot 5 fold)
- `StaffAuthoringTests.ParticipantSimPost_IsAcceptedInLiveAndStaged` (Copilot 2 fold, live + staged half)
- `SelfServiceSessionTests.AnEvaluator_Refreshes_ReadsItsSession_SwitchesBetweenItsOwnEnrollments_AndLogsOut`, `SelfServiceSessionTests.AParticipantSession_IsRefusedOnBothStaffOperations_EvenWhenThePersonIsStaffElsewhere` (Copilot 6 fold)
- `SelfServiceSessionTests.AnEvaluator_ReadsTheExercise` (AC3 reads)
- `SwampedModeLeadLossTests.*` (story 16 M-002 verified/fixed here; M-003 backend half)
- `EngineAmbientPolicyServiceTests.ANonLeadRaise_Is403_AndChangesNothing_WhileTheLeadsSameRequestSucceeds`, `EngineAmbientPolicyServiceTests.ANonLeadLower_Succeeds` (ambient lead gate)
- `EngineAmbientPolicyServiceTests.TheRace_AKillSwitchDemotion_BetweenTheSnapshotAndTrySet_TurnsANonLeadNoOpIntoARefusedRaise`, `EngineAmbientPolicyServiceTests.TheRace_WithoutTheDemotion_TheSameNonLeadRequestIsAllowed` (live lead read, race)
  (`Features/EngineRuntime/Ambient/EngineAmbientPolicyServiceTests.cs`)
- `RoleMatrixTests` ambient-policy row (lead raise / non-lead raise / lower, per role)
- `LeadControllerGateTests` ambient Raise and Lower cases
- `EngineReviewEndpointsTests.*_ASpoofedBodyActingHumanId_IsNotRecorded_TheSessionPersonIs`, four tests: approve, veto, kill switch, autonomy-default (WR-2)
  (`Features/EngineRuntime/EngineReviewEndpointsTests.cs`)

Frontend (under `src/frontend/src/features/`):
- [`AmbientChatterSection.leadGate.test.tsx`](../../../src/frontend/src/features/controller/engine/components/AmbientChatterSection.leadGate.test.tsx): non-lead (Autonomous disabled with the reason, lowering save allowed, raising edit while autonomous disables Save, a 403 shows the message inline); lead (all enabled)
- [`plannerConsole.test.tsx`](../../../src/frontend/src/features/controller/access/plannerConsole.test.tsx) and `staff/staffRouteRegistry.test.tsx`: the planner enters the console (`7a842db6`, `5eecb754`)
- `EngineSettingsServiceTests.AutonomyDefault_TheRace_*`, `EngineSettingsServiceTests.TierPolicy_TheRace_*` (write-time lead read)
- `EngineSettingsServiceTests.*_ANonLeadRaise_Is403_AndChangesNothing_WhileANonLeadLowerSucceeds`
- `LeadControllerGateTests.ANonLead_TurningSwampedModeOn_WhileItIsAlreadyOn_IsStill403`
- `SwampedModeLeadLossTests.TheHeal_*` (2)
- `EngineReviewEndpointsTests.EveryRoute_ASpoofedBodyActingHumanId_IsNotRecorded_TheSessionPersonIs`
- `PauseTierEndpointsTests.Post_ASpoofedBodyActingHumanId_IsNotRecorded_TheSessionPersonIs`
- `OrgRowActionRoleTests.OrgExerciseList_CanManage_FollowsTheRenameArchiveRule` (WR-005 backend)
- Frontend: WR-002 in [`plannerConsole.test.tsx`](../../../src/frontend/src/features/controller/access/plannerConsole.test.tsx) (planner chip, shortcut strip);
  WR-004 in [`SwampedModeToggle.test.tsx`](../../../src/frontend/src/features/controller/engine/components/SwampedModeToggle.test.tsx) (confirm focus, `aria-expanded`, SG-005 note);
  SG-004 in [`rolePermissions.test.tsx`](../../../src/frontend/src/core/auth/rolePermissions.test.tsx) (`scheduled` is build);
  WR-005 in [`ExerciseRowActions.test.tsx`](../../../src/frontend/src/features/exerciseLifecycleAdmin/components/ExerciseRowActions.test.tsx) and `services/orgExercisesService.test.ts` (per-row `canManage`, absent-field fallback)
