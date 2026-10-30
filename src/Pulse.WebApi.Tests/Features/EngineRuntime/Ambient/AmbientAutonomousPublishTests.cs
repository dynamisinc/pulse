namespace Pulse.WebApi.Tests.Features.EngineRuntime.Ambient;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.Core.Features.Ambient.Models;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;
using Pulse.Core.Features.Storylines.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Review;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Xunit;

/// <summary>
/// ambient-chatter story 01, AC4-AC9 through the REAL reaction-loop driver (Docker-free): what publishes autonomously,
/// and everything that stops it — lifecycle, Freeze, Pause engine, both kill-switch modes, degraded mode, the cut to
/// Fake, a policy change mid-flight, the content guard — plus review mode never auto-sending.
/// </summary>
public sealed class AmbientAutonomousPublishTests
{
    // ---- AC1: off means nothing -----------------------------------------------------------------

    [Fact]
    public async Task ModeOff_TheDefault_GeneratesAndPublishesNothing()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();

        await harness.TickAsync();

        harness.Ambient.Get(harness.ExerciseId).Mode.Should().Be(AmbientPolicyMode.Off, "no controller set it");
        harness.Provider.Calls.Should().Be(0, "no ambient content is even generated while off (AC1)");
        harness.Publisher.Published.Should().BeEmpty();
        (await harness.EventsAsync()).Should().BeEmpty();
    }

    // ---- AC4 + AC9: the autonomous happy path ------------------------------------------------

    [Fact]
    public async Task Autonomous_BelowTheFloor_PublishesThroughTheOneFunnel_WithEngineProvenance()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Autonomous);

        var result = await harness.TickAsync();

        result.AmbientPostsPublished.Should().Be(2);
        harness.Publisher.Published.Should().HaveCount(2, "each ambient post is published on its own, re-checked first");
        var castIds = harness.Registration.PersonasByHandle.Values.Select(p => p.InstanceId).ToList();
        var expectedScenarioTime = harness.Clock.CurrentScenarioTime(harness.ExerciseId)!.Value.ToString("O");
        foreach (var burst in harness.Publisher.Published)
        {
            burst.ExerciseId.Should().Be(harness.ExerciseId, "the publish scope is the tick's server-derived exercise (COR-001)");
            burst.StorylineId.Should().Be(Guid.Empty, "ambient belongs to no storyline");
            burst.Trigger.Should().Be("ambient-floor");
            burst.PublishPath.Should().Be("ambient-autonomous");
            burst.AuthorizedBy.Should().Be("controller-7", "the controller who set the policy is on the record (AC9)");
            burst.Posts.Should().ContainSingle();
            castIds.Should().Contain(burst.Posts[0].PersonaId, "ambient posts are attributed only to allow-listed cast personas");
            burst.Posts[0].ScenarioTime.Should().Be(expectedScenarioTime, "posts carry scenario time, never wall clock (COR-053)");
        }

        (await harness.ReviewItemsAsync()).Should().BeEmpty("an autonomous ambient post never becomes a review item");

        var decided = (await harness.PayloadsAsync(EngineEventTypes.Decided)).Should().ContainSingle().Subject;
        decided.GetProperty("trigger").GetString().Should().Be("ambient-floor");
        decided.GetProperty("publishPath").GetString().Should().Be("ambient-autonomous");
        var generated = (await harness.PayloadsAsync(EngineEventTypes.Generated)).Should().ContainSingle().Subject;
        generated.GetProperty("trigger").GetString().Should().Be("ambient-floor");
        generated.GetProperty("publishPath").GetString().Should().Be("ambient-autonomous");
        generated.TryGetProperty("heldReason", out _).Should().BeFalse("nothing was held");

        var actor = (await harness.EventsAsync()).First(e => e.EventType == EngineEventTypes.Decided).Actor;
        actor.Kind.Should().Be("engine");
        actor.ActingHumanId.Should().Be("controller-7");
    }

    [Fact]
    public async Task Autonomous_TheAmbientPrompt_IsSeededOnlyFromTheAllowListedTopic()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Autonomous);

        await harness.TickAsync();

        var prompt = harness.Provider.LastRequest!.SystemPrompt;
        prompt.Should().Contain("## Background chatter — topic: ");
        prompt.Should().NotContain("Officials have", "an ambient prompt carries no official-response escalation text (H-1)");
        prompt.Should().NotContain("Storyline you are advancing");
        (prompt.Contains(AmbientTopics.SeedPhrase(AmbientTopics.Food), StringComparison.Ordinal)
            || prompt.Contains(AmbientTopics.SeedPhrase(AmbientTopics.Sports), StringComparison.Ordinal))
            .Should().BeTrue("the topic seed is one of the allow-listed topics' server-authored phrases");
        harness.Provider.LastRequest.Tier.Should().Be(GenerationTier.Ambient);
    }

    [Fact]
    public async Task Autonomous_ThePerMinuteCap_Holds_AcrossTicks()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Autonomous, perMinute: 1);

        await harness.TickAsync();
        await harness.TickAsync();

        harness.Publisher.Published.Should().HaveCount(1, "maxPerMinute = 1 lets one ambient post through per rolling minute");

        harness.Time.Advance(TimeSpan.FromSeconds(61));
        await harness.TickAsync();
        harness.Publisher.Published.Should().HaveCount(2, "the window rolls");
    }

    [Fact]
    public async Task Autonomous_WhenAStorylineIntentFiresThisTick_AmbientYields()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Autonomous);
        var storyline = Storyline.Create(
            harness.ExerciseId, "Water main fears", "a county statement", responseWindowMin: 20,
            participatingPersonas: AmbientLoopHarness.Handles, hashtags: ["#WaterIssues"]);
        storyline.Seed(0);
        harness.Time.Advance(TimeSpan.FromMinutes(25));
        var withStoryline = new ReactionLoopRegistration
        {
            ExerciseId = harness.ExerciseId,
            ExerciseBrief = harness.Registration.ExerciseBrief,
            TimeZone = "UTC",
            ScenarioStart = AmbientLoopHarness.ScenarioStart,
            TimeZoneInfo = TimeZoneInfo.Utc,
            Storylines = [storyline],
            PersonasByHandle = harness.Registration.PersonasByHandle,
            Autonomy = harness.Registration.Autonomy,
            ControllerDeskId = Guid.NewGuid(),
        };

        var result = await harness.TickAsync(withStoryline);

        result.ReviewItemsEnqueued.Should().Be(1, "the storyline burst takes the review queue as before (AC8)");
        harness.Publisher.Published.Should().BeEmpty("ambient is lowest priority and yields to the storyline intent (AC4)");
        (await harness.PayloadsAsync(EngineEventTypes.Decided))
            .Select(p => p.TryGetProperty("trigger", out var _trigger)).Should().OnlyContain(hasTrigger => !hasTrigger, "no ambient decision was made this tick");
    }

    // ---- AC8: review mode queues, never auto-sends -------------------------------------------

    [Fact]
    public async Task Review_QueuesASuggestDraft_AndPublishesNothing()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Review);

        await harness.TickAsync();

        harness.Publisher.Published.Should().BeEmpty("review mode never publishes without a controller (AC8)");
        var item = (await harness.ReviewItemsAsync()).Should().ContainSingle().Subject;
        item.Disposition.Should().Be(DraftDisposition.Queued);
        item.RoutedAtLevel.Should().Be(AutonomyLevel.Suggest, "never Delayed-auto, so no countdown can expire into a send");
        item.CountdownMinutes.Should().BeNull();
        item.StorylineId.Should().Be(Guid.Empty);
        (await harness.PayloadsAsync(EngineEventTypes.Decided)).Single()
            .TryGetProperty("publishPath", out _).Should().BeFalse("only the autonomous path carries publishPath");
    }

    [Fact]
    public async Task Review_EvenWithDelayedAutoDefaultAndSwampedMode_TheAmbientDraftIsNeverSentBySilence()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Review);
        var state = harness.Autonomy.GetOrCreate(harness.ExerciseId);
        state.SetExerciseDefault(AutonomyLevel.DelayedAuto, "lead-1", 0);
        state.SetSwampedMode(true, "lead-1", 0);

        await harness.TickAsync();
        harness.Time.Advance(TimeSpan.FromMinutes(30));

        await using (var scope = harness.Services.CreateAsyncScope())
        {
            var context = (ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>();
            context.CurrentExerciseId = harness.ExerciseId;
            var db = scope.ServiceProvider.GetRequiredService<PulseDbContext>();
            var service = new EngineReviewService(
                new EngineReviewStore(db, new EngineReviewTickSignal()),
                db,
                context,
                harness.Clock,
                new EngineTelemetryEmitter(),
                harness.Publisher,
                new RecordingReviewBroadcaster(),
                harness.Autonomy,
                new EngineTierPolicyRegistry(),
                new FakeGenerationProvider(),
                Options.Create(new GenerationOptions()),
                harness.Cut,
                NullLogger<EngineReviewService>.Instance,
                harness.Ambient,
                // Timeout auto-send AUTHORISED, so the negative below is about ambient review mode, not the Phase-1 flag.
                Options.Create(new EngineAmbientGovernanceOptions { TimeoutAutoSendAuthorized = true }));

            await service.EvaluateAutoHoldAsync();
        }

        harness.Publisher.Published.Should().BeEmpty("silence is never approval: no expiry path publishes ambient content (AC8)");
        (await harness.ReviewItemsAsync()).Single().Disposition.Should().Be(DraftDisposition.Queued);
    }

    // ---- AC5: lifecycle, Freeze, Pause engine ------------------------------------------------

    [Theory]
    [InlineData("build")]
    [InlineData("staged")]
    [InlineData("paused")]
    [InlineData("completed")]
    [InlineData("archived")]
    public async Task NotLive_NothingIsGeneratedOrPublished_AndHeldLifecycleIsRecordedOnce(string status)
    {
        await using var harness = await AmbientLoopHarness.CreateAsync(status: status);
        harness.SetPolicy(AmbientPolicyMode.Autonomous);

        await harness.TickAsync();
        await harness.TickAsync();

        harness.Provider.Calls.Should().Be(0, "a non-live world generates no ambient content");
        harness.Publisher.Published.Should().BeEmpty();
        var decided = await harness.PayloadsAsync(EngineEventTypes.Decided);
        decided.Should().ContainSingle("the hold is recorded once per episode, not every 5 s tick")
            .Which.GetProperty("heldReason").GetString().Should().Be("held:lifecycle");
    }

    [Fact]
    public async Task LegacyActiveStatus_ReadsAsLive_ThroughTheSharedVocabulary()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync(status: "active");
        harness.SetPolicy(AmbientPolicyMode.Autonomous);

        await harness.TickAsync();

        harness.Publisher.Published.Should().NotBeEmpty("ExerciseLifecycleStates folds legacy 'active' to 'live'");
    }

    [Fact]
    public async Task ADraftThatFinishesAfterEndEx_IsDiscarded_NeverPublished_NeverQueued()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Autonomous);
        harness.Provider.DuringGenerate = () => harness.SetStatusAsync("completed").GetAwaiter().GetResult();

        await harness.TickAsync();

        harness.Publisher.Published.Should().BeEmpty("EndEx landed while the burst was in flight (AC5)");
        (await harness.ReviewItemsAsync()).Should().BeEmpty("a discarded draft is never queued late");
        (await harness.PayloadsAsync(EngineEventTypes.Generated)).Single()
            .GetProperty("heldReason").GetString().Should().Be("held:lifecycle");
    }

    [Fact]
    public async Task Freeze_ClockFrozen_PublishesNothing()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Autonomous);
        harness.Provider.DuringGenerate = () => harness.Clock.Freeze(harness.ExerciseId);

        await harness.TickAsync();

        harness.Publisher.Published.Should().BeEmpty("a Freeze mid-flight discards the draft");
        (await harness.PayloadsAsync(EngineEventTypes.Generated)).Single()
            .GetProperty("heldReason").GetString().Should().Be("held:lifecycle");
    }

    [Theory]
    [InlineData(PauseTier.Engine)]
    [InlineData(PauseTier.Freeze)]
    public async Task PauseEngineOrFreezeTier_PublishesNothing(PauseTier tier)
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Autonomous);
        harness.PauseTiers.Restore(harness.ExerciseId, tier);

        await harness.TickAsync();

        harness.Publisher.Published.Should().BeEmpty();
        harness.Provider.Calls.Should().Be(0);
    }

    [Fact]
    public async Task PauseInjects_DoesNotStopAmbient()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Autonomous);
        harness.PauseTiers.Restore(harness.ExerciseId, PauseTier.Injects);

        await harness.TickAsync();

        harness.Publisher.Published.Should().NotBeEmpty("Pause injects halts injects only");
    }

    // ---- AC6: the kill switch (both modes), degraded mode, cut to Fake ----------------------

    [Theory]
    [InlineData(KillSwitchMode.FullStop)]
    [InlineData(KillSwitchMode.DropToSuggest)]
    public async Task KillSwitchWhileABurstIsInFlight_DiscardsIt_AndLowersTheModeToOff(KillSwitchMode mode)
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Autonomous);
        harness.Provider.DuringGenerate = () =>
            harness.Autonomy.GetOrCreate(harness.ExerciseId).EngageKillSwitch(mode, "lead-1", 0);

        await harness.TickAsync();

        harness.Publisher.Published.Should().BeEmpty("the stop is re-checked immediately before publish (AC6)");
        (await harness.PayloadsAsync(EngineEventTypes.Generated)).Single()
            .GetProperty("heldReason").GetString().Should().Be("held:safety");
        harness.Ambient.Get(harness.ExerciseId).Mode.Should().Be(AmbientPolicyMode.Off, "a safety clamp lowers ambient, never queues it");
        var change = (await harness.PayloadsAsync(EngineEventTypes.TierPolicyChanged)).Single();
        change.GetProperty("policy").GetString().Should().Be("ambient");
        change.GetProperty("fromMode").GetString().Should().Be("autonomous");
        change.GetProperty("toMode").GetString().Should().Be("off");
        change.GetProperty("reason").GetString().Should().Be("safety-clamp");
    }

    [Fact]
    public async Task KillSwitchAfterTheFirstPost_DiscardsTheRestOfTheBurst()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Autonomous);
        harness.Publisher.AfterPublish = _ =>
            harness.Autonomy.GetOrCreate(harness.ExerciseId).EngageKillSwitch(KillSwitchMode.DropToSuggest, "lead-1", 0);

        await harness.TickAsync();

        harness.Publisher.Published.Should().HaveCount(1, "the post already handed to the funnel completes; the rest is discarded");
        (await harness.PayloadsAsync(EngineEventTypes.Generated)).Single()
            .GetProperty("heldReason").GetString().Should().Be("held:safety");
    }

    [Fact]
    public async Task RestoringTheEngine_NeverReRaisesAmbientAutonomy()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Autonomous);
        var state = harness.Autonomy.GetOrCreate(harness.ExerciseId);
        state.EngageKillSwitch(KillSwitchMode.FullStop, "lead-1", 0);
        await harness.TickAsync();

        state.RestoreFromSafety("lead-1", 0);
        await harness.TickAsync();

        harness.Ambient.Get(harness.ExerciseId).Mode.Should().Be(AmbientPolicyMode.Off, "only a human re-selecting the mode raises it (AC6)");
        harness.Publisher.Published.Should().BeEmpty();
    }

    [Fact]
    public async Task ADegradedClamp_PausesAmbient_ItNeverDropsIntoTheReviewQueue()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Autonomous);
        harness.Autonomy.GetOrCreate(harness.ExerciseId).DegradeToSuggest("circuit open", 0);

        await harness.TickAsync();

        harness.Provider.Calls.Should().Be(0);
        harness.Publisher.Published.Should().BeEmpty();
        (await harness.ReviewItemsAsync()).Should().BeEmpty("a degraded clamp lowers ambient; it does not reroute it to the queue");
        harness.Ambient.Get(harness.ExerciseId).Mode.Should().Be(AmbientPolicyMode.Off);
    }

    [Fact]
    public async Task CutToFakeWhileABurstIsInFlight_DiscardsIt()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Autonomous);
        harness.Provider.DuringGenerate = () => harness.Cut.Cut(harness.ExerciseId);

        await harness.TickAsync();

        harness.Publisher.Published.Should().BeEmpty("the egress brake stops ambient publishing too (AC6)");
        (await harness.PayloadsAsync(EngineEventTypes.Generated)).Single()
            .GetProperty("heldReason").GetString().Should().Be("held:safety");
        harness.Ambient.Get(harness.ExerciseId).Mode.Should().Be(AmbientPolicyMode.Off);
    }

    [Fact]
    public async Task APolicyChangedToReviewWhileInFlight_DiscardsTheDraft_InsteadOfPublishingOrQueueingIt()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Autonomous);
        harness.Provider.DuringGenerate = () => harness.SetPolicy(AmbientPolicyMode.Review);

        await harness.TickAsync();

        harness.Publisher.Published.Should().BeEmpty();
        (await harness.ReviewItemsAsync()).Should().BeEmpty();
        (await harness.PayloadsAsync(EngineEventTypes.Generated)).Single()
            .GetProperty("heldReason").GetString().Should().Be("held:policy");
    }

    [Fact]
    public async Task AutonomousSetWhileTheGovernanceFlagIsOff_IsLowered_AndPublishesNothing()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync(autonomyAuthorized: false);
        harness.SetPolicy(AmbientPolicyMode.Autonomous); // bypassing the API's 400 on purpose

        await harness.TickAsync();

        harness.Publisher.Published.Should().BeEmpty("the loop re-checks the §8 flag itself, defence in depth (AC0)");
        harness.Ambient.Get(harness.ExerciseId).Mode.Should().Be(AmbientPolicyMode.Off);
    }

    // ---- AC7: the content guard ------------------------------------------------------------

    [Fact]
    public async Task AGuardFailure_PublishesNothing_AndIsCounted()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Autonomous);
        harness.Provider.Posts =
        [
            new GeneratedPost("@gen0", "lovely morning at the farmers market, the exercise is over so relax everyone", 0.5, []),
            new GeneratedPost("@gen1", "school bake sale raised a ton for the library this weekend, thanks neighbours", 0.6, []),
        ];

        await harness.TickAsync();

        harness.Publisher.Published.Should().BeEmpty("a guard failure publishes nothing (AC7)");
        harness.Provider.Calls.Should().Be(GenerateStage.DefaultMaxAttempts, "each re-roll is a real (paid) call");
        (await harness.PayloadsAsync(EngineEventTypes.Generated)).Single()
            .GetProperty("guardResult").GetString().Should().Be("drop", "the drop is recorded: that event is the count");
    }
}
