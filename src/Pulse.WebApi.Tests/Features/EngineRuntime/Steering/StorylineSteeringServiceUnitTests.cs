namespace Pulse.WebApi.Tests.Features.EngineRuntime.Steering;

using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using FluentAssertions;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Autonomy.Services;
using Pulse.Core.Features.Storylines.Models;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Xunit;

/// <summary>
/// Direct unit coverage of <see cref="StorylineSteeringService"/> — no HTTP host, no database — for two
/// Gate-1 findings that don't need the real SQL fixture:
/// <list type="bullet">
///   <item><description>W-001 — the <c>"primary"</c> sentinel must be compared EXACTLY, never treated as
///   "anything that isn't a GUID"; a stray literal (<c>"undefined"</c>, a typo, ...) must 404, never silently
///   wildcard to whichever storyline happens to be first.</description></item>
///   <item><description>W-002 — the <see cref="Storyline.ExerciseId"/> defense-in-depth guard on a corrupt
///   registration (mirrors <c>ReactionLoopHost.BuildReviewItem</c>'s identical guard, COR-001): fail loud rather
///   than silently 404 or serve/mutate the wrong exercise's storyline.</description></item>
/// </list>
/// </summary>
public sealed class StorylineSteeringServiceUnitTests
{
    private static StorylineSteeringService Build(Guid callerExerciseId, IReactionLoopRegistry registry) =>
        new(
            registry,
            new ExerciseContext { CurrentExerciseId = callerExerciseId },
            new ExerciseClockService(TimeProvider.System));

    private static Storyline Seeded(Guid exerciseId, string title = "Water main contamination fears")
    {
        var storyline = Storyline.Create(exerciseId, title: title, expectation: "an official statement");
        storyline.Seed(0);
        return storyline;
    }

    private static ReactionLoopRegistration Registration(Guid exerciseId, params Storyline[] storylines) => new()
    {
        ExerciseId = exerciseId,
        ExerciseBrief = "A fictional incident.",
        TimeZone = "America/Chicago",
        ScenarioStart = DateTimeOffset.UtcNow,
        TimeZoneInfo = TimeZoneInfo.Utc,
        Storylines = storylines,
        PersonasByHandle = new Dictionary<string, EnginePersona>(StringComparer.Ordinal),
        Autonomy = EngineAutonomyState.Create(exerciseId, AutonomyLevel.Suggest),
        ControllerDeskId = Guid.NewGuid(),
    };

    // ---- W-001: the sentinel is EXACT, never a wildcard --------------------------------------------

    [Theory]
    [InlineData("undefined")]
    [InlineData("null")]
    [InlineData("prmary")]
    [InlineData("PRIMARY")]
    [InlineData(" primary")]
    [InlineData("primary ")]
    [InlineData("")]
    public async Task GetAsync_ANonSentinelNonGuidLiteral_Returns404_NeverWildcardsToTheFirstStoryline(string strayLiteral)
    {
        var exerciseId = Guid.NewGuid();
        var storyline = Seeded(exerciseId);
        var registry = new ReactionLoopRegistry();
        registry.Register(Registration(exerciseId, storyline));
        var service = Build(exerciseId, registry);

        var result = await service.GetAsync(strayLiteral);

        result.Outcome.Should().Be(
            StorylineSteeringOutcome.NotFound,
            $"'{strayLiteral}' is neither the exact sentinel nor a real GUID and must never silently resolve to the first storyline (W-001)");
    }

    [Fact]
    public async Task GetAsync_TheExactSentinelLiteral_ResolvesToTheCallersFirstStoryline()
    {
        var exerciseId = Guid.NewGuid();
        var storyline = Seeded(exerciseId);
        var registry = new ReactionLoopRegistry();
        registry.Register(Registration(exerciseId, storyline));
        var service = Build(exerciseId, registry);

        var result = await service.GetAsync(StorylineSteeringService.PrimaryStorylineSentinel);

        result.Outcome.Should().Be(StorylineSteeringOutcome.Ok);
        result.Storyline!.StorylineId.Should().Be(storyline.Id.ToString());
    }

