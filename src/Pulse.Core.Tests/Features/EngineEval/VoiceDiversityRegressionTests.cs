namespace Pulse.Core.Tests.Features.EngineEval;

using FluentAssertions;
using Pulse.Core.Features.EngineEval;

/// <summary>
/// The maintained voice-diversity &amp; fidelity regression gate (ADP-021, §12.1). Runs the shared
/// believable+diverse metric over a labeled corpus; the gate must classify each case as expected (clean
/// passes, blended/off-voice fail), and a prompt/model change that flattens the crowd voice would surface
/// here as a regression.
/// </summary>
public class VoiceDiversityRegressionTests
{
    public static TheoryData<VoiceDiversityCase> Corpus()
    {
        var data = new TheoryData<VoiceDiversityCase>();
        foreach (var c in VoiceDiversityRegression.Corpus)
        {
            data.Add(c);
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(Corpus))]
    public void EveryCase_ScoresAsExpected(VoiceDiversityCase testCase)
    {
        VoiceDiversityRegression.Run(testCase).AsExpected
            .Should().BeTrue($"'{testCase.Name}' must score {(testCase.ExpectedPass ? "pass" : "fail")}");
    }

    [Fact]
    public void TheCorpus_CoversBothOutcomes_SoTheGateIsReal()
    {
        VoiceDiversityRegression.Corpus.Should().Contain(c => c.ExpectedPass)
            .And.Contain(c => !c.ExpectedPass, "a gate that only ever passes proves nothing");
    }

    [Fact]
    public void RunAll_HasNoRegressions_OnTheBaselineCorpus()
    {
        VoiceDiversityRegression.RunAll().Should().OnlyContain(r => r.AsExpected);
    }

    [Fact]
    public void ABlendedBurst_FailsOnPairwiseOverlap_TheConvergenceFailureMode()
    {
        var blended = VoiceDiversityRegression.Corpus.Single(c => c.Name == "blended/one-authorial-voice");
        var result = VoiceDiversityRegression.Run(blended);

        result.Evaluation.Passed.Should().BeFalse();
        result.Evaluation.FailingChecks.Should().Contain("pairwise-overlap");
    }

    [Fact]
    public void AnOffVoiceBurst_FailsOnStyleConformance_EvenThoughItIsDiverse()
    {
        var offVoice = VoiceDiversityRegression.Corpus.Single(c => c.Name == "off-voice/persona-drift");
        var result = VoiceDiversityRegression.Run(offVoice);

        result.Evaluation.Diversity.Passed.Should().BeTrue("the burst is diverse");
        result.Evaluation.Passed.Should().BeFalse("but a persona drifted off its own voice");
        result.Evaluation.FailingChecks.Should().Contain("style-conformance");
    }

    [Fact]
    public void ProxyTracksHumans_WhenPassRatesAgree_WithinTolerance()
    {
        var panel = new HumanSpotCheck(SampleSize: 20, BelievabilityPassRate: 0.85);
        VoiceDiversityRegression.ProxyTracksHumans(proxyPassRate: 0.80, panel).Should().BeTrue();
        VoiceDiversityRegression.ProxyTracksHumans(proxyPassRate: 0.40, panel).Should().BeFalse("a large divergence means the thresholds have drifted");
    }

    [Theory]
    [InlineData(1.5, 0.8, 0.2)]    // proxy rate > 1
    [InlineData(0.8, 1.5, 0.2)]    // panel rate > 1
    [InlineData(0.8, 0.8, -0.1)]   // negative tolerance
    [InlineData(double.NaN, 0.8, 0.2)]
    public void ProxyTracksHumans_RejectsOutOfRangeInputs(double proxyRate, double panelRate, double tolerance)
    {
        var panel = new HumanSpotCheck(20, panelRate);
        var act = () => VoiceDiversityRegression.ProxyTracksHumans(proxyRate, panel, tolerance);
        act.Should().Throw<ArgumentOutOfRangeException>();
    }
}
