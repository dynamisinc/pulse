namespace Pulse.Core.Tests.Features.PersonaVoice;

using FluentAssertions;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.PersonaVoice.Models;
using Pulse.Core.Features.PersonaVoice.Services;

public class BurstAcceptancePolicyTests
{
    private static GeneratedPost Post(string handle, string text) => new(handle, text, 0.0, []);

    // Three visibly different voices — distinct vocabulary, structure, and perspective.
    private static readonly IReadOnlyList<GeneratedPost> CleanBurst =
    [
        Post("@mom", "third day without safe tap water on maple street and my kids are asking questions i can't answer"),
        Post("@news", "Developing: county officials have not addressed reports of discoloured water downtown. Statement expected."),
        Post("@skeptic", "funny how the boil-advisory rumour spreads faster than any actual confirmation from anyone official huh"),
    ];

    // Near-identical posts — one authorial voice (the ADP-021 failure).
    private static readonly IReadOnlyList<GeneratedPost> BlendedBurst =
    [
        Post("@a", "the water situation is really concerning and officials need to respond right now"),
        Post("@b", "the water situation is really concerning and officials need to respond right now please"),
        Post("@c", "the water situation is really concerning and officials should respond right now"),
    ];

    private static readonly IReadOnlyDictionary<string, PersonaStyle> NoStyles =
        new Dictionary<string, PersonaStyle>();

    [Fact]
    public void CleanBurst_PassesDiversity()
    {
        var eval = BurstAcceptancePolicy.Evaluate(CleanBurst, NoStyles);
        eval.Passed.Should().BeTrue(because: "distinct voices clear the diversity thresholds");
        eval.FailingChecks.Should().BeEmpty();
    }

    [Fact]
    public void BlendedBurst_FailsDiversity_WithNamedChecks()
    {
        var eval = BurstAcceptancePolicy.Evaluate(BlendedBurst, NoStyles);
        eval.Passed.Should().BeFalse();
        eval.FailingChecks.Should().Contain("pairwise-overlap");
    }

    [Fact]
    public void ADiverseBurst_WithOnePersonaOffItsOwnVoice_FailsConformance()
    {
        // @mom's post is long; give @mom a terse established style so the post drifts off-voice even
        // though the burst as a whole is diverse.
        var styles = new Dictionary<string, PersonaStyle>
        {
            ["@mom"] = new() { AvgLength = 12, EmojiRate = 0, HashtagRate = 0, CapsConvention = "lower" },
        };

        var eval = BurstAcceptancePolicy.Evaluate(CleanBurst, styles);

        eval.Diversity.Passed.Should().BeTrue("the burst is still diverse");
        eval.Passed.Should().BeFalse("but a persona drifted off its own established voice");
        eval.NonConformingPersonas.Should().Contain("@mom");
        eval.FailingChecks.Should().Contain("style-conformance");
    }

    [Fact]
    public void Decide_AcceptsAPassingBurst()
    {
        var eval = BurstAcceptancePolicy.Evaluate(CleanBurst, NoStyles);
        BurstAcceptancePolicy.Decide(eval, attempt: 1).Should().Be(BurstDisposition.Accept);
    }

    [Fact]
    public void Decide_ReRollsWhileAttemptsRemain_ThenDrops()
    {
        var eval = BurstAcceptancePolicy.Evaluate(BlendedBurst, NoStyles);

        BurstAcceptancePolicy.Decide(eval, attempt: 1, maxAttempts: 3).Should().Be(BurstDisposition.ReRoll);
        BurstAcceptancePolicy.Decide(eval, attempt: 2, maxAttempts: 3).Should().Be(BurstDisposition.ReRoll);
        BurstAcceptancePolicy.Decide(eval, attempt: 3, maxAttempts: 3).Should().Be(BurstDisposition.Drop);
    }
}
