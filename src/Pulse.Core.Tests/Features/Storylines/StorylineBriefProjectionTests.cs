namespace Pulse.Core.Tests.Features.Storylines;

using FluentAssertions;
using Pulse.Core.Features.Storylines.Models;
using Pulse.Core.Features.Storylines.Services;

public class StorylineBriefProjectionTests
{
    [Fact]
    public void ToBrief_ProjectsTheGenerationFacingState()
    {
        var storyline = Storyline.Create(
            Guid.NewGuid(),
            "Water main contamination fears",
            "County issues a water-safety advisory",
            initialIntensity: 72,
            hashtags: ["#WaterIssues", "#BoilWater"]);
        storyline.Seed(0);

        var brief = storyline.ToBrief();

        brief.Title.Should().Be("Water main contamination fears");
        brief.Expectation.Should().Be("County issues a water-safety advisory");
        brief.Intensity.Should().Be(72);
        brief.Phase.Should().Be("SEEDED");
        brief.Hashtags.Should().Equal("#WaterIssues", "#BoilWater");
        brief.MinutesSinceLastOfficialResponse.Should().Be(0);
    }

    [Theory]
    [InlineData(StorylinePhase.Escalating, "ESCALATING")]
    [InlineData(StorylinePhase.Peak, "PEAK")]
    [InlineData(StorylinePhase.Addressed, "ADDRESSED")]
    [InlineData(StorylinePhase.Resolved, "RESOLVED")]
    public void PhaseLabel_IsUppercase(StorylinePhase phase, string expected)
    {
        StorylineBriefProjection.PhaseLabel(phase).Should().Be(expected);
    }

    [Theory]
    [InlineData(StorylinePhase.Escalating)]
    [InlineData(StorylinePhase.Peak)]
    [InlineData(StorylinePhase.Addressed)]
    [InlineData(StorylinePhase.Decaying)]
    [InlineData(StorylinePhase.Resolved)]
    [InlineData(StorylinePhase.Seeded)]
    [InlineData(StorylinePhase.Dormant)]
    public void ToneMix_AlwaysSumsToOne(StorylinePhase phase)
    {
        var mix = StorylineBriefProjection.ToneMixFor(phase, sentiment: 0.0);
        var sum = mix.Worry + mix.Anger + mix.Speculation + mix.Gratitude + mix.Skepticism + mix.Calm;
        sum.Should().BeApproximately(1.0, 1e-9);
    }

    [Fact]
    public void ToneMix_Escalating_SkewsWorryAngerSpeculation()
    {
        var mix = StorylineBriefProjection.ToneMixFor(StorylinePhase.Escalating, 0.0);
        (mix.Worry + mix.Anger + mix.Speculation).Should().BeGreaterThan(mix.Gratitude + mix.Calm);
    }

    [Fact]
    public void ToneMix_Addressed_SkewsGratitudeCalm_ButKeepsASkeptic()
    {
        var mix = StorylineBriefProjection.ToneMixFor(StorylinePhase.Addressed, 0.0);
        (mix.Gratitude + mix.Calm).Should().BeGreaterThan(mix.Anger);
        mix.Skepticism.Should().BeGreaterThan(0, "the response-reaction mix keeps one skeptic (§7.1)");
    }

    [Fact]
    public void ToneMix_NegativeSentiment_AmplifiesWorryAndAnger()
    {
        var neutral = StorylineBriefProjection.ToneMixFor(StorylinePhase.Escalating, 0.0);
        var angry = StorylineBriefProjection.ToneMixFor(StorylinePhase.Escalating, -1.0);

        angry.Anger.Should().BeGreaterThan(neutral.Anger);
        angry.Worry.Should().BeGreaterThan(neutral.Worry);
    }

    [Fact]
    public void ToneMix_PositiveSentiment_AmplifiesGratitudeAndCalm()
    {
        var neutral = StorylineBriefProjection.ToneMixFor(StorylinePhase.Addressed, 0.0);
        var relieved = StorylineBriefProjection.ToneMixFor(StorylinePhase.Addressed, 1.0);

        relieved.Gratitude.Should().BeGreaterThan(neutral.Gratitude);
        relieved.Calm.Should().BeGreaterThan(neutral.Calm);
    }

    [Fact]
    public void ToBrief_CarriesLiveIntensityPhaseAndSilence_AfterTicking()
    {
        var storyline = Storyline.Create(Guid.NewGuid(), "t", "e", responseWindowMin: 20, initialIntensity: 40);
        storyline.Seed(0);
        storyline.Tick(new FakeScenarioClock(20)); // window opens; escalates without yet hitting the ceiling

        var brief = storyline.ToBrief();

        brief.Phase.Should().Be("ESCALATING");
        brief.Intensity.Should().BeGreaterThan(40);
        brief.MinutesSinceLastOfficialResponse.Should().Be(20);
    }
}
