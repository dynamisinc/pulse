namespace Pulse.WebApi.Tests.Features.EngineRuntime.Ambient;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.Core.Features.Ambient.Models;
using Pulse.Core.Features.Ambient.Services;
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
/// ambient-chatter story 01 — the orchestrator-review hardening on PR #603, through the REAL reaction-loop driver
/// (Docker-free): W-3 (setting-only prompt + output filter), S-2 (sentiment), W-4 (eligible types in the loop), W-6
/// (policy narrowed mid-flight holds the publish), W-7 (a review draft finishing into a closed world is discarded),
/// and S-1 (an approved ambient draft publishes tagged ambient-floor / ambient-reviewed).
/// </summary>
public sealed class AmbientHardeningTests
{
    private const string IncidentNarrative = "INCIDENT_NARRATIVE: a suspected water-main contamination event at the plant";

    // ---- W-3: the prompt carries the setting only ---------------------------------------------------

    [Fact]
    public async Task TheAmbientPrompt_CarriesThePlaceName_NeverTheIncidentBrief()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Autonomous);
        var registration = Copy(harness.Registration, brief: IncidentNarrative, placeName: "Cedar Falls");

        await harness.TickAsync(registration);

        var prompt = harness.Provider.LastRequest!.SystemPrompt;
        prompt.Should().Contain(AmbientSettingBrief.Build("Cedar Falls"));
        prompt.Should().NotContain("INCIDENT_NARRATIVE").And.NotContain("contamination", "the incident never enters an ambient prompt");
        harness.Provider.LastRequest.IsAmbient.Should().BeTrue();
        harness.Publisher.Published.Should().NotBeEmpty("the clean scripted burst still publishes");
    }

    [Fact]
    public async Task WithNoPlaceName_TheAmbientPrompt_UsesTheGenericSetting()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Review);

        await harness.TickAsync(Copy(harness.Registration, brief: IncidentNarrative, placeName: null));

        harness.Provider.LastRequest!.SystemPrompt.Should().Contain(AmbientSettingBrief.Generic).And.NotContain("INCIDENT_NARRATIVE");
    }

    // ---- W-3 / S-2: the output filter is a guard failure --------------------------------------------

    public static IEnumerable<object[]> FilteredBursts =>
    [
        ["fixed incident term", new GeneratedPost("@gen0", "officials said the park playground reopened", 0.4, [])],
        ["negative sentiment", new GeneratedPost("@gen0", "the new bakery line was so long this morning", -0.5, [])],
        ["active storyline hashtag", new GeneratedPost("@gen0", "lovely sunset over the lake #WaterIssues", 0.5, [])],
        ["storyline title keyword", new GeneratedPost("@gen0", "the fountain in the square is lovely, cold clean water", 0.5, [])],
    ];

    [Theory]
    [MemberData(nameof(FilteredBursts))]
    public async Task AnAmbientPostThatDriftsTowardTheIncident_IsDroppedLikeAGuardFailure(string why, GeneratedPost offending)
    {
        foreach (var mode in new[] { AmbientPolicyMode.Autonomous, AmbientPolicyMode.Review })
        {
            await using var harness = await AmbientLoopHarness.CreateAsync();
            harness.SetPolicy(mode);
            harness.Provider.Posts = [offending, ScriptedGenerationProvider.CleanBurst[1]];

            await harness.TickAsync(WithDormantStoryline(harness.Registration));

            harness.Publisher.Published.Should().BeEmpty($"{why}: nothing publishes ({mode})");
            (await harness.ReviewItemsAsync()).Should().BeEmpty($"{why}: nothing is queued either ({mode})");
            harness.Provider.Calls.Should().Be(GenerateStage.DefaultMaxAttempts, "it re-rolls within the budget, then drops");
            (await harness.PayloadsAsync(EngineEventTypes.Generated)).Single()
                .GetProperty("guardResult").GetString().Should().Be("drop", "counted exactly like a guard failure");
        }
    }

    // ---- Gate-1 W-B: filter / guard re-rolls are counted against the ambient caps ---------------------

    [Fact]
    public async Task ReRolledAttempts_CountAgainstTheHourlyCap_WithoutHoldingTheBurstThatPassed()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        // perHour 6 = one 2-post burst that took 3 attempts (2 + 2 re-rolls x 2 posts).
        harness.SetPolicy(AmbientPolicyMode.Autonomous, perMinute: 10, perHour: 6);
        var offending = new GeneratedPost("@gen0", "evacuation order on river road", 0.4, []);
        harness.Provider.DuringGenerate = () => harness.Provider.Posts =
            harness.Provider.Calls < GenerateStage.DefaultMaxAttempts
                ? [offending, ScriptedGenerationProvider.CleanBurst[1]]
                : ScriptedGenerationProvider.CleanBurst;

        await harness.TickAsync();

        harness.Provider.Calls.Should().Be(GenerateStage.DefaultMaxAttempts, "two filtered attempts, then a clean one");
        harness.Publisher.Published.Should().HaveCount(2, "the accepted burst itself is not retro-held by its own re-rolls");

        harness.Time.Advance(TimeSpan.FromSeconds(61));
        await harness.TickAsync();

        harness.Provider.Calls.Should().Be(
            GenerateStage.DefaultMaxAttempts, "3 provider calls x 2 posts = 6 spent: the hourly cap is reached, no new call (W-B)");
        harness.Publisher.Published.Should().HaveCount(2);
    }

    [Fact]
    public async Task ADroppedBurst_CountsEveryAttemptAgainstTheCaps()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Autonomous, perMinute: 10, perHour: 6);
        harness.Provider.Posts = [new GeneratedPost("@gen0", "evacuation order on river road", 0.4, []), ScriptedGenerationProvider.CleanBurst[1]];

        await harness.TickAsync();
        harness.Provider.Calls.Should().Be(GenerateStage.DefaultMaxAttempts, "re-rolled to the budget, then dropped");

        harness.Provider.Posts = ScriptedGenerationProvider.CleanBurst;
        harness.Time.Advance(TimeSpan.FromSeconds(61));
        await harness.TickAsync();

        harness.Provider.Calls.Should().Be(GenerateStage.DefaultMaxAttempts, "every dropped attempt was a real call and is counted (W-B)");
        harness.Publisher.Published.Should().BeEmpty();
    }

    [Fact]
    public async Task AFirstTimeAcceptedBurst_CountsOnlyItsOwnPosts()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Autonomous, perMinute: 10, perHour: 4);

        await harness.TickAsync();
        harness.Time.Advance(TimeSpan.FromSeconds(61));
        await harness.TickAsync();

        harness.Provider.Calls.Should().Be(2, "with no re-rolls each burst spends 2 of the 4, so a second burst still fits");
        harness.Publisher.Published.Should().HaveCount(4);
    }

    // ---- SG-2: every attempt is counted BEFORE its provider call --------------------------------------

    [Fact]
    public async Task AnAttemptThatThrows_IsStillCountedAgainstTheCaps()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        // perHour 4 = two 2-post attempts: a filtered first attempt, then a re-roll whose provider call throws.
        harness.SetPolicy(AmbientPolicyMode.Autonomous, perMinute: 10, perHour: 4);
        harness.Provider.Posts = [new GeneratedPost("@gen0", "evacuation order on river road", 0.4, []), ScriptedGenerationProvider.CleanBurst[1]];
        harness.Provider.DuringGenerate = () =>
        {
            if (harness.Provider.Calls == 2)
            {
                throw new InvalidOperationException("provider failed mid re-roll");
            }
        };

        await harness.TickAsync();
        harness.Provider.Calls.Should().Be(2, "the second attempt's call threw");

        harness.Provider.DuringGenerate = null;
        harness.Provider.Posts = ScriptedGenerationProvider.CleanBurst;
        harness.Time.Advance(TimeSpan.FromSeconds(61));
        await harness.TickAsync();

        harness.Provider.Calls.Should().Be(2, "both attempts were counted up front (SG-2): 4 of 4 spent, no new call");
        harness.Publisher.Published.Should().BeEmpty();
    }

    // ---- SG-3: a kill-switch FULL STOP mid-generation discards the review draft ----------------------

    [Fact]
    public async Task AReviewDraft_FinishingAfterAFullStop_IsDiscarded_NotQueued()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Review);
        harness.Provider.DuringGenerate = () =>
            harness.Autonomy.GetOrCreate(harness.ExerciseId).EngageKillSwitch(KillSwitchMode.FullStop, "lead-1", 0);

        await harness.TickAsync();

        (await harness.ReviewItemsAsync()).Should().BeEmpty("STOPPED halts generation, so its draft is never queued (SG-3)");
        (await harness.PayloadsAsync(EngineEventTypes.Generated)).Single()
            .GetProperty("heldReason").GetString().Should().Be(EngineEventPayloads.HeldSafety);
    }

    [Fact]
    public async Task AReviewDraft_FinishingAfterSuggestOnlyOrACutToFake_IsStillQueued()
    {
        foreach (var lever in new[] { "suggest-only", "cut" })
        {
            await using var harness = await AmbientLoopHarness.CreateAsync();
            harness.SetPolicy(AmbientPolicyMode.Review);
            harness.Provider.DuringGenerate = lever == "cut"
                ? () => harness.Cut.Cut(harness.ExerciseId)
                : () => harness.Autonomy.GetOrCreate(harness.ExerciseId).EngageKillSwitch(KillSwitchMode.DropToSuggest, "lead-1", 0);

            await harness.TickAsync();

            (await harness.ReviewItemsAsync()).Should().ContainSingle(
                $"review drafts still wait for a human under {lever} — only a full stop discards them (SG-3)");
        }
    }

    // ---- Gate-1 S-1: the autonomous publish names the CURRENT policy's setter ------------------------

    [Fact]
    public async Task AnAutonomousPublish_IsAuthorizedByTheCurrentPolicySetter_NotTheTickStartOne()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Autonomous);
        harness.Provider.DuringGenerate = () =>
            harness.Ambient.Set(harness.ExerciseId, harness.Ambient.Get(harness.ExerciseId) with { SetBy = "controller-9" });

        await harness.TickAsync();

        harness.Publisher.Published.Should().NotBeEmpty()
            .And.OnlyContain(burst => burst.AuthorizedBy == "controller-9", "the policy that admitted the post was re-set mid-flight");
    }

    // ---- W-4: the loop never voices an ineligible type ---------------------------------------------

    [Fact]
    public async Task AnAllowListedOutlet_IsNeverVoiced_EvenIfThePolicyNamesIt()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        var outlet = new EnginePersona(
            Guid.NewGuid(), new PersonaDossier { Handle = "@desk", DisplayName = "Desk", Type = PersonaType.Outlet });
        var registration = Copy(harness.Registration, extraCast: outlet);
        harness.Ambient.Set(harness.ExerciseId, harness.Policy(AmbientPolicyMode.Autonomous) with
        {
            PersonaAllowList = [outlet.InstanceId], // bypassing the POST's 400 on purpose
        });

        await harness.TickAsync(registration);

        harness.Provider.Calls.Should().Be(0, "an outlet-only allow-list allows nothing");
        harness.Publisher.Published.Should().BeEmpty();
    }

    // ---- W-6: the publish re-check reads the CURRENT policy, not just its mode ----------------------

    public static IEnumerable<object[]> Narrowings =>
    [
        ["persona removed", (Func<AmbientTierPolicy, AmbientTierPolicy>)(p => p with { PersonaAllowList = [] })],
        ["topic removed", (Func<AmbientTierPolicy, AmbientTierPolicy>)(p => p with { TopicAllowList = [] })],
        ["per-minute cap zeroed", (Func<AmbientTierPolicy, AmbientTierPolicy>)(p => p with { MaxPerMinute = 0 })],
        ["per-hour cap zeroed", (Func<AmbientTierPolicy, AmbientTierPolicy>)(p => p with { MaxPerHour = 0 })],
        ["per-minute cap lowered below the spend", (Func<AmbientTierPolicy, AmbientTierPolicy>)(p => p with { MaxPerMinute = 1 })],
    ];

    [Theory]
    [MemberData(nameof(Narrowings))]
    public async Task APolicyNarrowedBetweenGenerationAndPublish_HoldsThePublish(string why, Func<AmbientTierPolicy, AmbientTierPolicy> narrow)
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Autonomous);
        harness.Provider.DuringGenerate = () =>
            harness.Ambient.Set(harness.ExerciseId, narrow(harness.Ambient.Get(harness.ExerciseId)));

        await harness.TickAsync();

        harness.Publisher.Published.Should().BeEmpty($"{why}: the last boundary re-reads the current policy (W-6)");
        (await harness.PayloadsAsync(EngineEventTypes.Generated)).Single()
            .GetProperty("heldReason").GetString().Should().Be("held:policy");
    }

    [Fact]
    public async Task APersonaRemovedAfterTheFirstPost_HoldsTheRestOfTheBurst()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Autonomous);
        harness.Publisher.AfterPublish = _ => harness.Ambient.Set(
            harness.ExerciseId, harness.Ambient.Get(harness.ExerciseId) with { PersonaAllowList = [] });

        await harness.TickAsync();

        harness.Publisher.Published.Should().ContainSingle("the first post was already handed over; the second is held");
    }

    // ---- W-7: a review draft finishing into a closed world is discarded -----------------------------

    [Fact]
    public async Task AReviewDraft_FinishingAfterFreeze_IsDiscarded_NotQueued()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Review);
        harness.Provider.DuringGenerate = () => harness.PauseTiers.Restore(harness.ExerciseId, PauseTier.Freeze);

        await harness.TickAsync();

        (await harness.ReviewItemsAsync()).Should().BeEmpty("a Freeze mid-generation discards the review draft (W-7)");
        (await harness.PayloadsAsync(EngineEventTypes.Generated)).Single()
            .GetProperty("heldReason").GetString().Should().Be("held:lifecycle");
    }

    [Fact]
    public async Task AReviewDraft_FinishingAfterEndEx_IsDiscarded_NotQueued()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Review);
        harness.Provider.DuringGenerate = () => harness.SetStatusAsync("completed").GetAwaiter().GetResult();

        await harness.TickAsync();

        (await harness.ReviewItemsAsync()).Should().BeEmpty("EndEx mid-generation discards the review draft (W-7)");
        (await harness.PayloadsAsync(EngineEventTypes.Generated)).Single()
            .GetProperty("heldReason").GetString().Should().Be("held:lifecycle");
    }

    [Fact]
    public async Task AReviewDraft_WhosePolicyWasTurnedOffMidGeneration_IsDiscarded()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Review);
        harness.Provider.DuringGenerate = () => harness.SetPolicy(AmbientPolicyMode.Off);

        await harness.TickAsync();

        (await harness.ReviewItemsAsync()).Should().BeEmpty();
        (await harness.PayloadsAsync(EngineEventTypes.Generated)).Single()
            .GetProperty("heldReason").GetString().Should().Be("held:policy");
    }

    // ---- S-1: an approved ambient draft is tagged for the AAR ---------------------------------------

    [Fact]
    public async Task AnApprovedAmbientDraft_PublishesWithAmbientFloorTrigger_AndTheReviewedPublishPath()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        harness.SetPolicy(AmbientPolicyMode.Review);
        await harness.TickAsync();
        var draft = (await harness.ReviewItemsAsync()).Single();

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
                harness.Ambient);

            (await service.ApproveAsync(draft.DraftId, new EngineReviewActionInput("controller-7", "UTC")))
                .Outcome.Should().Be(EngineReviewOutcome.Ok);
        }

        var burst = harness.Publisher.Published.Should().ContainSingle().Subject;
        burst.Trigger.Should().Be(EngineEventPayloads.AmbientFloorTrigger);
        burst.PublishPath.Should().Be(EngineEventPayloads.PublishPathAmbientReviewed, "the AAR tells reviewed from autonomous ambient");
        burst.AuthorizedBy.Should().BeNull("a reviewed publish keeps the default engine actor; the approval event names the human");
    }

    private static ReactionLoopRegistration WithDormantStoryline(ReactionLoopRegistration source)
    {
        // A dormant storyline produces no intent this tick, but its hashtag and title feed the ambient exclusions.
        var storyline = Storyline.Create(
            source.ExerciseId, "Water main fears", "a county statement", responseWindowMin: 20,
            participatingPersonas: AmbientLoopHarness.Handles, hashtags: ["#WaterIssues"]);
        return Copy(source, storylines: [storyline]);
    }

    private static ReactionLoopRegistration Copy(
        ReactionLoopRegistration source,
        string? brief = null,
        string? placeName = null,
        IReadOnlyList<Storyline>? storylines = null,
        EnginePersona? extraCast = null)
    {
        var cast = source.PersonasByHandle.ToDictionary(p => p.Key, p => p.Value, StringComparer.OrdinalIgnoreCase);
        if (extraCast is not null)
        {
            cast[extraCast.Dossier.Handle] = extraCast;
        }

        return new ReactionLoopRegistration
        {
            ExerciseId = source.ExerciseId,
            ExerciseBrief = brief ?? source.ExerciseBrief,
            AmbientPlaceName = placeName,
            TimeZone = source.TimeZone,
            ScenarioStart = source.ScenarioStart,
            TimeZoneInfo = source.TimeZoneInfo,
            Storylines = storylines ?? source.Storylines,
            PersonasByHandle = cast,
            Autonomy = source.Autonomy,
            ControllerDeskId = source.ControllerDeskId,
        };
    }
}