    [Fact]
    public async Task GetAsync_ARealGuidForAnUnknownStorylineInTheCallersOwnExercise_Returns404()
    {
        var exerciseId = Guid.NewGuid();
        var storyline = Seeded(exerciseId);
        var registry = new ReactionLoopRegistry();
        registry.Register(Registration(exerciseId, storyline));
        var service = Build(exerciseId, registry);

        var result = await service.GetAsync(Guid.NewGuid().ToString());

        result.Outcome.Should().Be(StorylineSteeringOutcome.NotFound);
    }

    [Fact]
    public async Task SetTargetAsync_ANonSentinelNonGuidLiteral_Returns404_AndNeverMutatesTheFirstStoryline()
    {
        var exerciseId = Guid.NewGuid();
        var storyline = Seeded(exerciseId);
        var registry = new ReactionLoopRegistry();
        registry.Register(Registration(exerciseId, storyline));
        var service = Build(exerciseId, registry);

        var result = await service.SetTargetAsync("undefined", 90);

        result.Outcome.Should().Be(StorylineSteeringOutcome.NotFound);
        storyline.TargetIntensity.Should().BeNull("a stray literal must never wildcard-mutate the first storyline (W-001)");
    }

    // ---- W-002: defense-in-depth ExerciseId guard on a corrupt registration ------------------------

    [Fact]
    public async Task GetAsync_ACorruptRegistration_WhereTheStorylinesOwnExerciseIdDisagrees_ThrowsRatherThanServingIt()
    {
        var registrationExerciseId = Guid.NewGuid();
        var foreignExerciseId = Guid.NewGuid();
        // A corrupt registration: registered under registrationExerciseId, but the storyline object itself
        // carries a DIFFERENT ExerciseId (mirrors the identical corrupt-registration setup in
        // ReactionLoopHostTests.Tick_WhenAStorylineScopeDisagreesWithTheRegistration_FailsLoud_AndEnqueuesNothing).
        var foreignStoryline = Seeded(foreignExerciseId);
        var registry = new ReactionLoopRegistry();
        registry.Register(Registration(registrationExerciseId, foreignStoryline));
        var service = Build(registrationExerciseId, registry);

        var act = async () => await service.GetAsync(StorylineSteeringService.PrimaryStorylineSentinel);

        await act.Should().ThrowAsync<InvalidOperationException>(
            "a storyline whose own ExerciseId disagrees with its registration must fail loud (W-002, COR-001), never silently 404 or serve it");
    }

    [Fact]
    public async Task SetTargetAsync_ACorruptRegistration_ThrowsRatherThanMutatingIt()
    {
        var registrationExerciseId = Guid.NewGuid();
        var foreignExerciseId = Guid.NewGuid();
        var foreignStoryline = Seeded(foreignExerciseId);
        var registry = new ReactionLoopRegistry();
        registry.Register(Registration(registrationExerciseId, foreignStoryline));
        var service = Build(registrationExerciseId, registry);

        var act = async () => await service.SetTargetAsync(StorylineSteeringService.PrimaryStorylineSentinel, 80);

        await act.Should().ThrowAsync<InvalidOperationException>();
        foreignStoryline.TargetIntensity.Should().BeNull("the guard must fire BEFORE any mutation is attempted");
    }

    [Fact]
    public async Task GetAsync_ACorruptRegistration_ByRealGuid_AlsoThrows()
    {
        var registrationExerciseId = Guid.NewGuid();
        var foreignExerciseId = Guid.NewGuid();
        var foreignStoryline = Seeded(foreignExerciseId);
        var registry = new ReactionLoopRegistry();
        registry.Register(Registration(registrationExerciseId, foreignStoryline));
        var service = Build(registrationExerciseId, registry);

        var act = async () => await service.GetAsync(foreignStoryline.Id.ToString());

        await act.Should().ThrowAsync<InvalidOperationException>(
            "the guard applies whether the caller addressed the storyline by the sentinel or its real id");
    }
}
