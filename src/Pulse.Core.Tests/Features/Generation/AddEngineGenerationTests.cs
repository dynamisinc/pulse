namespace Pulse.Core.Tests.Features.Generation;

using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Core.Core.Extensions;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;

public class AddEngineGenerationTests
{
    private static IConfiguration Config(params (string Key, string? Value)[] values) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(values.Select(v => new KeyValuePair<string, string?>(v.Key, v.Value)))
            .Build();

    [Fact]
    public void WithFakeProvider_ResolvesFakeProvider()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddEngineGeneration(Config(("Generation:Provider", "Fake")));

        // Act
        using var provider = services.BuildServiceProvider();
        var resolved = provider.GetRequiredService<IGenerationProvider>();

        // Assert
        resolved.Should().BeOfType<FakeGenerationProvider>();
        resolved.Name.Should().Be("Fake");
        resolved.Governance.TenantBounded.Should().BeTrue();
    }

    [Fact]
    public void WithNoProviderConfigured_DefaultsToFake()
    {
        // Arrange
        var services = new ServiceCollection();
        services.AddEngineGeneration(Config());

        // Act
        using var provider = services.BuildServiceProvider();

        // Assert
        provider.GetRequiredService<IGenerationProvider>().Should().BeOfType<FakeGenerationProvider>();
    }

    [Fact]
    public void RealProviderFailingGovernance_ThrowsGovernanceError()
    {
        // Arrange
        var services = new ServiceCollection();

        // Act
        var act = () => services.AddEngineGeneration(Config(
            ("Generation:Provider", "AzureOpenAI"),
            ("Generation:Governance:TenantBounded", "false")));

        // Assert — the gate fires before any adapter is constructed
        act.Should().Throw<GenerationConfigurationException>().WithMessage("*governance gate*");
    }

    [Fact]
    public void RealProviderPassingGovernance_ThrowsNotYetWired()
    {
        // Arrange
        var services = new ServiceCollection();

        // Act — governance is satisfied, so the failure is the documented "adapter not wired yet" seam state
        var act = () => services.AddEngineGeneration(Config(
            ("Generation:Provider", "AzureOpenAI"),
            ("Generation:Endpoint", "https://aif-pulse-uat.openai.azure.com/"),
            ("Generation:Governance:TenantBounded", "true"),
            ("Generation:Governance:NoTrainingAttested", "true"),
            ("Generation:Governance:Residency", "centralus"),
            ("Generation:Governance:Retention", "Retained")));

        // Assert
        act.Should().Throw<GenerationConfigurationException>().WithMessage("*not wired yet*");
    }

    [Fact]
    public void UnknownProvider_ThrowsWithValidValues()
    {
        // Arrange
        var services = new ServiceCollection();

        // Act
        var act = () => services.AddEngineGeneration(Config(("Generation:Provider", "Bogus")));

        // Assert
        act.Should().Throw<GenerationConfigurationException>().WithMessage("*Unknown generation provider*");
    }

    [Fact]
    public async Task Consumer_DependsOnlyOnTheInterface_AndCanGenerate()
    {
        // Arrange — a stand-in for the reaction loop: it never sees a concrete provider
        var services = new ServiceCollection();
        services.AddEngineGeneration(Config(("Generation:Provider", "Fake")));
        services.AddTransient<BurstConsumer>();

        using var provider = services.BuildServiceProvider();

        // Act
        var count = await provider.GetRequiredService<BurstConsumer>().CountBurstAsync();

        // Assert
        count.Should().Be(3);
    }

    private sealed class BurstConsumer(IGenerationProvider generationProvider)
    {
        public async Task<int> CountBurstAsync()
        {
            var result = await generationProvider.GenerateAsync(new GenerationRequest
            {
                ExerciseId = Guid.NewGuid(),
                Tier = GenerationTier.Ambient,
                PostCount = 3,
                SystemPrompt = "test",
            });
            return result.Posts.Count;
        }
    }
}
