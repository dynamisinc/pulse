namespace Pulse.Core.Tests.Features.EngineEval;

using FluentAssertions;
using Pulse.Core.Features.EngineEval;
using Pulse.Core.Features.Generation.Models;

public class VoiceMetricsTests
{
    private static GeneratedPost P(string handle, string text) => new(handle, text, 0, []);

    // Four distinct human voices — the harness must pass this.
    private static readonly List<GeneratedPost> CleanBurst =
    [
        P("@ana", "the tap water smells strange this morning over near oak street"),
        P("@ben", "why has nobody from city hall said anything about our pipes yet"),
        P("@cid", "kids were told to avoid the school drinking fountains today, unsettling"),
        P("@dot", "please everyone stay calm and wait for an official notice before panicking"),
    ];

    // Near-identical posts — the ADP-021 failure the harness must catch.
    private static readonly List<GeneratedPost> BlendedBurst =
    [
        P("@ana", "the water is contaminated and everyone should be very worried right now"),
        P("@ben", "the water is contaminated and everyone should be very worried right now today"),
        P("@cid", "the water is contaminated and everyone should be very worried right now indeed"),
    ];

    [Fact]
    public void Evaluate_CleanBurst_Passes()
    {
        VoiceMetrics.Evaluate(CleanBurst).Passed.Should().BeTrue();
    }

    [Fact]
    public void Evaluate_BlendedBurst_Fails()
    {
        VoiceMetrics.Evaluate(BlendedBurst).Passed.Should().BeFalse();
    }

    [Fact]
    public void MaxPairwiseOverlap_FlagsNearDuplicatesOverThreshold()
    {
        var overlap = VoiceMetrics.MaxPairwiseOverlap(BlendedBurst);

        overlap.MaxOverlap.Should().BeGreaterThan(0.2);
        overlap.PersonaA.Should().NotBeNull();
    }

    [Fact]
    public void PersonaDistinctiveness_LowerForBlendedThanClean()
    {
        VoiceMetrics.PersonaDistinctiveness(BlendedBurst)
            .Should().BeLessThan(VoiceMetrics.PersonaDistinctiveness(CleanBurst));
    }
}
