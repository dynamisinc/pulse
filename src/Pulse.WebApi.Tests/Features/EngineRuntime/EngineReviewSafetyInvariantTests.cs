namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Publishing;
using Pulse.WebApi.Features.EngineRuntime.Review;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Pulse.WebApi.Tests.Helpers;
using Xunit;

/// <summary>
/// The SAFETY-INVARIANT release gate for story 02 (E8 §8.2) — the load-bearing negatives, as PURE tests that
/// RUN LOCALLY WITHOUT DOCKER. Where the sibling <see cref="EngineReviewServiceTests"/> proves the same
/// wiring against a real SQL Server (Testcontainers, so it only runs in CI), this suite drives the identical
/// <see cref="EngineReviewService"/> logic — plus the pure <see cref="AutoHoldPolicy"/> it delegates to —
/// against a fake <see cref="IEngineReviewStore"/> and a fake <see cref="IEnginePublishService"/>, with an
/// EF in-memory <see cref="PulseDbContext"/> as the incidental telemetry sink. Because the safety invariants
/// are the release gate, they must be provable on ANY developer machine, not only where Docker is up.
/// </summary>
/// <remarks>
/// The invariants proven here, each as the NEGATIVE (nothing published unless a human/explicit path allows):
/// <list type="number">
///   <item>(a) A Delayed-auto countdown expiring with NO decision HOLDs and does NOT publish — silence is
///   never approval (D5-014/1.1). The load-bearing negative: the publish seam is asserted NOT called.</item>
///   <item>(b) Swamped mode is the ONLY path that auto-sends on expiry (and only while still effectively
///   Delayed-auto).</item>
///   <item>(c) Kill switch + degraded clamp only LOWER autonomy, suspend in-flight countdowns (HOLD, never
///   send, even under swamped mode), and never auto-recover / self-raise.</item>
///   <item>(d) Autonomy never self-escalates — <see cref="AutonomyLevel.Auto"/> is rejected, and no control
///   raises the level.</item>
///   <item>(e) approve / veto / re-roll / batch each drive the right disposition and emit exactly one
///   <c>engine.reviewed</c> (one per DECISION, not per post).</item>
///   <item>(f) edit SANITIZES the new text (NFR-004) before publishing through the same seam.</item>
/// </list>
/// </remarks>
public sealed class EngineReviewSafetyInvariantTests
{
    private static readonly DateTimeOffset ScenarioStart = new(2033, 6, 14, 9, 0, 0, TimeSpan.Zero);

    // ==== (a) Auto-HOLD on expiry — silence is NEVER approval (the load-bearing negative) ============

    [Fact]
    public async Task AutoHold_CountdownExpiresWithNoDecision_Holds_NeverPublishes_EmitsHoldOnExpiry()
    {
        var exerciseId = Guid.NewGuid();
        var item = Countdown(exerciseId, started: 0, minutes: 3);
        using var harness = Build(exerciseId, item);
        harness.Advance(minutes: 4); // past the scenario-minute deadline (3), no decision recorded

        await harness.Service.EvaluateAutoHoldAsync();

        harness.Publisher.Bursts.Should().BeEmpty(
            "silence is NEVER approval — an expired countdown with no decision must never auto-send (D5-014/1.1)");
        item.Disposition.Should().Be(DraftDisposition.Held, "the draft auto-HOLDs for the controller (NEEDS YOU)");
        var reviewed = await harness.ReviewedEventsAsync(item.DraftId);
        reviewed.Should().ContainSingle("exactly one engine.reviewed per decision");
        Action(reviewed[0]).Should().Be("hold-on-expiry");
        reviewed[0].Actor.ActingHumanId.Should().BeNull("an auto-HOLD is silence, not a human decision — no acting human");
    }

    [Fact]
    public async Task AutoHold_NotYetExpired_LeavesCountingDown_NothingPublishesOrLogs()
    {
        var exerciseId = Guid.NewGuid();
        var item = Countdown(exerciseId, started: 0, minutes: 5);
        using var harness = Build(exerciseId, item);
        harness.Advance(minutes: 2); // still before the deadline (5)

        await harness.Service.EvaluateAutoHoldAsync();

        harness.Publisher.Bursts.Should().BeEmpty();
        item.Disposition.Should().Be(DraftDisposition.CountingDown);
        (await harness.ReviewedEventsAsync(item.DraftId)).Should().BeEmpty("a still-running countdown is not a decision");
    }

    /// <summary>The pure policy the service delegates to — proven directly so the gate does not rely on the wiring alone.</summary>
    [Fact]
    public void AutoHoldPolicy_ExpiredNoDecision_ResolvesToHold_NotPublish()
    {
        var countdown = new DelayedAutoCountdown(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), 0, 3);
        var evaluation = AutoHoldPolicy.Evaluate(
            countdown, EffectiveAutonomy.Running(AutonomyLevel.DelayedAuto), currentScenarioMinute: 5, swampedMode: false);

