namespace Pulse.Core.Tests.Features.Generation;

using FluentAssertions;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;

public class TierPolicyTests
{
    private readonly TierPolicy _policy = new();

    [Theory]
    [InlineData(GenerationPurpose.SilenceEscalation)]
    [InlineData(GenerationPurpose.ResponseReaction)]
    [InlineData(GenerationPurpose.ContradictionReaction)]
    [InlineData(GenerationPurpose.RumorContent)]
    public void PickTier_StorylineCriticalPurposes_UseStandard(GenerationPurpose purpose)
    {
        _policy.PickTier(purpose).Should().Be(GenerationTier.Standard);
    }

    [Theory]
    [InlineData(GenerationPurpose.AmbientChatter)]
    [InlineData(GenerationPurpose.Amplification)]
    public void PickTier_BulkPurposes_UseAmbient(GenerationPurpose purpose)
    {
        _policy.PickTier(purpose).Should().Be(GenerationTier.Ambient);
    }

    [Fact]
    public void PickTier_UnknownPurpose_FailsTowardQuality()
    {
        _policy.PickTier((GenerationPurpose)999).Should().Be(GenerationTier.Standard);
    }
}
