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

        var result = await harness.Service.SetSwampedModeAsync(enabled: true, Input("lead-1"));

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

    // ==== helpers ====================================================================================

    private static EngineReviewActionInput Input(string actingHumanId) => new(actingHumanId, "America/Chicago");

    private static string? Action(TelemetryEvent telemetryEvent)
    {
        using var doc = JsonDocument.Parse(telemetryEvent.Payload!);
        return doc.RootElement.GetProperty("action").GetString();
    }

    private static Harness Build(Guid exerciseId, params EngineReviewItemEntity[] items) => new(exerciseId, items);

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
        private readonly PulseDbContext _db;
        private readonly ManualTimeProvider _time;

        public Harness(Guid exerciseId, EngineReviewItemEntity[] items)
        {
            var context = new ExerciseContext { CurrentExerciseId = exerciseId };

            var options = new DbContextOptionsBuilder<PulseDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options;
            _db = new PulseDbContext(options, context);

            _time = new ManualTimeProvider(ScenarioStart);
            var clock = new ExerciseClockService(_time);
            clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);

            Publisher = new RecordingPublishService();
            Registry = new EngineAutonomyRegistry();
            TierPolicy = new EngineTierPolicyRegistry();

            Service = new EngineReviewService(
                new FakeReviewStore(items),
                _db,
                context,
                clock,
                new EngineTelemetryEmitter(),
                Publisher,
                new RecordingBroadcaster(),
                Registry,
                TierPolicy,
                new FakeGenerationProvider(),
                Options.Create(new GenerationOptions()),
                new GenerationProviderCutRegistry(),
                NullLogger<EngineReviewService>.Instance);
        }

        public EngineReviewService Service { get; }

        public RecordingPublishService Publisher { get; }

        public EngineAutonomyRegistry Registry { get; }

        public EngineTierPolicyRegistry TierPolicy { get; }

        public void Advance(int minutes) => _time.Advance(TimeSpan.FromMinutes(minutes));

        public async Task<List<TelemetryEvent>> ReviewedEventsAsync(Guid draftId) =>
            await _db.TelemetryEvents
                .IgnoreQueryFilters()
                .Where(e => e.EventType == "engine.reviewed"
                    && e.Target != null && e.Target.EntityId == draftId.ToString())
                .ToListAsync();

        public void Dispose() => _db.Dispose();
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

        public Task<IReadOnlyList<EngineReviewItemEntity>> GetQueueAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<EngineReviewItemEntity>>(_items.Values.ToList());

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

        public Task<EngineBurstPublishResult> PublishBurstAsync(EngineBurst burst, CancellationToken cancellationToken = default)
        {
            Bursts.Add(burst);
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
