namespace Pulse.Core.Tests.Features.Generation;

using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Core.Core.Extensions;
using Pulse.Core.Features.Generation.Services;

/// <summary>
/// Engine-runtime story 07 (engine state survives a restart), slice S1: the startup-only
/// <see cref="IGenerationProviderCutSeed"/> seam on <see cref="GenerationProviderCutRegistry"/>. A seeded cut is a real
/// cut on the same egress decision point (<see cref="GenerationProviderSelector.Resolve"/>), it is per-exercise
/// (COR-001), it only ever adds a cut, and it is NOT a controller transition — <see cref="IGenerationProviderCutRegistry.Cut"/>'s
/// one-audit-event-per-transition contract is unchanged (a later controller Cut reports "already cut"). Docker-free.
/// </summary>
public sealed class GenerationProviderCutSeedTests
{
    [Fact]
    public void Seed_MarksTheExerciseCutToFake_ForThatExerciseOnly()
    {
        var registry = new GenerationProviderCutRegistry();
        var seeded = Guid.NewGuid();
        var other = Guid.NewGuid();

        ((IGenerationProviderCutSeed)registry).Seed(seeded);

        registry.IsCutToFake(seeded).Should().BeTrue("a persisted cut-to-Fake is restored exactly (Q1, row 1)");
        registry.IsCutToFake(other).Should().BeFalse("a restore for one exercise never moves another (COR-001)");
    }

    [Fact]
    public void Seed_IsIdempotent_AndIsNotAControllerTransition()
    {
        var registry = new GenerationProviderCutRegistry();
        var exercise = Guid.NewGuid();
        var seed = (IGenerationProviderCutSeed)registry;

        seed.Seed(exercise);
        seed.Seed(exercise);

        registry.Cut(exercise).Should().BeFalse(
            "the seeded state is already cut, so a controller Cut changes nothing and audits nothing");
        registry.Restore(exercise).Should().BeTrue("only a controller restore-to-live lifts a seeded cut");
        registry.IsCutToFake(exercise).Should().BeFalse();
    }

    [Fact]
    public void Seed_RejectsAnEmptyExercise()
    {
        var act = () => ((IGenerationProviderCutSeed)new GenerationProviderCutRegistry()).Seed(Guid.Empty);
        act.Should().Throw<ArgumentException>("the cut is exercise-scoped (COR-001)");
    }

    [Fact]
    public void Seed_RoutesTheExerciseToFake_ThroughTheSameSelectorEgressDecision()
    {
        var registry = new GenerationProviderCutRegistry();
        var configured = new FakeGenerationProvider();
        var fake = new FakeGenerationProvider();
        var selector = new GenerationProviderSelector(configured, fake, registry);
        var exercise = Guid.NewGuid();

        selector.Resolve(exercise).Should().BeSameAs(configured);
        ((IGenerationProviderCutSeed)registry).Seed(exercise);

        selector.Resolve(exercise).Should().BeSameAs(
            fake, "a restored cut is checked on the same egress decision point as a live one (NFR-005)");
    }

    [Fact]
    public void ThroughAddEngineGeneration_TheRegisteredCutRegistry_ExposesTheSeedSeam()
    {
        var services = new ServiceCollection();
        services.AddEngineGeneration(new ConfigurationBuilder()
            .AddInMemoryCollection([new KeyValuePair<string, string?>("Generation:Provider", "Fake")])
            .Build());
        using var serviceProvider = services.BuildServiceProvider();

        serviceProvider.GetRequiredService<IGenerationProviderCutRegistry>().Should().BeAssignableTo<IGenerationProviderCutSeed>(
            "the rehydrator reaches Seed by pattern-matching the one shared registry instance");
    }
}
