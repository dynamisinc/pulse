namespace Pulse.WebApi.Tests.Features.EngineRuntime.Ambient;

using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Pulse.Core.Features.Ambient.Models;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Xunit;

/// <summary>
/// ambient-chatter story 01, AC0/AC1/AC5: the in-memory policy registry (default off, per exercise, only a human
/// raises it), the governed autonomy flag's binding, and the interim lifecycle gate's verdicts. Docker-free.
/// </summary>
public sealed class EngineAmbientPolicyRegistryTests
{
    private static AmbientTierPolicy Autonomous(string setBy = "controller-7") => new()
    {
        Mode = AmbientPolicyMode.Autonomous,
        MaxPerMinute = 5,
        MaxPerHour = 50,
        TopicAllowList = [AmbientTopics.Food],
        PersonaAllowList = [Guid.NewGuid()],
        SetBy = setBy,
    };

    [Fact]
    public void ANewExercise_ReadsOff()
    {
        new EngineAmbientPolicyRegistry().Get(Guid.NewGuid()).Should().BeSameAs(
            AmbientTierPolicy.Off, "after any restart nothing ambient runs until a controller sets it (AC1)");
    }

    [Fact]
    public void Set_ReturnsTheDisplacedPolicy_AndIsPerExercise()
    {
        var registry = new EngineAmbientPolicyRegistry();
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();
        var policy = Autonomous();

        registry.Set(a, policy).Should().BeSameAs(AmbientTierPolicy.Off);
        registry.Set(a, AmbientTierPolicy.Off).Should().BeSameAs(policy);
        registry.Set(a, policy);

        registry.Get(b).Mode.Should().Be(AmbientPolicyMode.Off, "a policy on exercise A never moves exercise B (COR-001)");
    }

    [Fact]
    public void DemoteAutonomous_LowersOnlyAutonomous_KeepingCapsAndLists()
    {
        var registry = new EngineAmbientPolicyRegistry();
        var exerciseId = Guid.NewGuid();
        var policy = Autonomous();
        registry.Set(exerciseId, policy);

        registry.DemoteAutonomous(exerciseId, out var demoted).Should().BeTrue();
        demoted.Should().BeSameAs(policy);
        registry.Get(exerciseId).Should().Be(policy with { Mode = AmbientPolicyMode.Off });
        registry.DemoteAutonomous(exerciseId, out _).Should().BeFalse("already off: nothing to lower, nothing to record");

        var review = policy with { Mode = AmbientPolicyMode.Review };
        registry.Set(exerciseId, review);
        registry.DemoteAutonomous(exerciseId, out _).Should().BeFalse("review mode is not autonomous");
        registry.Get(exerciseId).Should().Be(review);
    }

    [Fact]
    public void AnEmptyExerciseId_IsRejected()
    {
        var act = () => new EngineAmbientPolicyRegistry().Get(Guid.Empty);
        act.Should().Throw<ArgumentException>("ambient policy is exercise-scoped (COR-001)");
    }

    [Fact]
    public void AutonomyAuthorized_DefaultsFalse_WithoutOptions()
    {
        new EngineAmbientPolicyRegistry().AutonomyAuthorized.Should().BeFalse("fail closed");
        new EngineAmbientPolicyRegistry(Options.Create(new EngineAmbientGovernanceOptions { AmbientAutonomyAuthorized = true }))
            .AutonomyAuthorized.Should().BeTrue();
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("false", false)]
    [InlineData("true", true)]
    public void TheGovernedFlag_BindsFromGenerationGovernance(string? value, bool expected)
    {
        var settings = new Dictionary<string, string?>();
        if (value is not null)
        {
            settings["Generation:Governance:AmbientAutonomyAuthorized"] = value;
        }

        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder().AddInMemoryCollection(settings).Build());
        EngineAmbientGovernanceOptions.Register(services);
        services.AddSingleton<EngineAmbientPolicyRegistry>();
        using var provider = services.BuildServiceProvider();

