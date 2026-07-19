namespace Pulse.Core.Tests.Features.Autonomy;

using FluentAssertions;
using Pulse.Core.Features.Autonomy.Services;

public class DemandAccountingTests
{
    [Fact]
    public void BurstLevelReview_MakesAnNPostBurstOneDecision_NotN()
    {
        DemandAccounting.PerPostReviewDemand(12).Should().Be(12, "the rejected per-post baseline scales with N");
        DemandAccounting.BurstReviewDemand(12).Should().Be(1, "batch approve: one burst = one decision (ADP-040)");
        DemandAccounting.BurstReviewDemand(0).Should().Be(0);
    }

    [Fact]
    public void PreFiltering_MeansGuardFailingBurstsNeverReachTheQueue_ZeroDemand()
    {
        DemandAccounting.ReviewDemand(guardPassed: false, postCount: 12).Should().Be(0);
        DemandAccounting.ReviewDemand(guardPassed: true, postCount: 12).Should().Be(1);
    }

    [Fact]
    public void StorylineLevelAutonomy_CostsNoPerBurstDecision()
    {
        DemandAccounting.StorylineLevelAutonomyDemand.Should().Be(0);
        DemandAccounting.StorylineLevelAutonomyDemand
            .Should().BeLessThan(DemandAccounting.PerBurstAutonomyDemand, "set once per storyline, not per burst");
    }

    [Fact]
    public void MatchSuggestion_IsOneKey_AndAutoConfirmRetiresEvenThat()
    {
        DemandAccounting.MatchPromptDemand(autoConfirmEarned: false).Should().Be(1);
        DemandAccounting.MatchPromptDemand(autoConfirmEarned: true).Should().Be(0);
        DemandAccounting.MatchPromptDemand(false)
            .Should().BeLessThan(DemandAccounting.ManualMatchDemand, "suggestion beats manual matching");
    }

    [Fact]
    public void TheReducingDesign_DemandsFarLessThanTheNaiveDesign()
    {
        // A 20-post response-match burst under NFR-002 load.
        var reduced = DemandAccounting.ReducedBurstDemand(postCount: 20, isResponseMatch: true, autoConfirmEarned: false);
        var naive = DemandAccounting.NaiveBurstDemand(postCount: 20, isResponseMatch: true);

        reduced.Should().Be(2, "one batch review + one match confirmation; autonomy set at storyline level");
        naive.Should().Be(23, "20 per-post reviews + a per-burst autonomy prompt + manual matching");
        reduced.Should().BeLessThan(naive);
    }

    [Fact]
    public void WithAutoConfirmEarned_AResponseMatchBurstIsASingleDecision()
    {
        DemandAccounting.ReducedBurstDemand(postCount: 20, isResponseMatch: true, autoConfirmEarned: true)
            .Should().Be(1, "the trust curve retires the match prompt; only the batch review remains");
    }
}
