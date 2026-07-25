namespace Pulse.WebApi.Tests.Features.EngineRuntime.Steering;

using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Core.Core.Extensions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;
using Pulse.Core.Features.Storylines.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Extensions;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Xunit;

/// <summary>
/// The load-bearing proof for story 09's key finding (feature: world-steering; CTL-022): with NO new
/// reaction-loop or intensity-model code, setting a live target on an <see cref="StorylinePhase.Escalating"/>
/// storyline — exactly what <c>StorylineSteeringService.SetTargetAsync</c> does — is enough for the ALREADY-
/// SHIPPED <see cref="Storyline.Tick"/> → <c>IntensityModel.TickTowardTarget</c> branch to chase it on
/// subsequent <see cref="ReactionLoopDriver.RunTickAsync"/> calls. Mirrors <c>ReactionLoopHostTests</c>' host
/// harness exactly (same DI wiring, same Testcontainers fixture); every test is
/// <see cref="RequiresDockerFactAttribute"/>.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class StorylineTargetChaseIntegrationTests
{
    private static readonly DateTimeOffset ScenarioStart = new(2033, 6, 1, 9, 0, 0, TimeSpan.Zero);

    private readonly MsSqlContainerFixture _fixture;

    public StorylineTargetChaseIntegrationTests(MsSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    private ServiceProvider BuildHost(TimeProvider timeProvider)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(timeProvider);

        services.AddScoped<IExerciseContext, ExerciseContext>();
        services.AddDbContext<PulseDbContext>(o => o.UseSqlServer(_fixture.ConnectionString));
        services.AddScoped<PostIngestService>();
        services.AddSingleton<IFeedBroadcaster, RecordingFeedBroadcaster>();

        var reviewBroadcaster = new RecordingReviewBroadcaster();
        services.AddSingleton(reviewBroadcaster);
        services.AddSingleton<IEngineReviewBroadcaster>(reviewBroadcaster);

        services.AddEngineGeneration(new ConfigurationBuilder().Build()); // Fake provider
        services.AddExerciseScoping();
        services.AddExerciseClock();
        services.AddEngineRuntimeSeams();
        services.AddReactionLoopHost();

        // W-005: registers StorylineSteeringService over the SAME IReactionLoopRegistry
        // AddReactionLoopHost() already registered (TryAddSingleton converges on it), so a test can go through
        // the actual service — not a hand-called SetTargetIntensity stand-in — and then tick.
        services.AddStorylineSteering();

        return services.BuildServiceProvider();
    }

    /// <summary>
    /// Builds a storyline already <see cref="StorylinePhase.Escalating"/> with a live target set — exactly the
    /// state <c>StorylineSteeringService.SetTargetAsync</c> leaves a storyline in — and a reaction-cadence gate
    /// pinned far out so OBSERVE never re-fires an inaction trigger for it during the test (this suite proves
    /// the MEASURE-stage chase ONLY; the DECIDE/GENERATE stages, personas, and review-item enqueue are
    /// deliberately out of scope here — no persona cast is registered).
    /// </summary>
    private static Storyline EscalatingStorylineWithTarget(Guid exerciseId, int initialIntensity, int target)
    {
        var storyline = Storyline.Create(
            exerciseId,
            title: "Water main contamination fears",
            expectation: "an official statement from the county",
            responseWindowMin: 20,
            initialIntensity: initialIntensity);
        storyline.Seed(0);
        storyline.DetectActivity(0); // Seeded -> Escalating
        storyline.SetTargetIntensity(target, 0); // the SAME mutation StorylineSteeringService.SetTargetAsync performs
        storyline.RecordEngineReaction(0); // suppress OBSERVE re-firing for the duration of this test
        return storyline;
    }

    /// <summary>
    /// Builds an <see cref="StorylinePhase.Escalating"/> storyline with NO target set yet (W-005) — the test
    /// sets it through the ACTUAL <see cref="StorylineSteeringService"/>, not a hand-called
    /// <c>SetTargetIntensity</c> stand-in, so the composition end-to-end (service → registry → tick) is what's
    /// under test rather than an assumption that the two are equivalent.
    /// </summary>
    private static Storyline EscalatingStorylineNoTarget(Guid exerciseId, int initialIntensity)
    {
        var storyline = Storyline.Create(
            exerciseId,
            title: "Water main contamination fears",
            expectation: "an official statement from the county",
            responseWindowMin: 20,
            initialIntensity: initialIntensity);
        storyline.Seed(0);
        storyline.DetectActivity(0); // Seeded -> Escalating
        storyline.RecordEngineReaction(0); // suppress OBSERVE re-firing for the duration of this test
        return storyline;
    }

    private static ReactionLoopRegistration Registration(Guid exerciseId, Storyline storyline) => new()
    {
        ExerciseId = exerciseId,
        ExerciseBrief = "A fictional water-utility incident in the town of Cedar Falls.",
        TimeZone = "America/Chicago",
        ScenarioStart = ScenarioStart,
        TimeZoneInfo = TimeZoneInfo.Utc,
        Storylines = [storyline],
        PersonasByHandle = new Dictionary<string, EnginePersona>(StringComparer.Ordinal),
        // A cadence pinned far beyond this test's short scenario window means OBSERVE never re-fires an
        // inaction trigger after the seed-time RecordEngineReaction above — isolating this test to the
        // MEASURE-stage chase alone.
        RateConfig = new RateGovernanceConfig(maxEnginePostsPerMinute: 60, minBelievableActivity: 6)
        {
            MinMinutesBetweenInactionReactions = 1000,
        },
        Autonomy = EngineAutonomyState.Create(exerciseId, AutonomyLevel.Suggest),
        ControllerDeskId = Guid.NewGuid(),
    };

    private async Task<ReactionTickResult> RunOneTickAsync(ServiceProvider host, ReactionLoopRegistration registration)
    {
        var driver = host.GetRequiredService<ReactionLoopDriver>();
        using var scope = host.CreateScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId =
            registration.ExerciseId;
        return await driver.RunTickAsync(registration, scope.ServiceProvider);
    }

    [RequiresDockerFact]
    public async Task TwoConsecutiveTicks_WithATargetAboveCurrentIntensity_NarrowTheActualToTargetGap_WithNoNewEngineCode()
    {
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);

        await using var host = BuildHost(manualTime);
        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);

        var storyline = EscalatingStorylineWithTarget(exerciseId, initialIntensity: 30, target: 90);
        var registration = Registration(exerciseId, storyline);

        var before = storyline.Intensity;
        before.Should().Be(30);

        // Tick 1 — 5 scenario minutes elapse.
        manualTime.Advance(TimeSpan.FromMinutes(5));
        await RunOneTickAsync(host, registration);
        var afterTick1 = storyline.Intensity;
        var gapAfterTick1 = 90 - afterTick1;

        afterTick1.Should().BeGreaterThan(before, "the MEASURE stage's existing TickTowardTarget branch must raise actual intensity toward the live target with no new engine code");
        gapAfterTick1.Should().BeLessThan(90 - before, "the actual→target gap must narrow after the first tick");
        storyline.Phase.Should().Be(StorylinePhase.Escalating, "an in-flight chase must not itself force an unrelated phase change");
        storyline.TargetIntensity.Should().Be(90, "the controller's live target is untouched by ticking");

        // Tick 2 — another 5 scenario minutes elapse; the gap must narrow FURTHER (proves the chase runs on
        // subsequent ticks, not just once).
        manualTime.Advance(TimeSpan.FromMinutes(5));
        await RunOneTickAsync(host, registration);
        var afterTick2 = storyline.Intensity;
        var gapAfterTick2 = 90 - afterTick2;

        afterTick2.Should().BeGreaterThan(afterTick1, "the second tick continues the chase");
        gapAfterTick2.Should().BeLessThan(gapAfterTick1, "the actual→target gap must keep narrowing tick over tick");
        afterTick2.Should().BeLessOrEqualTo(90, "the chase never overshoots the controller's target");
    }

    [RequiresDockerFact]
    public async Task Tick_OnceActualReachesTheTarget_HoldsThereRatherThanOvershooting()
    {
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);

        await using var host = BuildHost(manualTime);
        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);

        // A small, easily-closed gap (well within one tick's rise) — a large elapsed span would fully close it
        // on the very first tick, letting the SECOND tick prove the hold (never overshoot) behaviour.
        var storyline = EscalatingStorylineWithTarget(exerciseId, initialIntensity: 60, target: 62);
        var registration = Registration(exerciseId, storyline);

        manualTime.Advance(TimeSpan.FromMinutes(5));
        await RunOneTickAsync(host, registration);
        storyline.Intensity.Should().Be(62, "the gap fully closes once the target is within one tick's reach");

        // A further tick must HOLD exactly at the target, never overshoot past it even though the curve's rise
        // rate would otherwise keep pushing intensity upward.
        manualTime.Advance(TimeSpan.FromMinutes(5));
        await RunOneTickAsync(host, registration);
        storyline.Intensity.Should().Be(62, "once actual reaches the target, the chase holds rather than overshooting it");
    }

    [RequiresDockerFact]
    public async Task Composes_SetTargetAsync_ThenTwoTicks_NarrowTheGap_ProvingTheServiceReachesTheSameChase()
    {
        // W-005: the other tests in this class hand-call Storyline.SetTargetIntensity with a comment
        // asserting it is "the same mutation the service performs" — true today, but exactly the kind of
        // assumption this Gate-1 wave exists to eliminate. This test goes through the ACTUAL
        // StorylineSteeringService, resolved from DI with a real per-call exercise scope, so the full
        // composition (service -> registry -> the SAME Storyline object -> tick) is what is proven, not an
        // assumption that a direct call and the service's call are equivalent.
        var exerciseId = Guid.NewGuid();
        var manualTime = new ManualTimeProvider(ScenarioStart);

        await using var host = BuildHost(manualTime);
        var clock = host.GetRequiredService<IExerciseClock>();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);

        var storyline = EscalatingStorylineNoTarget(exerciseId, initialIntensity: 30);
        var registration = Registration(exerciseId, storyline);

        // Register the SAME registration into the registry the service reads from (RunOneTickAsync below
        // ticks it directly via the driver, exactly as the other tests do — the registry registration is
        // what lets StorylineSteeringService find the SAME Storyline instance to mutate).
        var registry = host.GetRequiredService<IReactionLoopRegistry>();
        registry.Register(registration);

        using (var scope = host.CreateScope())
        {
            ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = exerciseId;
            var steeringService = scope.ServiceProvider.GetRequiredService<StorylineSteeringService>();

            var setResult = await steeringService.SetTargetAsync(StorylineSteeringService.PrimaryStorylineSentinel, 90);

            setResult.Outcome.Should().Be(StorylineSteeringOutcome.Ok);
            setResult.Storyline!.TargetIntensity.Should().Be(90);
        }

        // The SAME in-memory object was mutated — no shadow/duplicate storyline (AC2).
        storyline.TargetIntensity.Should().Be(90);

        var before = storyline.Intensity;
        before.Should().Be(30);

        manualTime.Advance(TimeSpan.FromMinutes(5));
        await RunOneTickAsync(host, registration);
        var afterTick1 = storyline.Intensity;
        afterTick1.Should().BeGreaterThan(before, "the service's SetTargetAsync must reach the SAME chase the other tests prove");

        manualTime.Advance(TimeSpan.FromMinutes(5));
        await RunOneTickAsync(host, registration);
        var afterTick2 = storyline.Intensity;

        afterTick2.Should().BeGreaterThan(afterTick1, "the gap keeps narrowing tick over tick, via the SERVICE's own mutation");
        (90 - afterTick2).Should().BeLessThan(90 - afterTick1);
    }
}
