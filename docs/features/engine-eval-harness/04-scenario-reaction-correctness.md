# Story: Scenario reaction-correctness tests

**Feature:** Engine eval harness  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Built — In Review
**Requirements:** §12.4, ADP-001, ADP-002a, ADP-042, CTL-034  ·  **Design decisions:** none  ·  **Issue:** #178

## Context
The hardest and most important suite: **did the world react correctly to action *and inaction*?**
End-to-end scenario tests assert the reaction loop's behavior, including the safety-critical
miss-safe default (anti-berate-the-PIO) and the CTL-034 workload budget. A regression in the
miss-safe or kill-switch scenarios **blocks release**.

## Acceptance Criteria
- [x] Given a storyline whose window blows with no official response, when the scenario runs, then
      intensity rises per the curve and anxiety/speculation content appears (**inaction → escalation**,
      ADP-001). Rise at the configured curve rate (D1 fixed), sentiment souring, cadence, anxious/speculative
      content, and the silence-duration tone ramp in both the decided intent and the provider prompt (D2, D3 fixed)
      are asserted.
- [x] Given a *matched* official response, when it lands, then intensity/sentiment bend down and a
      response-reaction burst appears (**action → calming**, ADP-002).
- [x] Given an *unmatched* official post, when it lands, then escalation **slows but does not pause**,
      the controller is prompted, and the storyline is **not** marked addressed — the
      **anti-berate-the-PIO** test (ADP-002a, adversarial review D4); a regression here blocks release.
- [x] Given an off-platform marker (CTL-026), when set, then the storyline is treated as addressed
      identically to an on-platform match.
- [x] Given the kill switch or degraded-mode trip, when fired, then autonomy drops to Suggest and
      nothing auto-publishes (ADP-042); given rate caps / quiet floors, then no firehose and no
      flatline (ADP-011).
- [x] Given NFR-002 burst load at Delayed-auto, when measured, then sustained controller **demand
      ≤6/min** (CTL-034); a design that breaches it fails the suite. Queue-fire demand and the prompt-inclusive
      CTL-034 total (queue fires + response-match prompts) are both asserted ≤6/min (D4 fixed).

## Out of Scope
The behaviors themselves (silence-escalation / response-reaction / autonomy-safety / storyline-model
implement them — this *verifies* them end to end); voice metrics (story 01); injection (story 02);
raw SLOs (story 03).

## Technical Notes
Staff/backend. Scripted scenarios driving the reaction loop against a fixture exercise, asserting
storyline state transitions + generated-content properties + demand counts. The miss-safe and
kill-switch scenarios are release-gating. See implementation.md (story 04) and architecture §12.4.

