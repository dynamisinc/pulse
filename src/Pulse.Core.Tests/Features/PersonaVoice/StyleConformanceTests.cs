namespace Pulse.Core.Tests.Features.PersonaVoice;

using FluentAssertions;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.PersonaVoice.Services;

public class StyleConformanceTests
{
    // A terse, plain, lowercase persona: ~40 chars, no emoji, no hashtags.
    private static readonly PersonaStyle Terse = new()
    {
        AvgLength = 40,
        EmojiRate = 0,
        HashtagRate = 0,
        CapsConvention = "lower",
    };

    [Fact]
    public void AConformingPost_Passes()
    {
        var result = StyleConformance.Check("still no water on maple street, this is rough", Terse);
        result.Conforms.Should().BeTrue();
        result.FailedDimensions.Should().BeEmpty();
    }

    [Fact]
    public void AMuchLongerPost_FailsOnLength()
    {
        var longPost = string.Join(' ', Enumerable.Repeat("the water situation keeps getting worse downtown", 6));
        var result = StyleConformance.Check(longPost, Terse);
        result.Conforms.Should().BeFalse();
        result.FailedDimensions.Should().Contain("length");
    }

    [Fact]
    public void SuddenEmojiSpray_FailsOnEmoji()
    {
        var result = StyleConformance.Check("no water again 😡😭😤🚱💧😱", Terse);
        result.Conforms.Should().BeFalse();
        result.FailedDimensions.Should().Contain("emoji");
    }

    [Fact]
    public void ShoutingWhenTheStyleIsLower_FailsOnCaps()
    {
        var result = StyleConformance.Check("WHY IS NOBODY ANSWERING ABOUT THE WATER", Terse);
        result.Conforms.Should().BeFalse();
        result.FailedDimensions.Should().Contain("caps");
    }

    [Fact]
    public void ANormalCasedPost_IsCompatibleWithAnyConvention()
    {
        // "normal" is the unmarked case — it never trips the caps check regardless of the style's convention.
        var shouty = Terse with { CapsConvention = "SHOUTY" };
        StyleConformance.Check("Still nothing from the County on this", shouty)
            .FailedDimensions.Should().NotContain("caps");
    }
}
