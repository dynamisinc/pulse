namespace Pulse.Core.Tests.Features.ResponseReaction;

using FluentAssertions;
using Pulse.Core.Features.ResponseReaction.Services;

public class ResponseMatchTrustCurveTests
{
    private static void Record(ResponseMatchTrustCurve curve, int correct, int wrong)
    {
        for (var i = 0; i < correct; i++)
        {
            curve.Record(correct: true);
        }

        for (var i = 0; i < wrong; i++)
        {
            curve.Record(correct: false);
        }
    }

    [Fact]
    public void RollingPrecision_ReflectsRecentConfirmations()
    {
        var curve = new ResponseMatchTrustCurve();
        Record(curve, correct: 9, wrong: 1); // 90% over 10

        curve.RollingPrecision(10).Should().BeApproximately(0.9, 1e-9);
        curve.SuggestionCount.Should().Be(10);
    }

    [Fact]
    public void ShouldOfferAutoConfirm_OnlyAfterASustainedWindowOfHighPrecision()
    {
        var curve = new ResponseMatchTrustCurve();

        Record(curve, correct: 3, wrong: 0); // high precision, but too few samples
        curve.ShouldOfferAutoConfirm(precisionThreshold: 0.9, window: 10).Should().BeFalse("not a sustained window yet");

        Record(curve, correct: 7, wrong: 0); // now 10 samples at 100%
        curve.ShouldOfferAutoConfirm(precisionThreshold: 0.9, window: 10).Should().BeTrue();
    }

    [Fact]
    public void TheEngineNeverAutoEnables_OnlyAnExplicitOptInDoes()
    {
        var curve = new ResponseMatchTrustCurve();
        Record(curve, correct: 20, wrong: 0); // sky-high precision

        curve.ShouldOfferAutoConfirm().Should().BeTrue("the console MAY offer it");
        curve.AutoConfirmEnabled.Should().BeFalse("but the engine never enables it itself (§8.2)");

        curve.EnableAutoConfirm(); // the human opts in
        curve.AutoConfirmEnabled.Should().BeTrue();
        curve.ShouldOfferAutoConfirm().Should().BeFalse("already enabled — nothing more to offer");
    }

    [Fact]
    public void LowPrecision_NeverOffersAutoConfirm()
    {
        var curve = new ResponseMatchTrustCurve();
        Record(curve, correct: 5, wrong: 5); // 50% over 10
        curve.ShouldOfferAutoConfirm(precisionThreshold: 0.9, window: 10).Should().BeFalse();
    }
}