        evaluation.Disposition.Should().Be(TimeoutDisposition.Hold, "silence is never approval (§8.2)");
        evaluation.ViaSwampedMode.Should().BeFalse();
        evaluation.Event.Should().NotBeNull("an on-expiry no-decision resolution is a hold-on-expiry transition to log");
    }

    // ==== (b) Swamped mode is the ONLY auto-send-on-expiry path =======================================

    [Fact]
    public async Task AutoHold_SwampedModeAndEffectiveDelayedAuto_AutoSends_EmitsAutoSend()
    {
        var exerciseId = Guid.NewGuid();
        var item = Countdown(exerciseId, started: 0, minutes: 3);
        using var harness = Build(exerciseId, item);

        // The ONLY auto-send path: an explicit lead swamped-mode toggle AND the draft still effectively Delayed-auto.
        var state = harness.Registry.GetOrCreate(exerciseId);
        state.SetStorylineOverride(item.StorylineId, AutonomyLevel.DelayedAuto, "lead-1", 0);
        state.SetSwampedMode(enabled: true, "lead-1", 0);
        harness.Advance(minutes: 4);

        await harness.Service.EvaluateAutoHoldAsync();

        harness.Publisher.Bursts.Should().ContainSingle("swamped mode is the ONLY timeout auto-send path (#36)")
            .Which.DraftId.Should().Be(item.DraftId);
        item.Disposition.Should().Be(DraftDisposition.Published);
        Action((await harness.ReviewedEventsAsync(item.DraftId)).Should().ContainSingle().Subject).Should().Be("auto-send");
    }

    [Fact]
    public async Task AutoHold_SwampedModeButEffectiveOnlySuggest_Holds_NeverSends()
    {
        var exerciseId = Guid.NewGuid();
        var item = Countdown(exerciseId, started: 0, minutes: 3);
        using var harness = Build(exerciseId, item);

        // Swamped mode is on, but the effective level is only Suggest (no Delayed-auto override) — swamped mode
        // ALONE is not enough; the draft must still be effectively Delayed-auto to auto-send.
        harness.Registry.GetOrCreate(exerciseId).SetSwampedMode(enabled: true, "lead-1", 0);
        harness.Advance(minutes: 4);

        await harness.Service.EvaluateAutoHoldAsync();

        harness.Publisher.Bursts.Should().BeEmpty("swamped mode without an effective Delayed-auto level never auto-sends");
        item.Disposition.Should().Be(DraftDisposition.Held);
    }

    // ==== (b') Hold-on-cut: a provider cut to Fake suspends the swamped auto-send (ADP-042) ==========

    [Fact]
    public async Task AutoHold_CutToFake_HoldsEvenUnderSwampedMode_WhileUncutSiblingExerciseStillAutoSends()
    {
        // Two exercises share ONE process-wide cut registry (as in production); only A is cut.
        var cuts = new GenerationProviderCutRegistry();
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var itemA = Countdown(exerciseA, started: 0, minutes: 3);
        var itemB = Countdown(exerciseB, started: 0, minutes: 3);
        using var harnessA = new Harness(exerciseA, new[] { itemA }, cuts);
        using var harnessB = new Harness(exerciseB, new[] { itemB }, cuts);

        foreach (var (harness, item, exerciseId) in new[] { (harnessA, itemA, exerciseA), (harnessB, itemB, exerciseB) })
        {
            var state = harness.Registry.GetOrCreate(exerciseId);
            state.SetStorylineOverride(item.StorylineId, AutonomyLevel.DelayedAuto, "lead-1", 0);
            state.SetSwampedMode(enabled: true, "lead-1", 0);
            harness.Advance(minutes: 4);
        }

        // The live draft was generated (and its countdown started) BEFORE the cut.
        cuts.Cut(exerciseA);

        await harnessA.Service.EvaluateAutoHoldAsync();
        await harnessB.Service.EvaluateAutoHoldAsync();

        harnessA.Publisher.Bursts.Should().BeEmpty(
            "while an exercise is cut to Fake, a pre-cut Delayed-auto draft must never auto-send — even under swamped mode");
        itemA.Disposition.Should().Be(DraftDisposition.Held, "the expiry resolves to the ordinary 'timer expired — held for you'");
        var reviewedA = await harnessA.ReviewedEventsAsync(itemA.DraftId);
        Action(reviewedA.Should().ContainSingle("exactly one engine.reviewed per decision").Subject).Should().Be("hold-on-expiry");
        reviewedA[0].Actor.ActingHumanId.Should().BeNull("a hold-on-cut is still silence, not a human decision");

        harnessB.Publisher.Bursts.Should().ContainSingle("the cut is per-exercise (COR-001) — an uncut sibling keeps its swamped auto-send")
            .Which.DraftId.Should().Be(itemB.DraftId);
        itemB.Disposition.Should().Be(DraftDisposition.Published);
        Action((await harnessB.ReviewedEventsAsync(itemB.DraftId)).Should().ContainSingle().Subject).Should().Be("auto-send");
    }

    [Fact]
    public async Task AutoHold_AfterRestore_HeldCountdownStaysHeld_NewExpiryResumesSwampedAutoSend()
    {
        var exerciseId = Guid.NewGuid();
        var heldDuringCut = Countdown(exerciseId, started: 0, minutes: 3);
        var laterCountdown = Countdown(exerciseId, started: 0, minutes: 6);
        using var harness = Build(exerciseId, heldDuringCut, laterCountdown);

        var state = harness.Registry.GetOrCreate(exerciseId);
        state.SetStorylineOverride(heldDuringCut.StorylineId, AutonomyLevel.DelayedAuto, "lead-1", 0);
        state.SetStorylineOverride(laterCountdown.StorylineId, AutonomyLevel.DelayedAuto, "lead-1", 0);
        state.SetSwampedMode(enabled: true, "lead-1", 0);

        harness.ProviderCut.Cut(exerciseId);
        harness.Advance(minutes: 4);
        await harness.Service.EvaluateAutoHoldAsync();
        heldDuringCut.Disposition.Should().Be(DraftDisposition.Held);
        laterCountdown.Disposition.Should().Be(DraftDisposition.CountingDown, "its deadline has not passed yet");

        harness.ProviderCut.Restore(exerciseId);
        harness.Advance(minutes: 3);
        await harness.Service.EvaluateAutoHoldAsync();

        heldDuringCut.Disposition.Should().Be(DraftDisposition.Held, "a countdown already resolved to HOLD stays held after a restore");
        Action((await harness.ReviewedEventsAsync(heldDuringCut.DraftId)).Should().ContainSingle(
            "the restore never re-resolves a held countdown — its one hold-on-expiry decision is the only engine.reviewed").Subject)
            .Should().Be("hold-on-expiry");
        harness.Publisher.Bursts.Should().ContainSingle("after the restore the ordinary swamped-mode rule resumes for still-running countdowns")
            .Which.DraftId.Should().Be(laterCountdown.DraftId);
        laterCountdown.Disposition.Should().Be(DraftDisposition.Published);
    }

    [Fact]
    public async Task AutoHold_CutLandsMidTick_LaterExpiredItemHolds_NotPublished()
    {
        var exerciseId = Guid.NewGuid();
        var first = Countdown(exerciseId, started: 0, minutes: 3);
        var second = Countdown(exerciseId, started: 0, minutes: 3);
        using var harness = Build(exerciseId, first, second);

        var state = harness.Registry.GetOrCreate(exerciseId);
        state.SetStorylineOverride(first.StorylineId, AutonomyLevel.DelayedAuto, "lead-1", 0);
        state.SetStorylineOverride(second.StorylineId, AutonomyLevel.DelayedAuto, "lead-1", 0);
        state.SetSwampedMode(enabled: true, "lead-1", 0);
        harness.Advance(minutes: 4);

        // The controller cuts to Fake while the swamped tick is awaiting the FIRST burst's publish.
        harness.Publisher.OnPublish = _ => harness.ProviderCut.Cut(exerciseId);

        await harness.Service.EvaluateAutoHoldAsync();

        var published = harness.Publisher.Bursts.Should().ContainSingle(
            "only the burst whose publish was already under way when the cut landed reaches the feed").Subject;
        var (sent, held) = published.DraftId == first.DraftId ? (first, second) : (second, first);

        sent.Disposition.Should().Be(DraftDisposition.Published);
        Action((await harness.ReviewedEventsAsync(sent.DraftId)).Should().ContainSingle().Subject).Should().Be("auto-send");

        held.Disposition.Should().Be(
            DraftDisposition.Held,
            "a cut that lands mid-tick holds every later expiry — the cut is re-checked before each auto-send publish");
        var reviewed = await harness.ReviewedEventsAsync(held.DraftId);
        Action(reviewed.Should().ContainSingle("exactly one engine.reviewed per resolution").Subject).Should().Be("hold-on-expiry");
        reviewed[0].Actor.ActingHumanId.Should().BeNull("a hold-on-cut is silence, not a human decision");
    }

    [Fact]
    public async Task AutoHold_CutCompletesWhileQueueIsRetrieved_ExpiredItemHolds_NotPublished()
    {
        var exerciseId = Guid.NewGuid();
        var item = Countdown(exerciseId, started: 0, minutes: 3);
        using var harness = Build(exerciseId, item);

        var state = harness.Registry.GetOrCreate(exerciseId);
        state.SetStorylineOverride(item.StorylineId, AutonomyLevel.DelayedAuto, "lead-1", 0);
        state.SetSwampedMode(enabled: true, "lead-1", 0);
        harness.Advance(minutes: 4);

        // The tick has already read "not cut"; the cut completes while the queue query is being awaited.
        harness.Store.OnGetQueue = () => harness.ProviderCut.Cut(exerciseId);

        await harness.Service.EvaluateAutoHoldAsync();

        harness.Publisher.Bursts.Should().BeEmpty(
            "a cut that completes before the auto-send publish holds the expiry — the cut is re-checked at the last boundary");
        item.Disposition.Should().Be(DraftDisposition.Held);
        Action((await harness.ReviewedEventsAsync(item.DraftId)).Should().ContainSingle("exactly one engine.reviewed per resolution").Subject)
            .Should().Be("hold-on-expiry");
    }

    [Fact]
    public async Task AutoHold_CutCompletesDuringPersonaLookup_ExpiredItemHolds_NotPublished()
    {
        var exerciseId = Guid.NewGuid();
        var item = Countdown(exerciseId, started: 0, minutes: 3);
        using var harness = Build(exerciseId, item);

        var state = harness.Registry.GetOrCreate(exerciseId);
        state.SetStorylineOverride(item.StorylineId, AutonomyLevel.DelayedAuto, "lead-1", 0);
        state.SetSwampedMode(enabled: true, "lead-1", 0);
        harness.Advance(minutes: 4);

        // The item has been re-read as still expired and undecided; the cut completes while the burst's persona
        // handles are being resolved: after every earlier re-check, before the publisher is invoked (PR #571).
        harness.Db.OnPersonaLookup = () => harness.ProviderCut.Cut(exerciseId);

        await harness.Service.EvaluateAutoHoldAsync();

        harness.Db.PersonaLookups.Should().BePositive("the cut must land during the persona lookup for this to prove anything");
        harness.Publisher.Bursts.Should().BeEmpty(
            "the cut is re-read as the last statement before the publisher call, so a cut completing mid-lookup holds the expiry");
        item.Disposition.Should().Be(DraftDisposition.Held);
        var reviewed = await harness.ReviewedEventsAsync(item.DraftId);
        Action(reviewed.Should().ContainSingle("exactly one engine.reviewed per resolution").Subject).Should().Be("hold-on-expiry");
        reviewed[0].Actor.ActingHumanId.Should().BeNull("a hold-on-cut is silence, not a human decision");
        item.ActionLabel.Should().Be("reply → @mvega_fh", "nothing was attempted, so no 'check the feed' publish reason is recorded");
    }

    // The whole auto-send policy is re-decided at the last boundary (PR #571): a safety change that completes while
    // the burst's persona handles are resolved stops the publish, resolving as the up-front policy would.

    [Fact]
    public async Task AutoHold_KillSwitchDropToSuggestDuringPersonaLookup_Holds_NotPublished()
    {
        var exerciseId = Guid.NewGuid();
        var item = Countdown(exerciseId, started: 0, minutes: 3);
        using var harness = Build(exerciseId, item);
        var state = SwampedDelayedAuto(harness, exerciseId, item);

        harness.Db.OnPersonaLookup = () => state.EngageKillSwitch(KillSwitchMode.DropToSuggest, "lead-1", 4);

        await harness.Service.EvaluateAutoHoldAsync();

        harness.Db.PersonaLookups.Should().BePositive("the kill switch must land during the persona lookup for this to prove anything");
        harness.Publisher.Bursts.Should().BeEmpty("the effective autonomy is re-read immediately before the publisher call");
        item.Disposition.Should().Be(DraftDisposition.Held);
        Action((await harness.ReviewedEventsAsync(item.DraftId)).Should().ContainSingle("exactly one engine.reviewed per resolution").Subject)
            .Should().Be("hold-on-expiry");
    }

    [Fact]
    public async Task AutoHold_KillSwitchFullStopDuringPersonaLookup_Holds_NotPublished()
    {
        var exerciseId = Guid.NewGuid();
        var item = Countdown(exerciseId, started: 0, minutes: 3);
        using var harness = Build(exerciseId, item);
        var state = SwampedDelayedAuto(harness, exerciseId, item);

        harness.Db.OnPersonaLookup = () => state.EngageKillSwitch(KillSwitchMode.FullStop, "lead-1", 4);

        await harness.Service.EvaluateAutoHoldAsync();

        harness.Db.PersonaLookups.Should().BePositive("the full stop must land during the persona lookup for this to prove anything");
        harness.Publisher.Bursts.Should().BeEmpty("a full stop found at the last boundary stops the automatic publish");
        item.Disposition.Should().Be(
            DraftDisposition.Held,
            "an expired countdown under a full stop is an ordinary hold-on-expiry (safety fix D5), never left to auto-send after a restore");
        Action((await harness.ReviewedEventsAsync(item.DraftId)).Should().ContainSingle("exactly one engine.reviewed per resolution").Subject)
            .Should().Be("hold-on-expiry");
    }

    [Fact]
    public async Task AutoHold_FullStopSeenUpFront_HoldsTheExpiredCountdown_NotPublished()
    {
        var exerciseId = Guid.NewGuid();
        var item = Countdown(exerciseId, started: 0, minutes: 3);
        using var harness = Build(exerciseId, item);
        var state = SwampedDelayedAuto(harness, exerciseId, item);
        state.EngageKillSwitch(KillSwitchMode.FullStop, "lead-1", 0);

        await harness.Service.EvaluateAutoHoldAsync();

        harness.Publisher.Bursts.Should().BeEmpty();
        item.Disposition.Should().Be(DraftDisposition.Held, "an expired countdown under a full stop holds (safety fix D5)");
        Action((await harness.ReviewedEventsAsync(item.DraftId)).Should().ContainSingle().Subject).Should().Be("hold-on-expiry");
    }

    [Fact]
    public async Task AutoHold_SwampedModeTurnedOffDuringPersonaLookup_Holds_NotPublished()
    {
        var exerciseId = Guid.NewGuid();
        var item = Countdown(exerciseId, started: 0, minutes: 3);
        using var harness = Build(exerciseId, item);
        var state = SwampedDelayedAuto(harness, exerciseId, item);

        harness.Db.OnPersonaLookup = () => state.SetSwampedMode(enabled: false, "lead-1", 4);

        await harness.Service.EvaluateAutoHoldAsync();

        harness.Db.PersonaLookups.Should().BePositive("swamped-off must land during the persona lookup for this to prove anything");
        harness.Publisher.Bursts.Should().BeEmpty("swamped mode is re-read immediately before the publisher call");
        item.Disposition.Should().Be(DraftDisposition.Held);
        Action((await harness.ReviewedEventsAsync(item.DraftId)).Should().ContainSingle("exactly one engine.reviewed per resolution").Subject)
            .Should().Be("hold-on-expiry");
    }

    [Fact]
    public async Task AutoHold_DegradedClampDuringPersonaLookup_Holds_NotPublished()
    {
        var exerciseId = Guid.NewGuid();
        var item = Countdown(exerciseId, started: 0, minutes: 3);
        using var harness = Build(exerciseId, item);
        var state = SwampedDelayedAuto(harness, exerciseId, item);

        harness.Db.OnPersonaLookup = () => state.DegradeToSuggest("generation provider circuit opened", 4);

        await harness.Service.EvaluateAutoHoldAsync();

        harness.Db.PersonaLookups.Should().BePositive("the degraded clamp must land during the persona lookup for this to prove anything");
        harness.Publisher.Bursts.Should().BeEmpty("the degraded clamp is re-read immediately before the publisher call");
        item.Disposition.Should().Be(DraftDisposition.Held);
        Action((await harness.ReviewedEventsAsync(item.DraftId)).Should().ContainSingle("exactly one engine.reviewed per resolution").Subject)
            .Should().Be("hold-on-expiry");
    }

    [Fact]
    public async Task Approve_WhileCutToFake_StillPublishes()
    {
        var exerciseId = Guid.NewGuid();
        var item = Countdown(exerciseId, started: 0, minutes: 5);
        using var harness = Build(exerciseId, item);
        harness.ProviderCut.Cut(exerciseId);

        var result = await harness.Service.ApproveAsync(item.DraftId, Input("controller-7"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        harness.Publisher.Bursts.Should().ContainSingle(
            "hold-on-cut suspends only the timeout auto-send — an explicit approve still publishes")
            .Which.DraftId.Should().Be(item.DraftId);
        item.Disposition.Should().Be(DraftDisposition.Published);
        Action((await harness.ReviewedEventsAsync(item.DraftId)).Should().ContainSingle().Subject).Should().Be("approve");
    }

    // ==== (c) Kill switch + degraded clamp only LOWER; suspend countdowns; never auto-recover =========

    [Fact]
    public async Task AutoHold_KillSwitchSuspendsCountdown_HoldsEvenUnderSwampedMode()
    {
        var exerciseId = Guid.NewGuid();
        var item = Countdown(exerciseId, started: 0, minutes: 3);
        using var harness = Build(exerciseId, item);

        var state = harness.Registry.GetOrCreate(exerciseId);
        state.SetStorylineOverride(item.StorylineId, AutonomyLevel.DelayedAuto, "lead-1", 0);
        state.SetSwampedMode(enabled: true, "lead-1", 0);
        // The kill switch clamps effective autonomy below Delayed-auto → the in-flight countdown suspends.
        state.EngageKillSwitch(KillSwitchMode.DropToSuggest, "lead-1", 0);
        harness.Advance(minutes: 4);

        await harness.Service.EvaluateAutoHoldAsync();

        harness.Publisher.Bursts.Should().BeEmpty(
            "a kill switch suspends in-flight countdowns — they HOLD, not send, even under swamped mode");
        item.Disposition.Should().Be(DraftDisposition.Held);
        Action((await harness.ReviewedEventsAsync(item.DraftId)).Should().ContainSingle().Subject).Should().Be("hold-on-expiry");
    }

    [Fact]
    public async Task AutoHold_DegradedModeSuspendsCountdown_HoldsEvenUnderSwampedMode()
    {
        var exerciseId = Guid.NewGuid();
        var item = Countdown(exerciseId, started: 0, minutes: 3);
        using var harness = Build(exerciseId, item);

        var state = harness.Registry.GetOrCreate(exerciseId);
        state.SetStorylineOverride(item.StorylineId, AutonomyLevel.DelayedAuto, "lead-1", 0);
        state.SetSwampedMode(enabled: true, "lead-1", 0);
        // The automatic degraded-mode fallback drives the SAME clamp as the kill switch (§3.5).
        state.DegradeToSuggest("generation provider circuit opened", 0);
        harness.Advance(minutes: 4);

        await harness.Service.EvaluateAutoHoldAsync();

        harness.Publisher.Bursts.Should().BeEmpty("degraded mode lowers autonomy and suspends countdowns — HOLD, not send");
        item.Disposition.Should().Be(DraftDisposition.Held);
    }

    [Fact]
    public async Task AutoHold_FullStopBeforeExpiry_KeepsCountingDown_NothingPublishesOrLogs()
    {
        var exerciseId = Guid.NewGuid();
        var item = Countdown(exerciseId, started: 0, minutes: 5);
        using var harness = Build(exerciseId, item);

        var state = harness.Registry.GetOrCreate(exerciseId);
        state.SetStorylineOverride(item.StorylineId, AutonomyLevel.DelayedAuto, "lead-1", 0);
        state.SetSwampedMode(enabled: true, "lead-1", 0);
        state.EngageKillSwitch(KillSwitchMode.FullStop, "lead-1", 0);
        harness.Advance(minutes: 2); // still before the deadline (5)

        await harness.Service.EvaluateAutoHoldAsync();

        harness.Publisher.Bursts.Should().BeEmpty();
        item.Disposition.Should().Be(DraftDisposition.CountingDown, "a full stop does not resolve a countdown still inside its window");
        (await harness.ReviewedEventsAsync(item.DraftId)).Should().BeEmpty("a still-running countdown is not a resolution");
    }

    /// <summary>
    /// Regression (Gate-1 HIGH): a Delayed-auto countdown that expires DURING a kill-switch FullStop used to be left
    /// counting down (no timeout transition), so with swamped mode on it auto-published on the first sweep after a
    /// human restore. Every safety clamp — FullStop included — must HOLD an expiry, never send it later.
    /// </summary>
    [Fact]
    public async Task AutoHold_CountdownExpiresDuringFullStop_Holds_AndStaysHeldAfterRestore_EvenUnderSwampedMode()
    {
        var exerciseId = Guid.NewGuid();
        var item = Countdown(exerciseId, started: 0, minutes: 3);
        using var harness = Build(exerciseId, item);

        var state = harness.Registry.GetOrCreate(exerciseId);
        state.SetStorylineOverride(item.StorylineId, AutonomyLevel.DelayedAuto, "lead-1", 0);
        state.SetSwampedMode(enabled: true, "lead-1", 0);
        state.EngageKillSwitch(KillSwitchMode.FullStop, "lead-1", 1);
        harness.Advance(minutes: 4); // the deadline (3) passes while the engine is fully stopped

        await harness.Service.EvaluateAutoHoldAsync();

        harness.Publisher.Bursts.Should().BeEmpty("a full stop publishes nothing");
        item.Disposition.Should().Be(DraftDisposition.Held, "an expiry during a full stop is held, not left counting down");
        var reviewed = await harness.ReviewedEventsAsync(item.DraftId);
        Action(reviewed.Should().ContainSingle("exactly one engine.reviewed per resolution").Subject).Should().Be("hold-on-expiry");
        reviewed[0].Actor.ActingHumanId.Should().BeNull("a hold-on-expiry is silence, not a human decision");

        var restored = await harness.Service.RestoreFromSafetyAsync(Input("lead-1"), harness.SeedLead());
        restored.Outcome.Should().Be(EngineReviewOutcome.Ok);
        state.IsGenerationStopped.Should().BeFalse("the restore must actually lift the full stop for this to prove anything");
        state.SwampedModeEnabled.Should().BeTrue("swamped mode survives the restore — the auto-send path is live again");
        harness.Advance(minutes: 1);

        await harness.Service.EvaluateAutoHoldAsync();

        harness.Publisher.Bursts.Should().BeEmpty(
            "a draft held during the full stop must never auto-send after the restore, even under swamped mode");
        item.Disposition.Should().Be(DraftDisposition.Held);
        (await harness.ReviewedEventsAsync(item.DraftId)).Should().ContainSingle("the second sweep resolves nothing new");
    }

    [Fact]
    public async Task KillSwitch_OnlyLowersAutonomy_AndDoesNotAutoRecover()
    {
        var exerciseId = Guid.NewGuid();
        var storylineId = Guid.NewGuid();
        using var harness = Build(exerciseId);

        var state = harness.Registry.GetOrCreate(exerciseId);
        state.SetExerciseDefault(AutonomyLevel.DelayedAuto, "lead-1", 0);

        var result = await harness.Service.EngageKillSwitchAsync(KillSwitchMode.DropToSuggest, Input("lead-1"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        state.ResolveEffective(storylineId).Level.Should().Be(AutonomyLevel.Suggest, "the kill switch only ever LOWERS autonomy (§8.2)");
        state.SafetyClampActive.Should().BeTrue("the clamp persists — it never auto-recovers; a human restores explicitly");
    }

    [Fact]
    public void DegradedMode_Clamps_ThenProviderRecovery_DoesNotRaiseAutonomy()
    {
        var state = EngineAutonomyState.Create(Guid.NewGuid());
        state.SetExerciseDefault(AutonomyLevel.DelayedAuto, "lead-1", 0);

        state.DegradeToSuggest("provider circuit opened", 0);
        state.ResolveEffective(Guid.NewGuid()).Level.Should().Be(AutonomyLevel.Suggest, "degraded mode clamps DOWN to the floor");

        state.MarkProviderRecovered(1);

        state.ResolveEffective(Guid.NewGuid()).Level.Should().Be(
            AutonomyLevel.Suggest, "provider recovery clears the alert but NEVER raises autonomy — a human restores (§8.2)");
        state.SafetyClampActive.Should().BeTrue("recovery alone does not lift the clamp");
    }

    // ==== (d) Autonomy never self-escalates — Auto is rejected, no control raises the level ===========

    [Fact]
    public void AutonomyLevel_Auto_IsRejected_Everywhere()
    {
        // The v1 selectability gate — a human cannot set Auto and automation cannot reach it.
        var setDefault = () => EngineAutonomyState.Create(Guid.NewGuid()).SetExerciseDefault(AutonomyLevel.Auto, "lead-1", 0);
        setDefault.Should().Throw<NotSupportedException>("Auto is v1.1 and not selectable in v1");

        var setOverride = () => EngineAutonomyState.Create(Guid.NewGuid())
            .SetStorylineOverride(Guid.NewGuid(), AutonomyLevel.Auto, "lead-1", 0);
        setOverride.Should().Throw<NotSupportedException>();

        var create = () => EngineAutonomyState.Create(Guid.NewGuid(), AutonomyLevel.Auto);
        create.Should().Throw<NotSupportedException>();
    }

    [Fact]
    public async Task SwampedMode_TogglingOn_DoesNotRaiseAutonomyLevel()
    {
        var exerciseId = Guid.NewGuid();
        var storylineId = Guid.NewGuid();
        using var harness = Build(exerciseId);

        var state = harness.Registry.GetOrCreate(exerciseId);
        var before = state.ResolveEffective(storylineId).Level;

        var result = await harness.Service.SetSwampedModeAsync(enabled: true, Input("lead-1"), harness.SeedLead());

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        result.State!.SwampedMode.Should().BeTrue();
        state.ResolveEffective(storylineId).Level.Should().Be(
            before, "swamped mode never raises the autonomy level — automation never self-escalates (§8.2)");
    }

    // ==== (e) Terminal actions drive the right disposition + exactly one engine.reviewed =============

    [Fact]
    public async Task Approve_Publishes_MarksPublished_EmitsExactlyOneReviewed_WithActingHuman()
    {
        var exerciseId = Guid.NewGuid();
        var item = Countdown(exerciseId, started: 0, minutes: 5);
        using var harness = Build(exerciseId, item);

        var result = await harness.Service.ApproveAsync(item.DraftId, Input("controller-7"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        harness.Publisher.Bursts.Should().ContainSingle("approve publishes through story 01's single funnel, one decision per burst");
        item.Disposition.Should().Be(DraftDisposition.Published);
        var reviewed = await harness.ReviewedEventsAsync(item.DraftId);
        reviewed.Should().ContainSingle();
        Action(reviewed[0]).Should().Be("approve");
        reviewed[0].Actor.ActingHumanId.Should().Be("controller-7", "COR-018: the human behind the shared controller account is captured");
        reviewed[0].Origin.Should().Be("engine");
    }

    [Fact]
    public async Task Approve_MultiPostBurst_EmitsExactlyOneReviewed_NotPerPost()
    {
        var exerciseId = Guid.NewGuid();
        var item = Countdown(exerciseId, started: 0, minutes: 5);
        item.Posts = new List<EngineReviewDraftPost> { Post("@a", "first"), Post("@b", "second"), Post("@c", "third") };
        using var harness = Build(exerciseId, item);

        await harness.Service.ApproveAsync(item.DraftId, Input("controller-7"));

        (await harness.ReviewedEventsAsync(item.DraftId)).Should().ContainSingle(
            "one burst = one review decision, never one per post (CTL-034)");
        harness.Publisher.Bursts.Should().ContainSingle().Which.Posts.Should().HaveCount(3, "the burst still carries every post");
    }

    [Fact]
    public async Task Veto_MarksVetoed_NothingPublishes_EmitsOneReviewed()
    {
        var exerciseId = Guid.NewGuid();
        var item = Countdown(exerciseId, started: 0, minutes: 5);
        using var harness = Build(exerciseId, item);

        var result = await harness.Service.VetoAsync(item.DraftId, Input("controller-3"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        harness.Publisher.Bursts.Should().BeEmpty("a veto never publishes");
        item.Disposition.Should().Be(DraftDisposition.Vetoed);
        Action((await harness.ReviewedEventsAsync(item.DraftId)).Should().ContainSingle().Subject).Should().Be("veto");
    }

    [Fact]
    public async Task ReRoll_DelayedAuto_ReturnsToReview_ResetsCountdown_NothingPublishes()
    {
        var exerciseId = Guid.NewGuid();
        var item = Countdown(exerciseId, started: 0, minutes: 3);
        using var harness = Build(exerciseId, item);
        harness.Advance(minutes: 2); // scenario minute is now 2

        var result = await harness.Service.ReRollAsync(item.DraftId, Input("controller-5"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        harness.Publisher.Bursts.Should().BeEmpty("a re-roll never publishes");
        item.Disposition.Should().Be(DraftDisposition.CountingDown, "a re-rolled Delayed-auto burst returns to review");
        item.CountdownStartedScenarioMinute.Should().Be(2, "the fresh countdown restarts from the current scenario minute");
        item.CountdownDecision.Should().Be(ControllerDecision.None);
        Action((await harness.ReviewedEventsAsync(item.DraftId)).Should().ContainSingle().Subject).Should().Be("re-roll");
    }

    [Fact]
    public async Task BatchApprove_PublishesEachUnresolved_SkipsResolved_OneDecisionPerBurst()
    {
        var exerciseId = Guid.NewGuid();
        var open1 = Queued(exerciseId);
        var open2 = Queued(exerciseId);
        var alreadyVetoed = Queued(exerciseId);
        alreadyVetoed.Disposition = DraftDisposition.Vetoed;
        using var harness = Build(exerciseId, open1, open2, alreadyVetoed);

        var result = await harness.Service.BatchApproveAsync(
            new[] { open1.DraftId, open2.DraftId, alreadyVetoed.DraftId }, Input("lead-1"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        result.Outcomes.Single(o => o.DraftId == open1.DraftId.ToString()).Outcome.Should().Be(EngineBatchApproveItem.Published);
        result.Outcomes.Single(o => o.DraftId == open2.DraftId.ToString()).Outcome.Should().Be(EngineBatchApproveItem.Published);
        result.Outcomes.Single(o => o.DraftId == alreadyVetoed.DraftId.ToString()).Outcome.Should().Be(EngineBatchApproveItem.Skipped);

        harness.Publisher.Bursts.Should().HaveCount(2, "a resolved burst is never re-published");
        (await harness.ReviewedEventsAsync(open1.DraftId)).Should().ContainSingle();
        (await harness.ReviewedEventsAsync(open2.DraftId)).Should().ContainSingle();
        (await harness.ReviewedEventsAsync(alreadyVetoed.DraftId)).Should().BeEmpty(
            "no decision is logged for a skipped, already-resolved burst");
    }

    // ==== (f) Edit sanitizes before publishing (NFR-004) =============================================

    [Fact]
    public async Task Edit_SanitizesNewText_BeforePublish_ThroughSameSeam()
    {
        var exerciseId = Guid.NewGuid();
        var item = Countdown(exerciseId, started: 0, minutes: 5);
        using var harness = Build(exerciseId, item);

        const string payload = "<script>alert(1)</script>Boil water in Zone 4 <img src=x onerror=alert(2)> now.";
        var result = await harness.Service.EditAsync(item.DraftId, payload, Input("controller-9"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        var leadText = harness.Publisher.Bursts.Should().ContainSingle().Subject.Posts[0].Text;
        leadText.Should().NotContain("<script").And.NotContain("onerror").And.NotContain("<img")
            .And.NotContain("<").And.NotContain(">", "NFR-004: markup is stripped before the edited draft reaches the publish funnel");
        leadText.Should().Contain("Boil water in Zone 4").And.Contain("now.", "the author's literal text survives; only markup is stripped");
        Action((await harness.ReviewedEventsAsync(item.DraftId)).Should().ContainSingle().Subject).Should().Be(
            "edit", "the approve/edit distinction is telemetry-only (same 'engine' publish origin)");
    }

    // ==== Phase 1 (PROVIDER-GOVERNANCE §8): timeout auto-send NOT authorised =============================

    [Fact]
    public async Task SwampedMode_TurnOn_WhileTimeoutAutoSendNotAuthorized_IsRefused_StateUnchanged()
    {
        var exerciseId = Guid.NewGuid();
        using var harness = new Harness(exerciseId, Array.Empty<EngineReviewItemEntity>(), timeoutAutoSendAuthorized: false);

        var result = await harness.Service.SetSwampedModeAsync(enabled: true, Input("lead-1"));

        result.Outcome.Should().Be(EngineReviewOutcome.Invalid, "raising toward unreviewed timeout publishes is refused in Phase 1");
        result.ValidationError.Should().Be(
            "timeout auto-send (swamped mode) is not authorized on this environment until the lead-controller gate lands "
            + "(PROVIDER-GOVERNANCE §8, Phase 1)");
        harness.Registry.GetOrCreate(exerciseId).SwampedModeEnabled.Should().BeFalse("a refused request changes nothing");
    }

    [Fact]
    public async Task SwampedMode_TurnOff_WhileTimeoutAutoSendNotAuthorized_Succeeds()
    {
        var exerciseId = Guid.NewGuid();
        using var harness = new Harness(exerciseId, Array.Empty<EngineReviewItemEntity>(), timeoutAutoSendAuthorized: false);
        harness.Registry.GetOrCreate(exerciseId).SetSwampedMode(enabled: true, "lead-1", 0); // forced on (test hook)

        var result = await harness.Service.SetSwampedModeAsync(enabled: false, Input("lead-1"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok, "lowering is never refused (§8.2)");
        result.State!.SwampedMode.Should().BeFalse();
    }

    [Fact]
    public async Task AutoHold_SwampedForcedOn_DelayedAuto_Expired_WhileNotAuthorized_Holds_NeverPublishes()
    {
        var exerciseId = Guid.NewGuid();
        var item = Countdown(exerciseId, started: 0, minutes: 3);
        using var harness = new Harness(exerciseId, new[] { item }, timeoutAutoSendAuthorized: false);

        // Swamped mode forced on through the in-memory registry (bypassing the refused POST) — defence in depth.
        SwampedDelayedAuto(harness, exerciseId, item);

        await harness.Service.EvaluateAutoHoldAsync();

        harness.Publisher.Bursts.Should().BeEmpty(
            "with timeout auto-send unauthorised, an expired countdown never auto-sends even if swamped mode is on");
        item.Disposition.Should().Be(DraftDisposition.Held, "the draft holds for a human (NEEDS YOU)");
        Action((await harness.ReviewedEventsAsync(item.DraftId)).Should().ContainSingle().Subject).Should().Be("hold-on-expiry");
    }

    [Fact]
    public async Task AutoHold_SwampedForcedOn_DelayedAuto_Expired_WhileAuthorized_AutoSends()
    {
        var exerciseId = Guid.NewGuid();
        var item = Countdown(exerciseId, started: 0, minutes: 3);
        using var harness = new Harness(exerciseId, new[] { item }, timeoutAutoSendAuthorized: true);
        SwampedDelayedAuto(harness, exerciseId, item);

        await harness.Service.EvaluateAutoHoldAsync();

        harness.Publisher.Bursts.Should().ContainSingle("with the flag true the existing swamped-mode behaviour is unchanged");
        item.Disposition.Should().Be(DraftDisposition.Published);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task GetSettings_ExposesTimeoutAutoSendAuthorized(bool authorized)
    {
        var exerciseId = Guid.NewGuid();
        using var harness = new Harness(exerciseId, Array.Empty<EngineReviewItemEntity>(), timeoutAutoSendAuthorized: authorized);

        var result = await harness.Service.GetSettingsAsync();

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        result.Settings!.TimeoutAutoSendAuthorized.Should().Be(authorized, "the console disables swamped ON from this field");
    }

    [Fact]
    public void TimeoutAutoSendAuthorized_DefaultsFalse_WhenGovernanceAbsent()
    {
        new EngineAmbientGovernanceOptions().TimeoutAutoSendAuthorized.Should().BeFalse("fail closed (PROVIDER-GOVERNANCE §8, Phase 1)");
    }

    // ==== helpers ====================================================================================

    private static EngineReviewActionInput Input(string actingHumanId) => new(actingHumanId, "America/Chicago");

    private static string? Action(TelemetryEvent telemetryEvent)
    {
        using var doc = JsonDocument.Parse(telemetryEvent.Payload!);
        return doc.RootElement.GetProperty("action").GetString();
    }

    private static Harness Build(Guid exerciseId, params EngineReviewItemEntity[] items) => new(exerciseId, items);

    /// <summary>Puts the item on the sole auto-send path (Delayed-auto + swamped mode) and advances past its expiry.</summary>
    private static EngineAutonomyState SwampedDelayedAuto(Harness harness, Guid exerciseId, EngineReviewItemEntity item)
    {
        var state = harness.Registry.GetOrCreate(exerciseId);
        state.SetStorylineOverride(item.StorylineId, AutonomyLevel.DelayedAuto, "lead-1", 0);
        state.SetSwampedMode(enabled: true, "lead-1", 0);
        harness.Advance(minutes: 4);
        return state;
    }

    private static EngineReviewItemEntity Queued(Guid exerciseId) => new()
    {
        DraftId = Guid.NewGuid(),
        ExerciseId = exerciseId,
        StorylineId = Guid.NewGuid(),
        RoutedAtLevel = AutonomyLevel.Suggest,
        Disposition = DraftDisposition.Queued,
        StorylineTag = "#WaterIssues",
        StorylineBrief = "Rising frustration about the water outage.",
        ActionLabel = "reply → @mvega_fh",
        Posts = new List<EngineReviewDraftPost> { Post("@mvega_fh", "Water pressure is dropping.") },
    };

    private static EngineReviewItemEntity Countdown(Guid exerciseId, int started, int minutes)
    {
        var item = Queued(exerciseId);
        item.RoutedAtLevel = AutonomyLevel.DelayedAuto;
        item.Disposition = DraftDisposition.CountingDown;
        item.CountdownStartedScenarioMinute = started;
        item.CountdownMinutes = minutes;
        item.CountdownDecision = ControllerDecision.None;
        return item;
    }

    private static EngineReviewDraftPost Post(string handle, string text) => new()
    {
        PersonaHandle = handle,
        Text = text,
        Sentiment = -0.3,
        Hashtags = new List<string> { "#WaterIssues" },
    };

    /// <summary>
    /// A Docker-free harness: the real <see cref="EngineReviewService"/> over a fake store + fake publish +
    /// fake broadcaster, an in-memory <see cref="PulseDbContext"/> as the telemetry sink, and a hand-advanced
    /// scenario clock. The store returns the SAME entity instances the tests hold, so a disposition mutation is
    /// observed directly (no relational round-trip needed for these safety assertions).
    /// </summary>
    private sealed class Harness : IDisposable
    {
        private readonly ManualTimeProvider _time;
        private readonly Guid _exerciseId;

        /// <param name="exerciseId">The resolved exercise scope.</param>
        /// <param name="items">The seeded review items.</param>
        /// <param name="providerCut">An optional shared cut registry.</param>
        /// <param name="timeoutAutoSendAuthorized">
        /// The governed <c>Generation:Governance:TimeoutAutoSendAuthorized</c> flag. This suite's swamped/auto-send
        /// invariants are proven under the AUTHORISED posture, so the default here is an explicit <c>true</c>; the
        /// Phase-1 refusal tests pass <c>false</c> (production's committed default, PROVIDER-GOVERNANCE §8).
        /// </param>
        public Harness(
            Guid exerciseId,
            EngineReviewItemEntity[] items,
            GenerationProviderCutRegistry? providerCut = null,
            bool timeoutAutoSendAuthorized = true)
        {
            _exerciseId = exerciseId;
            var context = new ExerciseContext { CurrentExerciseId = exerciseId };

            var options = new DbContextOptionsBuilder<PulseDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options;
            Db = new HookedPulseDbContext(options, context);

            _time = new ManualTimeProvider(ScenarioStart);
            var clock = new ExerciseClockService(_time);
            clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);

            Publisher = new RecordingPublishService();
            Registry = new EngineAutonomyRegistry();
            TierPolicy = new EngineTierPolicyRegistry();
            ProviderCut = providerCut ?? new GenerationProviderCutRegistry();

            Store = new FakeReviewStore(items);
            Service = new EngineReviewService(
                Store,
                Db,
                context,
                clock,
                new EngineTelemetryEmitter(),
                Publisher,
                new RecordingBroadcaster(),
                Registry,
                TierPolicy,
                new FakeGenerationProvider(),
                Options.Create(new GenerationOptions()),
                ProviderCut,
                NullLogger<EngineReviewService>.Instance,
                ambientPolicy: null,
                governance: Options.Create(new EngineAmbientGovernanceOptions { TimeoutAutoSendAuthorized = timeoutAutoSendAuthorized }));
        }

        public EngineReviewService Service { get; }

        /// <summary>The in-memory context the service writes through (telemetry sink + persona lookup seam).</summary>
        public HookedPulseDbContext Db { get; }

        public RecordingPublishService Publisher { get; }

        public FakeReviewStore Store { get; }

        public EngineAutonomyRegistry Registry { get; }

        public EngineTierPolicyRegistry TierPolicy { get; }

        public GenerationProviderCutRegistry ProviderCut { get; }

        /// <summary>Seeds the exercise's lead controller — the session person a raise's post-write re-check reads (Tier-2 M-1).</summary>
        public Guid SeedLead() => LeadControllerSeed.Seed(_db, _exerciseId);

        public void Advance(int minutes) => _time.Advance(TimeSpan.FromMinutes(minutes));

        public async Task<List<TelemetryEvent>> ReviewedEventsAsync(Guid draftId) =>
            await Db.TelemetryEvents
                .IgnoreQueryFilters()
                .Where(e => e.EventType == "engine.reviewed"
                    && e.Target != null && e.Target.EntityId == draftId.ToString())
                .ToListAsync();

        public void Dispose() => Db.Dispose();
    }

    /// <summary>
    /// The real <see cref="PulseDbContext"/> with one test seam: <see cref="OnPersonaLookup"/> runs when the
    /// <see cref="PulseDbContext.Personas"/> set is taken for a query (the review service's persona-handle
    /// resolution), so a test can complete a provider cut in the middle of that lookup.
    /// </summary>
    private sealed class HookedPulseDbContext : PulseDbContext
    {
        public HookedPulseDbContext(DbContextOptions<PulseDbContext> options, IExerciseContext exerciseContext)
            : base(options, exerciseContext)
        {
        }

        /// <summary>An optional side effect run each time the persona set is taken (e.g. a cut completing mid-lookup).</summary>
        public Action? OnPersonaLookup { get; set; }

        /// <summary>How many times the persona set was taken.</summary>
        public int PersonaLookups { get; private set; }

        public override DbSet<TEntity> Set<TEntity>()
        {
            if (typeof(TEntity) == typeof(Persona))
            {
                PersonaLookups++;
                OnPersonaLookup?.Invoke();
            }

            return base.Set<TEntity>();
        }
    }

    /// <summary>An in-memory <see cref="IEngineReviewStore"/> keyed by draft id — returns the same entity instances the tests hold.</summary>
    private sealed class FakeReviewStore : IEngineReviewStore
    {
        private readonly Dictionary<Guid, EngineReviewItemEntity> _items;

        public FakeReviewStore(IEnumerable<EngineReviewItemEntity> items) =>
            _items = items.ToDictionary(i => i.DraftId);

        public Task EnqueueAsync(EngineReviewItemEntity item, CancellationToken cancellationToken = default)
        {
            _items[item.DraftId] = item;
            return Task.CompletedTask;
        }

        /// <summary>An optional side effect run while the queue is being retrieved (e.g. a cut completing during the await).</summary>
        public Action? OnGetQueue { get; set; }

        public Task<IReadOnlyList<EngineReviewItemEntity>> GetQueueAsync(CancellationToken cancellationToken = default)
        {
            OnGetQueue?.Invoke();
            return Task.FromResult<IReadOnlyList<EngineReviewItemEntity>>(_items.Values.ToList());
        }

        public Task<EngineReviewItemEntity?> FindAsync(Guid draftId, CancellationToken cancellationToken = default) =>
            Task.FromResult(_items.GetValueOrDefault(draftId));

        public Task<bool> UpdateDispositionAsync(
            Guid draftId,
            DraftDisposition disposition,
            ControllerDecision? decision = null,
            CancellationToken cancellationToken = default)
        {
            if (!_items.TryGetValue(draftId, out var item))
            {
                return Task.FromResult(false);
            }

            item.Disposition = disposition;
            if (decision is not null)
            {
                item.CountdownDecision = decision;
            }

            return Task.FromResult(true);
        }
    }

    /// <summary>Records the bursts sent to story 01's publish seam — the safety negatives assert this was (not) called.</summary>
    private sealed class RecordingPublishService : IEnginePublishService
    {
        public List<EngineBurst> Bursts { get; } = new();

        /// <summary>An optional side effect run on each publish (e.g. a cut to Fake landing mid-tick).</summary>
        public Action<EngineBurst>? OnPublish { get; set; }

        public Task<EngineBurstPublishResult> PublishBurstAsync(EngineBurst burst, CancellationToken cancellationToken = default)
        {
            Bursts.Add(burst);
            OnPublish?.Invoke(burst);
            return Task.FromResult(new EngineBurstPublishResult
            {
                Posts = burst.Posts
                    .Select(p => new EnginePublishedPost
                    {
                        PersonaHandle = p.PersonaHandle,
                        PostId = Guid.NewGuid(),
                        Outcome = EnginePublishOutcome.Published,
                    })
                    .ToList(),
            });
        }
    }

    /// <summary>A no-op broadcaster — the exercise-grouped push is proven separately in <see cref="EngineReviewBroadcasterTests"/>.</summary>
    private sealed class RecordingBroadcaster : IEngineReviewBroadcaster
    {
        public Task BroadcastReviewItemChangedAsync(
            Guid exerciseId,
            EngineReviewItemDto item,
            CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
