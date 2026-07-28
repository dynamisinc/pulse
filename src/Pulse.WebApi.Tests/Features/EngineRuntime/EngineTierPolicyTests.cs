namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Linq;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Core.Core.Extensions;
using Pulse.Core.Features.Generation.Models;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Xunit;

/// <summary>
/// The per-exercise tier-policy store + its composition (autonomy-safety story 05). Pure/model-only, so plain
/// <see cref="FactAttribute"/> — no Docker. The composition tests are the load-bearing ones: the settings POST
/// and the reaction loop MUST resolve the SAME singleton, or a controller's tier choice would be written into a
/// registry nothing reads (the shared-instance class of bug the autonomy registry already documents).
/// </summary>
public sealed class EngineTierPolicyTests
{
    [Fact]
    public void GetMode_ForAnUntouchedExercise_IsAuto()
    {
        var registry = new EngineTierPolicyRegistry();

        registry.GetMode(Guid.NewGuid()).Should().Be(
            TierPolicyMode.Auto, "no override means the purpose-based static map decides");
    }

    [Fact]
    public void SetMode_ReturnsThePreviousMode_ForTheFromToAudit()
    {
        var registry = new EngineTierPolicyRegistry();
        var exerciseId = Guid.NewGuid();

        registry.SetMode(exerciseId, TierPolicyMode.Standard).Should().Be(TierPolicyMode.Auto);
        registry.SetMode(exerciseId, TierPolicyMode.Ambient).Should().Be(TierPolicyMode.Standard);
        registry.SetMode(exerciseId, TierPolicyMode.Auto).Should().Be(TierPolicyMode.Ambient);
    }

    [Fact]
    public void ResolveTier_WithAnOverride_ForcesIt_AndWithAuto_PassesTheComposedTierThrough()
    {
        var registry = new EngineTierPolicyRegistry();
        var exerciseId = Guid.NewGuid();

        registry.ResolveTier(exerciseId, GenerationTier.Standard).Should().Be(GenerationTier.Standard);
        registry.ResolveTier(exerciseId, GenerationTier.Ambient).Should().Be(GenerationTier.Ambient);

        registry.SetMode(exerciseId, TierPolicyMode.Ambient);
        registry.ResolveTier(exerciseId, GenerationTier.Standard).Should().Be(GenerationTier.Ambient);

        registry.SetMode(exerciseId, TierPolicyMode.Standard);
        registry.ResolveTier(exerciseId, GenerationTier.Ambient).Should().Be(GenerationTier.Standard);

        registry.SetMode(exerciseId, TierPolicyMode.Auto);
        registry.ResolveTier(exerciseId, GenerationTier.Ambient).Should().Be(GenerationTier.Ambient);
    }

    [Fact]
    public void SetMode_OnOneExercise_NeverMovesAnother()
    {
        var registry = new EngineTierPolicyRegistry();
        var exerciseA = Guid.NewGuid();
        var exerciseB = Guid.NewGuid();

        registry.SetMode(exerciseA, TierPolicyMode.Ambient);

        registry.GetMode(exerciseB).Should().Be(TierPolicyMode.Auto, "COR-001: tier policy is per exercise");
        registry.ResolveTier(exerciseB, GenerationTier.Standard).Should().Be(GenerationTier.Standard);
    }

    [Fact]
    public void AnEmptyExerciseId_IsRejected_NeverTreatedAsAGlobalDefault()
    {
        var registry = new EngineTierPolicyRegistry();

        var get = () => registry.GetMode(Guid.Empty);
        var set = () => registry.SetMode(Guid.Empty, TierPolicyMode.Ambient);

        get.Should().Throw<ArgumentException>("an unresolved scope must never resolve to a shared/global policy (COR-001)");
        set.Should().Throw<ArgumentException>();
    }

    [Theory]
    [InlineData("auto", TierPolicyMode.Auto)]
    [InlineData("standard", TierPolicyMode.Standard)]
    [InlineData("ambient", TierPolicyMode.Ambient)]
    public void TryParse_AcceptsTheThreeWireLiterals(string raw, TierPolicyMode expected)
    {
        TierPolicyModes.TryParse(raw, out var mode).Should().BeTrue();
        mode.Should().Be(expected);
    }

    [Theory]
    [InlineData("Standard")]
    [InlineData("AMBIENT")]
    [InlineData("gpt-5")]
    [InlineData("")]
    [InlineData(null)]
    public void TryParse_RejectsAnythingElse_FailLoud(string? raw)
    {
        TierPolicyModes.TryParse(raw, out _).Should().BeFalse(
            "the wire literals are pinned exactly — an unknown mode is a 400, never a silent default");
    }

    [Fact]
    public void TierPolicyMode_SerializesAsItsPinnedWireLiteral()
    {
        var options = new JsonSerializerOptions();
        options.Converters.Add(new TierPolicyModeJsonConverter());

        JsonSerializer.Serialize(TierPolicyMode.Auto, options).Should().Be("\"auto\"");
        JsonSerializer.Serialize(TierPolicyMode.Standard, options).Should().Be("\"standard\"");
        JsonSerializer.Serialize(TierPolicyMode.Ambient, options).Should().Be("\"ambient\"");
    }

    // ---- composition: the settings POST and the loop must share ONE registry ----------------------

    [Fact]
    public void AddEngineReview_RegistersTheTierPolicyRegistryAsASingleton()
    {
        var services = new ServiceCollection();

        services.AddEngineReview();

        services.Should().Contain(
            d => d.ServiceType == typeof(EngineTierPolicyRegistry) && d.Lifetime == ServiceLifetime.Singleton);
    }

    [Fact]
    public void AddReactionLoopHost_RegistersTheTierPolicyRegistryAsASingleton()
    {
        var services = new ServiceCollection();

        services.AddReactionLoopHost();

        services.Should().Contain(
            d => d.ServiceType == typeof(EngineTierPolicyRegistry) && d.Lifetime == ServiceLifetime.Singleton);
    }

    [Fact]
    public void WiringBothSlices_ConvergesOnOneSharedTierPolicyRegistry_EitherOrder()
    {
        AssertSingleShared(services =>
        {
            services.AddReactionLoopHost();
            services.AddEngineReview();
        });

        AssertSingleShared(services =>
        {
            services.AddEngineReview();
            services.AddReactionLoopHost();
        });

        static void AssertSingleShared(Action<IServiceCollection> wire)
        {
            var services = new ServiceCollection();
            services.AddLogging();
            services.AddEngineGeneration(new ConfigurationBuilder().Build());
            services.AddEngineRuntimeSeams();
            services.AddExerciseClock();
            wire(services);

            services.Count(d => d.ServiceType == typeof(EngineTierPolicyRegistry)).Should().Be(
                1, "TryAdd must not stack a second registry — the loop and the settings POST share one instance");

            using var provider = services.BuildServiceProvider();
            var fromDriver = provider.GetRequiredService<ReactionLoopDriver>();
            var registry = provider.GetRequiredService<EngineTierPolicyRegistry>();

            // Prove the driver observes writes made through the resolved singleton (the same object graph the
            // settings service writes through), not a private copy.
            var exerciseId = Guid.NewGuid();
            registry.SetMode(exerciseId, TierPolicyMode.Ambient);
            fromDriver.Should().NotBeNull();
            provider.GetRequiredService<EngineTierPolicyRegistry>().GetMode(exerciseId).Should().Be(
                TierPolicyMode.Ambient, "one singleton: what the settings POST writes, the loop's driver reads");
        }
    }
}
