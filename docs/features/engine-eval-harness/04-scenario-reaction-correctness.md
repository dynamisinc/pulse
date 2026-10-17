# Story: Scenario reaction-correctness tests

**Feature:** Engine eval harness  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** Built — In Review
**Requirements:** §12.4, ADP-001, ADP-002a, ADP-042, CTL-034  ·  **Design decisions:** none  ·  **Issue:** #178

## Context
The hardest and most important suite: **did the world react correctly to action *and inaction*?**
End-to-end scenario tests assert the reaction loop's behavior, including the safety-critical
miss-safe default (anti-berate-the-PIO) and the CTL-034 workload budget. A regression in the
miss-safe or kill-switch scenarios **blocks release**.

## Acceptance Criteria
- [~] Given a storyline whose window blows with no official response, when the scenario runs, then
      intensity rises per the curve and anxiety/speculation content appears (**inaction → escalation**,
      ADP-001). *Partial:* rise (monotonic, bounded by the curve rate and ceiling), sentiment souring, cadence and
      anxious/speculative content are asserted; "exactly per the curve" and a silence-duration tone ramp are NOT
      (product defects D1-D5 below).
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
- [~] Given NFR-002 burst load at Delayed-auto, when measured, then sustained controller **demand
      ≤6/min** (CTL-034); a design that breaches it fails the suite. *Partial:* queue-fire demand (the production
      meter's unit) is asserted ≤6/min; the prompt-inclusive CTL-034 total reaches 7/min (defect D4 below).

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
(an official post the engine could not confirm on its own). The queue-fire part is exactly what the production
`WorkloadDemandMeter` records and budgets; the prompt part follows the CTL-034 text.

The two release-blocking classes carry `[Trait("Category", "ReleaseBlocking")]`
(`dotnet test --filter Category=ReleaseBlocking`).

| AC | Test class | Tests |
|----|-----------|-------|
| 1 inaction -> escalation | `InactionEscalationScenarioTests` | `WhileTheResponseWindowIsStillOpen_TheWorldStaysQuiet`, `WhenTheWindowBlowsWithNoResponse_TheConcernEscalatesAndAnAnxiousBurstIsQueued`, `WhileOfficialsStaySilent_IntensityKeepsRisingAlongTheCurve_AndSentimentSours`, `EveryInactionBurstAsksTheProviderForWorryAndSpeculation_AndNamesTheSilence`, `OngoingSilence_ReactsOnTheReactionCadence_NotOnEveryTick` |
| 2 action -> calming | `ActionCalmingScenarioTests` | `AMatchedOfficialResponse_BendsIntensityDown_AndSentimentUp_AndMarksTheConcernAddressed`, `..._DrawsAGratitudeLedReactionBurst_NotAnotherRoundOfWorry`, `AfterTheResponse_TheConcernDecaysAndTheEngineStopsEscalatingIt`, `APlausibleButUnconfirmedAnswer_DoesNotCalmTheWorld_UntilAControllerConfirmsIt` |
| 3 anti-berate-the-PIO (**ReleaseBlocking**) | `MissSafeAntiBeratePioScenarioTests` | `AnUnmatchedOfficialPost_SlowsTheNextBurst_ButNeverPausesIt` (x2 auto-confirm), `AnUnmatchedOfficialPost_IsNeverTreatedAsAnswerOrAsSilence_AndNeverMarksTheConcernAddressed` (x2), `AnUnmatchedOfficialPost_PromptsTheController_ToSayWhichConcernItAddressed`, `APlausibleButUnconfirmedAnswer_AlsoSlowsWithoutPausing_AndLeavesTheConcernUnaddressed`, `ARepeatedStreamOfIrrelevantPosts_CannotPauseOrCalmTheWorld` |
| 4 off-platform parity | `OffPlatformMarkerParityScenarioTests` | `AnOffPlatformMarker_AddressesTheConcern_IdenticallyToAnOnPlatformMatch`, `AnOffPlatformMarker_IsAConfirmedMatch_EvenWithoutAutoConfirm`, `TheOnlyDifferenceBetweenTheTwoSources_IsTheRecordedCause`, `AfterAMarker_TheConcernDecaysAndStopsEscalating_JustAsAfterAnOnPlatformAnswer` |
| 5a kill switch / degraded (**ReleaseBlocking**) | `KillSwitchAndDegradedScenarioTests` | `WithoutAnyLever_SwampedModeAutoSendsAnExpiredCountdown` (positive control), `TheKillSwitch_SuspendsAnInFlightCountdown_AndNothingAutoPublishes` (DropToSuggest, FullStop), `DropToSuggest_KeepsTheEngineRunning_ButEveryNewBurstWaitsForAHuman`, `FullStop_GeneratesNothingAtAll_AfterTheLever`, `ADegradedProviderTrip_DropsToSuggest_AndNothingAutoPublishes`, `ProviderRecovery_NeverRaisesAutonomyOnItsOwn_OnlyAHumanRestoreDoes` |
| 5b caps / floors | `RateCapAndQuietFloorScenarioTests` | `UnderHeavyPressure_EngineOutputNeverExceedsThePerMinuteCap`, `TheCapRationsPosts_ButTheWorldNeverGoesQuietWhileConcernsAreUnanswered`, `AQuietExercise_IsNeverDead_AndNeverBuried` |
| 6 CTL-034 | `ControllerDemandBudgetScenarioTests` | `AtBurstLoadOnDelayedAuto_NoScenarioMinuteDemandsMoreThanTheBudget`, `TheSustainedRate_StaysWithinBudget_AsTheProductionMeterMeasuresIt`, `APerPostDecisionDesign_WouldHaveBreachedTheBudgetUnderTheSameLoad` |

Known scope limit: the live loop does not raise a controller-prompt artifact of its own yet (the cockpit match
prompt is a separate surface), so "the controller is prompted" is asserted at the resolver seam
(`Unmatched` / `NeedsConfirmation` + `DemandAccounting.MatchPromptDemand`).

### Defects found (NOT asserted, NOT fixed here; to be fixed in separate PRs, then the matching assertion added)

- **D1 - Standard-curve rise runs at 2.0/min, not 2.5/min.** `IntensityModel.Tick` rounds each tick with
  `Math.Round` (banker's rounding) and the loop ticks every scenario minute, so +2.5 rounds to +2 every time.
  Repro: Standard curve, window 20, tick each minute: intensity at minute 50 is 62 (spec: ~78).
- **D2 - `SilenceEscalationBehavior` is never registered.** `ReactionLoopDriver` registers only
  `ResponseReactionBehavior`, so the silence-duration tone ramp (`SilenceRules.EscalationTone`) never runs; the
  mix is flat for the whole Escalating phase (worry 0.3 / speculation 0.3 from minute 20 to Peak).
- **D3 - the decided intent's `ToneMix` never reaches the provider prompt.** `BuildGenerateRequest` sends
  `storyline.ToBrief()` (the phase-derived mix); the intent's mix only appears in `engine.decided` telemetry. So
  the tunable response-reaction mix (gratitude 0.5 / calm 0.3 ...) is not what the provider is asked for
  (observed prompt: gratitude 0.4 / calm 0.2).
- **D4 - CTL-034 is breached when match prompts are counted.** The loop budgets queue fires only. With 24 blown
  storylines at Delayed-auto (fires saturate at 6/min) and one unconfirmed official post per minute (1 prompt/min),
  total controller demand is 7/min for 36 consecutive minutes.
- **D5 - HIGH: an expired countdown auto-sends after a FullStop is restored (swamped mode).** After a FullStop,
  a pre-stop undecided countdown that has expired is left `CountingDown`; on the first sweep after a human restore
  with swamped mode on, it auto-publishes (stale burst goes out at restore). Fix: a separate safety PR to main (`AutoHoldPolicy.Evaluate`:
  expired undecided countdown under GenerationStopped -> Hold with a hold-on-expiry event). This suite does not
  assert the buggy or fixed state for that case. Follow-up once that safety fix is on main: add the release-blocking scenario
  "FullStop -> expiry -> restore -> nothing auto-publishes, item Held".
- **Observations (not asserted):** (a) under a tight cap, storylines are served in registration order, so with
  10 simultaneous storylines at cap 3/min, 4 are never voiced in 40 minutes (no rotation / staleness priority).
