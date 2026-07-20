namespace Pulse.Core.Tests.Features.ResponseReaction;

using FluentAssertions;
using Pulse.Core.Features.ResponseReaction.Services;
using Pulse.Core.Features.Storylines.Models;

public class ResponseMatcherTests
{
    private static Storyline WaterStoryline() => Storyline.Create(
        Guid.NewGuid(), "Water contamination fears", "the county issues a boil water advisory",
        hashtags: ["#WaterIssues"]);

    [Fact]
    public void Suggest_ScoresAnOnTopicResponse_AboveThreshold()
    {
        var s = WaterStoryline();
        var suggestion = ResponseMatcher.Suggest("The county has issued a boil water advisory for downtown.", s);

        suggestion.StorylineId.Should().Be(s.Id);
        suggestion.Confidence.Should().BeGreaterThan(ResponseMatcher.MatchThreshold);
    }

    [Fact]
    public void Suggest_VerbatimHashtag_IsAStrongSignal()
    {
        ResponseMatcher.Suggest("we hear you #WaterIssues — an advisory is coming", WaterStoryline())
            .Confidence.Should().BeGreaterThanOrEqualTo(0.9);
    }

    [Fact]
    public void Suggest_UnrelatedContent_ScoresLow()
    {
        ResponseMatcher.Suggest("great weather today, enjoying the park with the kids", WaterStoryline())
            .Confidence.Should().BeLessThan(ResponseMatcher.MatchThreshold);
    }

    [Fact]
    public void SuggestBest_PicksTheHigherScoringStoryline()
    {
        var water = WaterStoryline();
        var power = Storyline.Create(Guid.NewGuid(), "Power outage", "the utility restores power", hashtags: ["#PowerOut"]);

        var best = ResponseMatcher.SuggestBest("boil water advisory issued by the county", [power, water]);

        best.Should().NotBeNull();
        best!.Value.StorylineId.Should().Be(water.Id);
    }
}