## Dependencies
reaction-loop, storyline-model, silence-escalation, response-reaction, autonomy-safety,
amplification-engine (the behaviors under test); off-platform marker (#29); the Vitest harness /
future backend test suite.

## Tests
- The suite itself: each scenario (inaction→escalation, action→calming, miss-safe slow-not-pause,
  off-platform parity, kill-switch/degraded→Suggest, cap/floor honored, demand ≤6/min) asserts the
  correct end-to-end behavior; miss-safe + kill-switch regressions block release.

## Built (issue #178)

Suite: `src/Pulse.WebApi.Tests/Features/EngineEval/ReactionCorrectness/` (Docker-free; runs locally and in CI).
A scenario reads like a script: `ReactionScenario` (the fixture) builds a fixture exercise, plays scenario time
minute by minute against the REAL `ReactionLoopDriver` + storyline/autonomy/miss-safe code, injects official
posts / off-platform markers / a kill switch / a provider degrade, and asserts on observable outputs. Only the
generation provider is faked (`RecordingFakeProvider`: the deterministic Fake provider, recording each prompt) and
the publish funnel is a recording double. No Organization/StaffAssignment rows are seeded (the loop needs only the
tick's server-derived exercise scope).

**Controller demand (CTL-034), as measured here:** the decisions the controller is asked for in one scenario
minute = one per review-queue item (one burst = one decision, however many posts) + one per response-match prompt
(an official post the engine could not confirm on its own). The production `WorkloadDemandMeter` records and
budgets both against one cap: queue fires, and (since D4) response-match prompts.

The two release-blocking classes carry `[Trait("Category", "ReleaseBlocking")]`
(`dotnet test --filter Category=ReleaseBlocking`).

| AC | Test class | Tests |
|----|-----------|-------|
| 1 inaction -> escalation | `InactionEscalationScenarioTests` | `WhileTheResponseWindowIsStillOpen_TheWorldStaysQuiet`, `WhenTheWindowBlowsWithNoResponse_TheConcernEscalatesAndAnAnxiousBurstIsQueued`, `WhileOfficialsStaySilent_IntensityKeepsRisingAlongTheCurve_AndSentimentSours`, `EveryInactionBurstAsksTheProviderForWorryAndSpeculation_AndNamesTheSilence`, `OngoingSilence_ReactsOnTheReactionCadence_NotOnEveryTick`, `AsTheSilenceRunsOn_TheDecidedToneShiftsFromWorryTowardSpeculationAndAnger` (D2), `AsTheSilenceRunsOn_TheProviderIsAskedForTheDecidedEscalatingMix` (D3) |
| 2 action -> calming | `ActionCalmingScenarioTests` | `AMatchedOfficialResponse_BendsIntensityDown_AndSentimentUp_AndMarksTheConcernAddressed`, `..._DrawsAGratitudeLedReactionBurst_NotAnotherRoundOfWorry`, `AfterTheResponse_TheConcernDecaysAndTheEngineStopsEscalatingIt`, `APlausibleButUnconfirmedAnswer_DoesNotCalmTheWorld_UntilAControllerConfirmsIt` |
| 3 anti-berate-the-PIO (**ReleaseBlocking**) | `MissSafeAntiBeratePioScenarioTests` | `AnUnmatchedOfficialPost_SlowsTheNextBurst_ButNeverPausesIt` (x2 auto-confirm), `AnUnmatchedOfficialPost_IsNeverTreatedAsAnswerOrAsSilence_AndNeverMarksTheConcernAddressed` (x2), `AnUnmatchedOfficialPost_PromptsTheController_ToSayWhichConcernItAddressed`, `APlausibleButUnconfirmedAnswer_AlsoSlowsWithoutPausing_AndLeavesTheConcernUnaddressed`, `ARepeatedStreamOfIrrelevantPosts_CannotPauseOrCalmTheWorld`, `AFloodOfIrrelevantPostsThatSaturatesTheDemandBudget_StillCannotPauseEscalation` (x2: 6, 10 posts/min), `AnAnswerLandingAmidAPromptSaturatingFlood_StillDrawsItsResponseBurst` |
| 4 off-platform parity | `OffPlatformMarkerParityScenarioTests` | `AnOffPlatformMarker_AddressesTheConcern_IdenticallyToAnOnPlatformMatch`, `AnOffPlatformMarker_IsAConfirmedMatch_EvenWithoutAutoConfirm`, `TheOnlyDifferenceBetweenTheTwoSources_IsTheRecordedCause`, `AfterAMarker_TheConcernDecaysAndStopsEscalating_JustAsAfterAnOnPlatformAnswer` |
| 5a kill switch / degraded (**ReleaseBlocking**) | `KillSwitchAndDegradedScenarioTests` | `WithoutAnyLever_SwampedModeAutoSendsAnExpiredCountdown` (positive control), `TheKillSwitch_SuspendsAnInFlightCountdown_AndNothingAutoPublishes` (DropToSuggest, FullStop), `DropToSuggest_KeepsTheEngineRunning_ButEveryNewBurstWaitsForAHuman`, `FullStop_GeneratesNothingAtAll_AfterTheLever`, `ADegradedProviderTrip_DropsToSuggest_AndNothingAutoPublishes`, `ProviderRecovery_NeverRaisesAutonomyOnItsOwn_OnlyAHumanRestoreDoes`, `FullStop_ExpiryThenRestore_UnderSwampedMode_NothingAutoPublishes_AndTheItemStaysHeld` (D5) |
| 5b caps / floors | `RateCapAndQuietFloorScenarioTests` | `UnderHeavyPressure_EngineOutputNeverExceedsThePerMinuteCap`, `TheCapRationsPosts_ButTheWorldNeverGoesQuietWhileConcernsAreUnanswered`, `AQuietExercise_IsNeverDead_AndNeverBuried` |
| 6 CTL-034 | `ControllerDemandBudgetScenarioTests` | `AtBurstLoadOnDelayedAuto_NoScenarioMinuteDemandsMoreThanTheBudget`, `TheSustainedRate_StaysWithinBudget_AsTheProductionMeterMeasuresIt`, `APerPostDecisionDesign_WouldHaveBreachedTheBudgetUnderTheSameLoad`, `AtBurstLoadWithAMatchPromptEveryMinute_TotalControllerDemandStaysWithinTheBudget` (D4) |

Known scope limit: the live loop does not raise a controller-prompt artifact of its own yet (the cockpit match
prompt is a separate surface), so "the controller is prompted" is asserted at the resolver seam
(`Unmatched` / `NeedsConfirmation` + `DemandAccounting.MatchPromptDemand`).

### Defects found (all fixed; each now asserted by the suite)

- **D1 - Standard-curve rise ran at 2.0/min, not 2.5/min. FIXED** (branch `fix/engine-reaction-d1-d4`,
  "fix(engine): D1 ..."). `IntensityModel.Tick` rounded each per-minute step with `Math.Round` (banker's), so +2.5
  became +2. The rise/decay step is now quantized against absolute scenario time
  (`IntensityModel.CurveStep`: `floor(rate x to) - floor(rate x from)`, anchored on the storyline's existing
  `LastTickScenarioMinute`), which telescopes to the true rate under any tick granularity; no new persisted state.
  Also applied to `TickTowardTarget` (dial follow). The anchor is clamped to minute 0. **Decay changes too
  (expected, PR #634 W-003):** fractional decay rates now run at their true rate as well, so Slow burn's addressed
  decay is 0.6/min (it used to round to 1/min per tick), i.e. an addressed Slow-burn concern calms ~40% slower than
  before; Standard (2.0/min) and Flash panic (5.0/min) decay are unchanged. Asserted: `IntensityModelTests`
  (incl. per-minute `TickTowardTarget_AnchoredPerMinute_*` rise 2.5/min, decay 0.6/min, no overshoot) /
  `StorylineTickTests.Tick_EveryScenarioMinute_StandardCurve_ReachesSpecIntensityAtMinute50` (minute 50 = 78) and
  `InactionEscalationScenarioTests.WhileOfficialsStaySilent_IntensityKeepsRisingAlongTheCurve_AndSentimentSours`.
- **D2 - `SilenceEscalationBehavior` was never registered. FIXED** ("fix(engine): D2 ..."). `ReactionLoopDriver`
  now registers it for the Inaction trigger alongside `ResponseReactionBehavior` (one behavior per trigger kind;
  response-vs-inaction precedence stays the loop's). Asserted:
  `InactionEscalationScenarioTests.AsTheSilenceRunsOn_TheDecidedToneShiftsFromWorryTowardSpeculationAndAnger`.
- **D3 - the decided intent's `ToneMix` never reached the provider prompt. FIXED** ("fix(engine): D3 ...").
  `BuildGenerateRequest` now sends `storyline.ToBrief() with { ToneMix = intent.ToneMix }`. Asserted:
  `ActionCalmingScenarioTests.AMatchedOfficialResponse_DrawsAGratitudeLedReactionBurst_NotAnotherRoundOfWorry`
  (prompt = `ResponseReactionBehavior.DefaultMix`: gratitude 0.5 / calm 0.3 / skepticism 0.15 / worry 0.05) and
  `InactionEscalationScenarioTests.AsTheSilenceRunsOn_TheProviderIsAskedForTheDecidedEscalatingMix`.
- **D4 - CTL-034 was breached when match prompts are counted. FIXED** ("fix(engine): D4 ..."). Every official
  post the engine could not confirm on its own now records a `DemandEventKind.ResponseMatchPrompt` on the tick's
  demand meter before bursts are decided, so bursts ordinarily get only the budget the prompts left (cap unchanged
  at 6). **Saturation / minimum service (PR #634 CR-001, W-001):** prompt demand alone never starves engine work,
  because miss-safe (ADP-002a) outranks CTL-034 when the demand comes from participants/PIOs we cannot throttle.
  The gate (`ReactionLoopDriver.PassesDemandGate`), with total = all demand this minute and engine = total minus
  prompt demand: response (gratitude) work passes while engine < cap, never gated by prompts (it is voiced only on
  the addressing tick); inaction work passes while total < cap, or, when the engine has demanded nothing yet this
  minute and the storyline is Escalating/Peak, the first burst the cadence already decided to fire goes out anyway
  (it never creates a burst). So when 6+ unconfirmed posts a minute saturate the budget, total demand can exceed the
  cap, but only by engine minimum service (at most one inaction burst plus response work). Asserted:
  `ControllerDemandBudgetScenarioTests.AtBurstLoadWithAMatchPromptEveryMinute_TotalControllerDemandStaysWithinTheBudget`
  (24 blown storylines + 1 prompt/min stays <= 6), and (ReleaseBlocking)
  `MissSafeAntiBeratePioScenarioTests.AFloodOfIrrelevantPostsThatSaturatesTheDemandBudget_StillCannotPauseEscalation`
  (6 and 10 posts/min: fires equal the post-free control, minute for minute) and
  `MissSafeAntiBeratePioScenarioTests.AnAnswerLandingAmidAPromptSaturatingFlood_StillDrawsItsResponseBurst`.
- **D5 - HIGH: an expired countdown auto-sent after a FullStop was restored (swamped mode). FIXED on main by
  #620** (`AutoHoldPolicy.Evaluate`: an expired undecided countdown under GenerationStopped -> Hold with a
  hold-on-expiry event). Asserted (release-blocking):
  `KillSwitchAndDegradedScenarioTests.FullStop_ExpiryThenRestore_UnderSwampedMode_NothingAutoPublishes_AndTheItemStaysHeld`
  (FullStop -> expiry -> restore with `TimeoutAutoSendAuthorized=true` in the harness -> nothing auto-publishes,
  item Held), and `TheKillSwitch_SuspendsAnInFlightCountdown_AndNothingAutoPublishes(FullStop)` now asserts Held.
- **Observations (not asserted):** (a) under a tight cap, storylines are served in registration order, so with
  10 simultaneous storylines at cap 3/min, 4 are never voiced in 40 minutes (no rotation / staleness priority).
