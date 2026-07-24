namespace Pulse.WebApi.Tests.Features.Ops.EngineContentSeed;

using System;
using System.Collections.Generic;
using FluentAssertions;
using Pulse.Core.Features.Storylines.Models;
using Pulse.WebApi.Features.Ops.EngineContentSeed;
using Xunit;

/// <summary>
/// Pure (no DB / no <c>RequiresDockerFact</c>) coverage of story 02's <see cref="StarterStorylineFactory"/>:
/// the canned Fairhaven-arc constants, the citizens-first participating-persona order (AC1), the demo-tuned
/// default + clamped response window (AC2), the <c>Dormant → Seeded</c> arming at minute 0 (AC3), the
/// exercise-id round-trip (AC4), and the stateless-across-calls guarantee (AC5).
/// </summary>
public sealed class StarterStorylineFactoryTests
{
    private static readonly Guid ExerciseId = Guid.NewGuid();

    /// <summary>The six seeded handles in story 01's catalog order (officials first, as story 01 emits them).</summary>
    private static readonly IReadOnlyList<string> SeededHandles =
    [
        "FairhavenWater",
        "FulcoEM",
        "Newsline7",
        "mvega_fh",
        "tbrandt41",
        "kwardFH",
    ];

    [Fact]
    public void Build_SetsTheCannedFairhavenConstants()
    {
        var storyline = StarterStorylineFactory.Build(ExerciseId, SeededHandles);

        storyline.Title.Should().Be("Water main contamination fears");
        storyline.Expectation.Should().Be(
            "an official statement from Fulton County Emergency Management addressing the water safety concern");
        storyline.CurveName.Should().Be("Standard");
        storyline.Hashtags.Should().ContainSingle().Which.Should().Be("#WaterIssues");
    }

    [Fact]
    public void Build_ArmsTheStorylineAtScenarioMinuteZero()
    {
        var storyline = StarterStorylineFactory.Build(ExerciseId, SeededHandles);

        storyline.Phase.Should().Be(
            StorylinePhase.Seeded, "Build calls .Seed(0) so the storyline is immediately eligible for observe/measure (AC3)");
    }

    [Fact]
    public void Build_OrdersParticipatingPersonasCitizensFirst()
    {
        var storyline = StarterStorylineFactory.Build(ExerciseId, SeededHandles);

        storyline.ParticipatingPersonas.Should().Equal(
            new[] { "mvega_fh", "tbrandt41", "kwardFH", "Newsline7", "FairhavenWater", "FulcoEM" },
            "the anxious citizen voices must be picked for the first, smaller bursts before the official/outlet "
            + "accounts (ADP-001), regardless of the order story 01 emits the cast in (AC1)");
    }

    [Fact]
    public void Build_DefaultsResponseWindowToThreeDemoTunedMinutes()
    {
        var storyline = StarterStorylineFactory.Build(ExerciseId, SeededHandles);

        storyline.ResponseWindowMin.Should().Be(
            3, "the demo/pilot default is 3 scenario minutes, not the ~20-minute window used in illustrative tests (AC2)");
    }

    [Fact]
    public void Build_HonorsACustomResponseWindow()
    {
        var storyline = StarterStorylineFactory.Build(
            ExerciseId, SeededHandles, new StarterStorylineOptions { ResponseWindowMinutes = 12 });

        storyline.ResponseWindowMin.Should().Be(12, "a caller-supplied in-bound window is honored verbatim (AC2)");
    }

    [Theory]
    [InlineData(0, 1)]      // below the floor clamps up to 1
    [InlineData(-5, 1)]     // negative clamps up to 1
    [InlineData(500, 180)]  // above the ceiling clamps down to 180
    public void Build_ClampsAnOutOfBoundResponseWindow(int supplied, int expected)
    {
        var storyline = StarterStorylineFactory.Build(
            ExerciseId, SeededHandles, new StarterStorylineOptions { ResponseWindowMinutes = supplied });

        storyline.ResponseWindowMin.Should().Be(
            expected, "an out-of-bound window is clamped into the documented sane bound [1, 180] (AC2)");
    }

    [Fact]
    public void Build_RoundTripsTheExerciseId()
    {
        var storyline = StarterStorylineFactory.Build(ExerciseId, SeededHandles);

        storyline.ExerciseId.Should().Be(
            ExerciseId, "the returned storyline is stamped with the supplied exercise, never a foreign one (COR-001, AC4)");
    }

    [Fact]
    public void Build_IsStateless_TwoCallsYieldIndependentStorylinesForDifferentExercises()
    {
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();

        var first = StarterStorylineFactory.Build(exerciseA, SeededHandles);
        var second = StarterStorylineFactory.Build(exerciseB, SeededHandles);

        first.ExerciseId.Should().Be(exerciseA);
        second.ExerciseId.Should().Be(exerciseB, "no shared static state leaks between back-to-back calls (AC5)");
        first.Should().NotBeSameAs(second, "each call yields a fully independent storyline instance (AC5)");
        first.Id.Should().NotBe(second.Id, "each call gets a fresh storyline id");
    }

    [Fact]
    public void Build_AppendsUnknownHandlesLastWithoutDropping()
    {
        var handles = new[] { "someOtherHandle", "mvega_fh", "FulcoEM" };

        var storyline = StarterStorylineFactory.Build(ExerciseId, handles);

        storyline.ParticipatingPersonas.Should().Equal(
            new[] { "mvega_fh", "FulcoEM", "someOtherHandle" },
            "known handles are ordered citizens-first and an unknown handle is appended last (never dropped)");
    }
}
