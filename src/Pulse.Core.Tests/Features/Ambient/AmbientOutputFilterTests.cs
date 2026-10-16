namespace Pulse.Core.Tests.Features.Ambient;

using FluentAssertions;
using Pulse.Core.Features.Ambient.Services;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;

/// <summary>
/// ambient-chatter story 01, orchestrator review W-3 / S-2: the output-side "never storyline" check. A pure,
/// deterministic function: fixed incident terms, the active storylines' hashtags and title keywords, and a
/// non-negative sentiment floor.
/// </summary>
public class AmbientOutputFilterTests
{
    private static GeneratedPost Post(string text, double sentiment = 0.3, params string[] hashtags) =>
        new("@p0", text, sentiment, hashtags);

    [Fact]
    public void ACleanEverydayBurst_Passes()
    {
        var failing = AmbientOutputFilter.Inspect(
            [Post("new bakery on main does a great cardamom bun"), Post("soccer team won in overtime", 0.0)],
            AmbientOutputFilter.BuildExclusions(["#WaterIssues"], ["Water main fears"]));

        failing.Should().BeEmpty("nothing here names the incident and both sentiments are calm or warm");
    }

    [Theory]
    [InlineData("Is this an EMERGENCY or not")]
    [InlineData("they said evacuation is coming")]
    [InlineData("power outage on my block again")]
    [InlineData("heard about the contaminated pond")]
    [InlineData("boil-water notice for the east side")]
    [InlineData("boil   water before drinking")]
    [InlineData("why are officials so quiet")]
    [InlineData("dropped donations at the shelter")]
    [InlineData("got a phone alert this morning")]
    [InlineData("weather warning for tonight")]
    [InlineData("a hazmat truck on 5th")]
    public void AFixedIncidentTerm_Fails(string text)
    {
        AmbientOutputFilter.Inspect([Post(text)], []).Should().Equal(AmbientOutputFilter.IncidentTermCheck);
    }

    [Fact]
    public void TheActiveStorylineHashtag_Fails_InTextOrInTheHashtagList_WithOrWithoutTheHash()
    {
        var exclusions = AmbientOutputFilter.BuildExclusions(["#WaterIssues"], []);

        AmbientOutputFilter.Inspect([Post("lovely day #waterissues")], exclusions).Should().NotBeEmpty();
        AmbientOutputFilter.Inspect([Post("lovely day", 0.3, "#WaterIssues")], exclusions).Should().NotBeEmpty();
        AmbientOutputFilter.Inspect([Post("talking about waterissues again")], exclusions).Should().NotBeEmpty();
    }

    [Fact]
    public void AStorylineTitleKeyword_Fails_ButShortAndStopWordsAreNotKeywords()
    {
        var exclusions = AmbientOutputFilter.BuildExclusions([], ["Water-main fears near the treatment plant"]);

        exclusions.Should().Contain(["water", "fears", "treatment", "plant"]);
        exclusions.Should().NotContain(["main", "near", "the"], "words under five letters are too common to be a signal");
        AmbientOutputFilter.Inspect([Post("watered the garden at dawn")], exclusions)
            .Should().Equal([AmbientOutputFilter.IncidentTermCheck], "false positives are accepted: dropping chatter is free");
    }

    [Theory]
    [InlineData(-0.11)]
    [InlineData(-0.6)]
    [InlineData(double.NaN)]
    public void ANegativeSentiment_Fails(double sentiment)
    {
        AmbientOutputFilter.Inspect([Post("nice walk today", 0.5), Post("long line at the cafe", sentiment)], [])
            .Should().Equal(AmbientOutputFilter.SentimentCheck);
    }

    [Theory]
    [InlineData(-0.1)]
    [InlineData(0.0)]
    [InlineData(0.9)]
    public void CalmOrWarmSentiment_Passes(double sentiment)
    {
        AmbientOutputFilter.Inspect([Post("nice walk today", sentiment)], []).Should().BeEmpty();
    }

    [Fact]
    public void BothChecks_AreReportedOnce_AndTheVerdictIsDeterministic()
    {
        IReadOnlyList<GeneratedPost> burst = [Post("officials!", -0.5), Post("alert", -0.9)];

        var first = AmbientOutputFilter.Inspect(burst, []);
        var second = AmbientOutputFilter.Inspect(burst, []);

        first.Should().Equal(AmbientOutputFilter.IncidentTermCheck, AmbientOutputFilter.SentimentCheck);
        second.Should().Equal(first);
    }

    [Fact]
    public async Task TheFakeProvider_AmbientBurst_PassesTheFilter_WhileItsStorylineBurstWouldNot()
    {
        var fake = new FakeGenerationProvider();
        var request = new GenerationRequest
        {
            ExerciseId = Guid.NewGuid(),
            Tier = GenerationTier.Ambient,
            PostCount = 10,
            SystemPrompt = "ambient",
            IsAmbient = true,
        };

        var ambient = await fake.GenerateAsync(request);
        var storyline = await fake.GenerateAsync(request with { IsAmbient = false });

        AmbientOutputFilter.Inspect(ambient.Posts, []).Should().BeEmpty("the offline Fake emits everyday small talk for ambient");
        AmbientOutputFilter.Inspect(storyline.Posts, []).Should().NotBeEmpty("its incident lines are exactly what the filter exists for");
    }
}