        provider.GetRequiredService<EngineAmbientPolicyRegistry>().AutonomyAuthorized.Should().Be(expected);
    }

    [Fact]
    public void TheCommittedAppsettings_KeepsAmbientAutonomyUnauthorized()
    {
        var configuration = new ConfigurationBuilder()
            .AddJsonFile(System.IO.Path.Combine(AppContext.BaseDirectory, "ConfigFixtures", "appsettings.json"), optional: false)
            .Build();
        var options = new EngineAmbientGovernanceOptions();
        configuration.GetSection(EngineAmbientGovernanceOptions.SectionName).Bind(options);

        options.AmbientAutonomyAuthorized.Should().BeFalse(
            "the code merges dark: only the §8 signer flips this, with the signed amendment (AC0)");
    }

    [Fact]
    public void TheSettingsSnapshot_ExposesTheVocabularyCeilingAndAuthorization()
    {
        var registry = new EngineAmbientPolicyRegistry();
        var dto = registry.Snapshot(Guid.NewGuid());

        dto.Mode.Should().Be(AmbientPolicyMode.Off);
        dto.TopicVocabulary.Should().Equal(AmbientTopics.Vocabulary);
        dto.MaxPerMinuteLimit.Should().Be(60, "the default MaxEnginePostsPerMinute when the exercise has no loop");
        dto.AutonomousAuthorized.Should().BeFalse();
    }

    // ---- the interim lifecycle gate (AC5) ---------------------------------------------------

    [Fact]
    public async Task InterimGate_BeforeAnyRefresh_FailsClosed()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        await using var scope = harness.Services.CreateAsyncScope();
        var gate = scope.ServiceProvider.GetRequiredService<IEngineLifecyclePublishGate>();

        gate.Should().BeOfType<InterimEngineLifecyclePublishGate>("the interim gate is the registered seam until A5");
        gate.CanPublish(harness.ExerciseId).Should().BeFalse("never refreshed means unknown, which is closed");
    }

    [Theory]
    [InlineData("live", true)]
    [InlineData("active", true)]
    [InlineData("staged", false)]
    [InlineData("paused", false)]
    [InlineData("completed", false)]
    [InlineData("archived", false)]
    [InlineData("build", false)]
    [InlineData("not-a-state", false)]
    public async Task InterimGate_IsOpenOnlyForLive(string status, bool open)
    {
        await using var harness = await AmbientLoopHarness.CreateAsync(status: status);
        await using var scope = harness.Services.CreateAsyncScope();
        var gate = scope.ServiceProvider.GetRequiredService<IEngineLifecyclePublishGate>();

        await gate.RefreshAsync(harness.ExerciseId);

        gate.CanPublish(harness.ExerciseId).Should().Be(open);
    }

    [Fact]
    public async Task InterimGate_ClosesOnFreezeAndPauseEngine_NotPauseInjects()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        await using var scope = harness.Services.CreateAsyncScope();
        var gate = scope.ServiceProvider.GetRequiredService<IEngineLifecyclePublishGate>();
        await gate.RefreshAsync(harness.ExerciseId);

        harness.PauseTiers.Restore(harness.ExerciseId, PauseTier.Injects);
        gate.CanPublish(harness.ExerciseId).Should().BeTrue();

        harness.PauseTiers.Restore(harness.ExerciseId, PauseTier.Engine);
        gate.CanPublish(harness.ExerciseId).Should().BeFalse();

        harness.PauseTiers.Restore(harness.ExerciseId, PauseTier.Running);
        harness.Clock.Freeze(harness.ExerciseId);
        gate.CanPublish(harness.ExerciseId).Should().BeFalse();
    }

    [Fact]
    public async Task InterimGate_ForAnotherExercise_IsClosed()
    {
        await using var harness = await AmbientLoopHarness.CreateAsync();
        await using var scope = harness.Services.CreateAsyncScope();
        var gate = scope.ServiceProvider.GetRequiredService<IEngineLifecyclePublishGate>();
        await gate.RefreshAsync(harness.ExerciseId);

        gate.CanPublish(Guid.NewGuid()).Should().BeFalse("a verdict for exercise A never answers for exercise B (COR-001)");
    }
}
