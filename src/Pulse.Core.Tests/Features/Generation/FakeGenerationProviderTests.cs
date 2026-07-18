namespace Pulse.Core.Tests.Features.Generation;

using FluentAssertions;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;

public class FakeGenerationProviderTests
{
    private static GenerationRequest Request(int postCount) => new()
    {
        ExerciseId = Guid.NewGuid(),
        Tier = GenerationTier.Standard,
        PostCount = postCount,
        SystemPrompt = "You are the crowd-simulation engine.",
    };

    [Fact]
    public async Task GenerateAsync_ReturnsRequestedNumberOfPosts()
    {
        // Arrange
        var provider = new FakeGenerationProvider();

        // Act
        var result = await provider.GenerateAsync(Request(4));

        // Assert
        result.Posts.Should().HaveCount(4);
        result.ProviderName.Should().Be("Fake");
        result.Model.Should().Be("fake-deterministic");
    }

    [Fact]
    public async Task GenerateAsync_ProducesNonIdenticalPosts()
    {
        // Arrange
        var provider = new FakeGenerationProvider();

        // Act
        var result = await provider.GenerateAsync(Request(5));

        // Assert — distinct handles and text give the diversity metrics real signal to check
        result.Posts.Select(p => p.PersonaHandle).Distinct().Should().HaveCount(5);
        result.Posts.Select(p => p.Text).Distinct().Should().HaveCount(5);
    }

    [Fact]
    public async Task GenerateAsync_IsGovernanceCompliantAndCostsNothing()
    {
        // Arrange
        var provider = new FakeGenerationProvider();

        // Act
        var result = await provider.GenerateAsync(Request(1));

        // Assert
        provider.Governance.TenantBounded.Should().BeTrue();
        provider.Governance.Retention.Should().Be(RetentionPosture.ZeroDataRetention);
        result.Usage.InputTokens.Should().Be(0);
        result.Usage.OutputTokens.Should().Be(0);
    }

    [Fact]
    public async Task GenerateAsync_ExtractsHashtagsFromText()
    {
        // Arrange
        var provider = new FakeGenerationProvider();

        // Act
        var result = await provider.GenerateAsync(Request(5));

        // Assert — at least one canned line carries a hashtag, parsed without trailing punctuation
        result.Posts.SelectMany(p => p.Hashtags).Should().Contain("#WaterIssues");
    }
}
