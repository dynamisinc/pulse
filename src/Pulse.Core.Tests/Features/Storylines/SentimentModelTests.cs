namespace Pulse.Core.Tests.Features.Storylines;

using FluentAssertions;
using Moq;
using Pulse.Core.Features.Storylines.Models;
using Pulse.Core.Features.Storylines.Services;

public class SentimentModelTests
{
    [Fact]
    public void EngineBaseline_HotEscalatingConcern_ReadsNegative()
    {
        SentimentModel.EngineBaseline(StorylinePhase.Escalating, 80).Should().BeNegative();
        SentimentModel.EngineBaseline(StorylinePhase.Peak, 100).Should().Be(-1.0);
    }

    [Fact]
    public void EngineBaseline_AddressedConcern_RecoversTowardPositiveAsIntensityFalls()
    {
        var hot = SentimentModel.EngineBaseline(StorylinePhase.Addressed, 80);
        var cooled = SentimentModel.EngineBaseline(StorylinePhase.Decaying, 10);

        hot.Should().BeGreaterThanOrEqualTo(0);
        cooled.Should().BeGreaterThan(hot, "as an addressed concern's intensity falls, mood recovers");
    }

    [Theory]
    [InlineData(StorylinePhase.Dormant)]
    [InlineData(StorylinePhase.Seeded)]
    public void EngineBaseline_InactivePhases_AreNeutral(StorylinePhase phase)
    {
        SentimentModel.EngineBaseline(phase, 40).Should().Be(0.0);
    }

    [Fact]
    public void Compute_NoSignals_IsTheEngineBaselineAlone()
    {
        var baseline = SentimentModel.EngineBaseline(StorylinePhase.Escalating, 60);
        SentimentModel.Compute(StorylinePhase.Escalating, 60).Should().BeApproximately(baseline, 1e-9);
    }

    [Fact]
    public void Compute_NegativeReactions_PullSentimentDown()
    {
        var withoutReactions = SentimentModel.Compute(StorylinePhase.Escalating, 40);
        var withAngryReactions = SentimentModel.Compute(
            StorylinePhase.Escalating, 40, new ReactionSignal(NetSentiment: -1.0, SampleCount: 100));

        withAngryReactions.Should().BeLessThan(withoutReactions);
    }

    [Fact]
    public void Compute_ReactionWeight_ScalesWithSampleCount()
    {
        // A single reaction barely moves sentiment; many reactions move it much more.
        var baseline = SentimentModel.Compute(StorylinePhase.Seeded, 0); // 0.0
        var fewSamples = SentimentModel.Compute(StorylinePhase.Seeded, 0, new ReactionSignal(1.0, 1));
        var manySamples = SentimentModel.Compute(StorylinePhase.Seeded, 0, new ReactionSignal(1.0, 100));

        fewSamples.Should().BeGreaterThan(baseline);
        manySamples.Should().BeGreaterThan(fewSamples);
    }

    [Fact]
    public void Compute_ReactionSignal_IsMockable()
    {
        var reactions = new Mock<IReactionSignal>();
        reactions.SetupGet(r => r.NetSentiment).Returns(0.8);
        reactions.SetupGet(r => r.SampleCount).Returns(50);

        var result = SentimentModel.Compute(StorylinePhase.Decaying, 10, reactions.Object);

        result.Should().BePositive();
    }

    [Fact]
    public void Compute_ContentPass_ShiftsSentiment()
    {
        var withoutContent = SentimentModel.Compute(StorylinePhase.Seeded, 0);
        var withNegativeContent = SentimentModel.Compute(StorylinePhase.Seeded, 0, contentSentiment: -1.0);

        withNegativeContent.Should().BeLessThan(withoutContent);
    }

    [Fact]
    public void Compute_StaysWithinBounds()
    {
        var result = SentimentModel.Compute(
            StorylinePhase.Peak, 100, new ReactionSignal(-1.0, 1000), contentSentiment: -1.0);
        result.Should().BeGreaterThanOrEqualTo(-1.0).And.BeLessThanOrEqualTo(1.0);
    }

    [Fact]
    public void Aggregate_IsIntensityWeighted_LouderConcernsDominate()
    {
        var exercise = Guid.NewGuid();
        var loudNegative = Storyline.Create(exercise, "loud", "e", initialIntensity: 90, initialSentiment: -0.8);
        var quietPositive = Storyline.Create(exercise, "quiet", "e", initialIntensity: 10, initialSentiment: 0.8);

        var aggregate = SentimentModel.Aggregate([loudNegative, quietPositive]);

        aggregate.Should().BeNegative("the loud concern (intensity 90) should dominate the exercise mood");
    }

    [Fact]
    public void Aggregate_NoIntensity_IsNeutral()
    {
        var exercise = Guid.NewGuid();
        var s = Storyline.Create(exercise, "t", "e", initialIntensity: 0, initialSentiment: -0.9);
        SentimentModel.Aggregate([s]).Should().Be(0.0);
    }

    [Fact]
    public void Aggregate_Empty_IsNeutral()
    {
        SentimentModel.Aggregate([]).Should().Be(0.0);
    }
}
