namespace Pulse.Core.Tests.Features.Generation;

using FluentAssertions;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;

public class FakeGenerationProviderTests
{
    private static GenerationRequest Request(int postCount, string systemPrompt = "You are the crowd-simulation engine.") => new()
    {
        ExerciseId = Guid.NewGuid(),
        Tier = GenerationTier.Standard,
        PostCount = postCount,
        SystemPrompt = systemPrompt,
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
    public async Task GenerateAsync_DifferentSystemPrompts_ProduceDifferentLeadPosts()
    {
        // Arrange — two prompts that model the SAME storyline at two moments (worry → anger as the silence
        // deepens). The prompt assembler encodes phase/tone/minutes-since-response, so as the story advances
        // the prompt changes and the burst must lead with a different line (variety the loop needs).
        var provider = new FakeGenerationProvider();

        // Act
        var early = await provider.GenerateAsync(Request(3, "phase=Escalating tone=worry minutesSinceResponse=25"));
        var later = await provider.GenerateAsync(Request(3, "phase=Peak tone=anger minutesSinceResponse=45"));

        // Assert — the lead post text differs across the two prompts (no more identical-line-every-burst).
        later.Posts[0].Text.Should().NotBe(
            early.Posts[0].Text,
            "a changed system prompt (the storyline advancing) must rotate the burst's lead line");
    }

    [Fact]
    public async Task GenerateAsync_SameSystemPrompt_ProducesIdenticalOutput()
    {
        // Arrange — the provider's deterministic, offline contract: same input ⇒ same output (a registered
        // singleton must stay stateless, so no per-instance counter drifts the result between calls).
        var provider = new FakeGenerationProvider();
        const string prompt = "phase=Escalating tone=worry minutesSinceResponse=25";

        // Act
        var first = await provider.GenerateAsync(Request(4, prompt));
        var second = await provider.GenerateAsync(Request(4, prompt));

        // Assert
        second.Posts.Select(p => p.Text).Should().Equal(
            first.Posts.Select(p => p.Text),
            "the same system prompt is deterministic — identical lead line and rotation");
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
