namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Moq;
using Pulse.Core.Core.Extensions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;
using Pulse.Core.Features.PersonaVoice.Models;
using Pulse.Core.Features.Storylines.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Publishing;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Xunit;

/// <summary>
/// The end-to-end proof that autonomy-safety story 05 closes the "Delayed-auto is unreachable" gap: the
/// settings service and the REACTION LOOP share one <see cref="EngineAutonomyRegistry"/> /
/// <see cref="EngineTierPolicyRegistry"/> instance, so a controller's runtime change reaches the very next
/// generated burst — a Delayed-auto exercise enqueues a COUNTING-DOWN draft instead of a Suggest-queued one,
/// and a tier-policy override changes the tier the burst is actually generated at. Real SQL Server
/// (Testcontainers) + the offline generation provider; every test is <see cref="RequiresDockerFactAttribute"/>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class EngineSettingsLoopIntegrationTests
{
    private static readonly DateTimeOffset ScenarioStart = new(2033, 6, 1, 9, 0, 0, TimeSpan.Zero);

    private readonly MsSqlContainerFixture _fixture;

    public EngineSettingsLoopIntegrationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [RequiresDockerFact]
    public async Task AfterSettingDelayedAuto_TheNextBurstIsACountingDownDraft_NotSuggestQueued()
    {
        var exerciseId = Guid.NewGuid();
        var time = new ManualTimeProvider(ScenarioStart);
        await using var host = BuildHost(time);

        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        time.Advance(TimeSpan.FromMinutes(25)); // the 20-minute response window blows

        // The loop registration holds the SHARED autonomy state from the singleton registry — exactly what the
        // production seed path (EngineContentSeedService) does. This is the seam the settings POST writes to.
        var registry = host.GetRequiredService<EngineAutonomyRegistry>();
        var cast = Cast("@rosa", "@marcus", "@lena");
        var storyline = SeededStoryline(exerciseId, "Water main contamination fears", cast.Keys.ToList());
        var registration = Registration(exerciseId, [storyline], cast, registry.GetOrCreate(exerciseId));

        // BEFORE: the pre-story-05 world. Nothing ever called SetExerciseDefault, so the exercise is stuck at the
        // Suggest seed and the burst lands as a plain queued draft with NO countdown.
        var first = await RunOneTickAsync(host, registration);
        first.ReviewItemsEnqueued.Should().Be(1);
        var queued = await SingleItemAsync(exerciseId);
        queued.Disposition.Should().Be(
            DraftDisposition.Queued, "at the Suggest default a burst is queued for explicit approval");
        queued.RoutedAtLevel.Should().Be(AutonomyLevel.Suggest);
        queued.CountdownStartedScenarioMinute.Should().BeNull("a Suggest draft has no countdown at all");

        // THE CONTROLLER ACTS — the story-05 endpoint's service call, through a request scope, with no redeploy
        // and no restart of the loop.
        await SetAutonomyDefaultAsync(host, exerciseId, "delayed-auto");

        // AFTER: the same running loop, same registration object, next burst.
        time.Advance(TimeSpan.FromMinutes(25)); // past the reaction cadence so the storyline re-fires
        var second = await RunOneTickAsync(host, registration);
        second.ReviewItemsEnqueued.Should().Be(1, "the storyline re-fires once the reaction cadence has elapsed");

        var items = await AllItemsAsync(exerciseId);
        items.Should().HaveCount(2);
        var timed = items.Single(i => i.DraftId != queued.DraftId);
        timed.RoutedAtLevel.Should().Be(
            AutonomyLevel.DelayedAuto,
            "the loop read the new exercise default off the SHARED autonomy state — this is the 'Delayed-auto is unreachable' gap closing");
        timed.Disposition.Should().Be(
            DraftDisposition.CountingDown, "a Delayed-auto burst COUNTS DOWN; it is not Suggest-queued");
        timed.CountdownStartedScenarioMinute.Should().NotBeNull("the countdown starts at the burst's scenario minute (COR-053)");
        timed.CountdownMinutes.Should().Be(
            ReactionLoopDriver.DefaultDelayedAutoCountdownMinutes, "the timed window the cockpit renders");
        timed.CountdownDecision.Should().Be(ControllerDecision.None);
    }

    [RequiresDockerFact]
    public async Task AfterSettingDelayedAutoThenBackToSuggest_TheNextBurstQueuesAgain()
    {
        var exerciseId = Guid.NewGuid();
        var time = new ManualTimeProvider(ScenarioStart);
        await using var host = BuildHost(time);

        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        time.Advance(TimeSpan.FromMinutes(25));

        var registry = host.GetRequiredService<EngineAutonomyRegistry>();
        var cast = Cast("@rosa", "@marcus", "@lena");
        var storyline = SeededStoryline(exerciseId, "Water main contamination fears", cast.Keys.ToList());
        var registration = Registration(exerciseId, [storyline], cast, registry.GetOrCreate(exerciseId));

        await SetAutonomyDefaultAsync(host, exerciseId, "delayed-auto");
        await RunOneTickAsync(host, registration);

        await SetAutonomyDefaultAsync(host, exerciseId, "suggest");
        time.Advance(TimeSpan.FromMinutes(25));
        await RunOneTickAsync(host, registration);

        var items = await AllItemsAsync(exerciseId);
        items.Should().HaveCount(2);
        items.Count(i => i.Disposition == DraftDisposition.CountingDown).Should().Be(1);
        items.Count(i => i.Disposition == DraftDisposition.Queued).Should().Be(
            1, "lowering the default back to Suggest is live for the next burst too — the control works both ways");
    }

    [RequiresDockerFact]
    public async Task WhileAKillSwitchClampIsActive_SettingDelayedAuto_StillProducesNoAutonomousBurst()
    {
        var exerciseId = Guid.NewGuid();
        var time = new ManualTimeProvider(ScenarioStart);
        await using var host = BuildHost(time);

        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        time.Advance(TimeSpan.FromMinutes(25));

        var registry = host.GetRequiredService<EngineAutonomyRegistry>();
        var state = registry.GetOrCreate(exerciseId);
        state.EngageKillSwitch(KillSwitchMode.FullStop, "lead-1", 0);

        var cast = Cast("@rosa", "@marcus", "@lena");
        var storyline = SeededStoryline(exerciseId, "Water main contamination fears", cast.Keys.ToList());
        var registration = Registration(exerciseId, [storyline], cast, state);

        await SetAutonomyDefaultAsync(host, exerciseId, "delayed-auto");
        var result = await RunOneTickAsync(host, registration);

        result.ReviewItemsEnqueued.Should().Be(
            0,
            "raising the DEFAULT never lifts a full-stop clamp (§8.2): the loop still generates nothing until an explicit restore");
        (await AllItemsAsync(exerciseId)).Should().BeEmpty();
        state.ExerciseDefault.Should().Be(AutonomyLevel.DelayedAuto, "the new base level waits underneath the clamp");
    }

    [RequiresDockerFact]
    public async Task AfterSettingTheTierPolicy_TheNextBurstIsGeneratedAtThatTier_AndAutoRestoresThePurposeMap()
    {
        var exerciseId = Guid.NewGuid();
        var time = new ManualTimeProvider(ScenarioStart);
        await using var host = BuildHost(time);

        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        time.Advance(TimeSpan.FromMinutes(25));

        var provider = host.GetRequiredService<RecordingGenerationProvider>();
        var cast = Cast("@rosa", "@marcus", "@lena");
        var storyline = SeededStoryline(exerciseId, "Water main contamination fears", cast.Keys.ToList());
        var registration = Registration(
            exerciseId, [storyline], cast, host.GetRequiredService<EngineAutonomyRegistry>().GetOrCreate(exerciseId));

        // No override → the purpose-based static map (IntentComposer.TierFor: an inaction trigger is Standard).
        await RunOneTickAsync(host, registration);
        provider.Tiers.Should().Equal([GenerationTier.Standard], "with mode 'auto' the intent's own tier is used");

        await SetTierPolicyAsync(host, exerciseId, "ambient");
        time.Advance(TimeSpan.FromMinutes(25));
        await RunOneTickAsync(host, registration);
        provider.Tiers.Last().Should().Be(
            GenerationTier.Ambient, "the per-exercise override is applied at the loop's IntentComposer call site");

        await SetTierPolicyAsync(host, exerciseId, "auto");
        time.Advance(TimeSpan.FromMinutes(25));
        await RunOneTickAsync(host, registration);
        provider.Tiers.Last().Should().Be(
            GenerationTier.Standard, "'auto' clears the override, restoring the purpose-based map's role");
    }

    [RequiresDockerFact]
    public async Task ATierPolicySetOnExerciseA_NeverChangesExerciseBsBursts()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();
        var time = new ManualTimeProvider(ScenarioStart);
        await using var host = BuildHost(time);

        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseA, ScenarioStart, TimeZoneInfo.Utc);
        clock.Start(exerciseB, ScenarioStart, TimeZoneInfo.Utc);
        time.Advance(TimeSpan.FromMinutes(25));

        var autonomy = host.GetRequiredService<EngineAutonomyRegistry>();
        var provider = host.GetRequiredService<RecordingGenerationProvider>();

        await SetAutonomyDefaultAsync(host, exerciseA, "delayed-auto");
        await SetTierPolicyAsync(host, exerciseA, "ambient");

        var castB = Cast("@rosa", "@marcus", "@lena");
        var storylineB = SeededStoryline(exerciseB, "Boil-water advisory rumours", castB.Keys.ToList());
        await RunOneTickAsync(host, Registration(exerciseB, [storylineB], castB, autonomy.GetOrCreate(exerciseB)));

        provider.Tiers.Should().Equal(
            [GenerationTier.Standard], "COR-001: A's tier override must never reach B's burst");
        var itemB = await SingleItemAsync(exerciseB);
        itemB.Disposition.Should().Be(
            DraftDisposition.Queued, "COR-001: A's Delayed-auto default must never make B's burst auto-timed");
        itemB.RoutedAtLevel.Should().Be(AutonomyLevel.Suggest);
    }

    // ---- host + helpers --------------------------------------------------------------------------

    /// <summary>
    /// Invokes the settings service exactly as the endpoint does: inside a request scope whose
    /// <see cref="IExerciseContext"/> carries the server-authoritative exercise (COR-001).
    /// </summary>
    private static async Task SetAutonomyDefaultAsync(IServiceProvider host, Guid exerciseId, string level)
    {
        using var scope = host.CreateScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = exerciseId;
        var service = scope.ServiceProvider.GetRequiredService<EngineReviewService>();

        var result = await service.SetExerciseAutonomyDefaultAsync(
            level, new EngineReviewActionInput("controller-7", "UTC"));
        result.Outcome.Should().Be(EngineReviewOutcome.Ok, "the settings change must succeed for this proof to mean anything");
    }

    private static async Task SetTierPolicyAsync(IServiceProvider host, Guid exerciseId, string mode)
    {
        using var scope = host.CreateScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = exerciseId;
        var service = scope.ServiceProvider.GetRequiredService<EngineReviewService>();

        var result = await service.SetTierPolicyModeAsync(mode, new EngineReviewActionInput("controller-7", "UTC"));
        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
    }

    private ServiceProvider BuildHost(TimeProvider timeProvider)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(timeProvider);

        services.AddScoped<IExerciseContext, ExerciseContext>();
        services.AddDbContext<PulseDbContext>(o => o.UseSqlServer(_fixture.ConnectionString));

        services.AddEngineGeneration(new ConfigurationBuilder().Build()); // Fake (config default)
        services.AddExerciseScoping();
        services.AddExerciseClock();
        services.AddEngineRuntimeSeams();

        // The loop's publish funnel is irrelevant here (nothing is approved), so keep it a stub instead of
        // pulling in the whole B1 ingest path.
        services.AddSingleton(Mock.Of<IEnginePublishService>());
        services.AddReactionLoopHost();
        services.AddEngineReview();

        // A recording decorator over the offline provider so the tier the burst is ACTUALLY generated at is
        // observable (the Fake provider reports the same model for every tier). Registered AFTER
        // AddEngineGeneration so it is the resolved IGenerationProvider.
        services.AddSingleton<RecordingGenerationProvider>();
        services.AddSingleton<IGenerationProvider>(sp => sp.GetRequiredService<RecordingGenerationProvider>());

        // AddEngineReview's real SignalR broadcaster needs a hub context; this harness has no SignalR, and the
        // push is not what these tests assert.
        services.RemoveAll<IEngineReviewBroadcaster>();
        services.AddSingleton(Mock.Of<IEngineReviewBroadcaster>());

        return services.BuildServiceProvider();
    }

    private static async Task<ReactionTickResult> RunOneTickAsync(IServiceProvider host, ReactionLoopRegistration registration)
    {
        var driver = host.GetRequiredService<ReactionLoopDriver>();
        using var scope = host.CreateScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId =
            registration.ExerciseId;
        return await driver.RunTickAsync(registration, scope.ServiceProvider);
    }

    private async Task<List<EngineReviewItemEntity>> AllItemsAsync(Guid exerciseId)
    {
        await using var read = _fixture.CreateContext();
        return await read.EngineReviewItems
            .IgnoreQueryFilters()
            .Where(i => i.ExerciseId == exerciseId)
            .ToListAsync();
    }

    private async Task<EngineReviewItemEntity> SingleItemAsync(Guid exerciseId)
    {
        var items = await AllItemsAsync(exerciseId);
        return items.Should().ContainSingle().Subject;
    }

    private static Dictionary<string, EnginePersona> Cast(params string[] handles) =>
        handles.ToDictionary(
            handle => handle,
            handle => new EnginePersona(
                Guid.NewGuid(),
                new PersonaDossier { Handle = handle, DisplayName = handle.TrimStart('@'), Type = PersonaType.Resident }),
            StringComparer.Ordinal);

    private static Storyline SeededStoryline(Guid exerciseId, string title, IReadOnlyList<string> personaHandles)
    {
        var storyline = Storyline.Create(
            exerciseId,
            title: title,
            expectation: "an official statement from the county",
            responseWindowMin: 20,
            participatingPersonas: personaHandles,
            hashtags: ["#WaterIssues"]);
        storyline.Seed(0);
        return storyline;
    }

    private static ReactionLoopRegistration Registration(
        Guid exerciseId,
        IReadOnlyList<Storyline> storylines,
        Dictionary<string, EnginePersona> cast,
        EngineAutonomyState autonomy) => new()
        {
            ExerciseId = exerciseId,
            ExerciseBrief = "A fictional water-utility incident in the town of Cedar Falls.",
            TimeZone = "America/Chicago",
            ScenarioStart = ScenarioStart,
            TimeZoneInfo = TimeZoneInfo.Utc,
            Storylines = storylines,
            PersonasByHandle = cast,
            Autonomy = autonomy,
            ControllerDeskId = Guid.NewGuid(),
        };

    /// <summary>
    /// The offline <see cref="FakeGenerationProvider"/> with the requested <see cref="GenerationTier"/> recorded,
    /// so a test can prove which tier a burst was actually generated at.
    /// </summary>
    private sealed class RecordingGenerationProvider : IGenerationProvider
    {
        private readonly FakeGenerationProvider _inner = new();

        public List<GenerationTier> Tiers { get; } = [];

        public string Name => _inner.Name;

        public GenerationGovernance Governance => _inner.Governance;

        public Task<GenerationResult> GenerateAsync(GenerationRequest request, CancellationToken cancellationToken = default)
        {
            ArgumentNullException.ThrowIfNull(request);
            Tiers.Add(request.Tier);
            return _inner.GenerateAsync(request, cancellationToken);
        }
    }
}
