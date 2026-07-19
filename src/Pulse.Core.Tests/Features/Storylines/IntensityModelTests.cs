namespace Pulse.Core.Tests.Features.Storylines;

using FluentAssertions;
using Moq;
using Pulse.Core.Features.Storylines.Models;
using Pulse.Core.Features.Storylines.Services;

public class IntensityModelTests
{
    private static readonly EscalationCurve Standard = EscalationCurves.Standard; // rise 2.5, decay 2.0, [5,95]

    [Fact]
    public void Tick_WhileEscalating_RisesByTheCurveRate()
    {
        // 10 min unaddressed at rise 2.5/min = +25.
        var result = IntensityModel.Tick(40, elapsedScenarioMinutes: 10, StorylinePhase.Escalating, Standard);
        result.Should().Be(65);
    }

    [Fact]
    public void Tick_WhileEscalating_ClampsToTheCurveCeiling()
    {
        var result = IntensityModel.Tick(90, elapsedScenarioMinutes: 30, StorylinePhase.Escalating, Standard);
        result.Should().Be(Standard.Ceiling);
    }

    [Fact]
    public void Tick_WhileDecaying_FallsByTheDecayRate_TowardTheFloor()
    {
        // 10 min at decay 2.0/min = -20.
        IntensityModel.Tick(50, 10, StorylinePhase.Decaying, Standard).Should().Be(30);
        // Cannot fall below the curve floor.
        IntensityModel.Tick(10, 30, StorylinePhase.Decaying, Standard).Should().Be(Standard.Floor);
    }

    [Theory]
    [InlineData(StorylinePhase.Dormant)]
    [InlineData(StorylinePhase.Seeded)]
    [InlineData(StorylinePhase.Resolved)]
    public void Tick_InAHoldingPhase_LeavesIntensityUnchanged(StorylinePhase phase)
    {
        IntensityModel.Tick(42, 15, phase, Standard).Should().Be(42);
    }

    [Fact]
    public void Tick_FrozenClock_ZeroElapsed_HoldsIntensity()
    {
        IntensityModel.Tick(70, elapsedScenarioMinutes: 0, StorylinePhase.Escalating, Standard).Should().Be(70);
    }

    [Fact]
    public void Tick_Amplification_BendsIntensityUpAboveTheBareCurve()
    {
        var withoutAmp = IntensityModel.Tick(30, 4, StorylinePhase.Escalating, Standard);
        var amp = new AmplificationSignal(Velocity: 1.0, AudienceBand: 5);
        var withAmp = IntensityModel.Tick(30, 4, StorylinePhase.Escalating, Standard, amp);

        withAmp.Should().BeGreaterThan(withoutAmp, "amplification velocity + audience bend intensity up (SOC-054)");
    }

    [Fact]
    public void Tick_HigherAudienceBand_AmplifiesMore()
    {
        var lowBand = IntensityModel.AmplificationBend(new AmplificationSignal(0.5, 1), elapsedScenarioMinutes: 5);
        var highBand = IntensityModel.AmplificationBend(new AmplificationSignal(0.5, 8), elapsedScenarioMinutes: 5);

        highBand.Should().BeGreaterThan(lowBand);
    }

    [Fact]
    public void AmplificationBend_UsesTheSignalInterface_Mockable()
    {
        // The amplification input is a seam other features (E2 / amplification-engine) implement.
        var signal = new Mock<IAmplificationSignal>();
        signal.SetupGet(s => s.Velocity).Returns(1.0);
        signal.SetupGet(s => s.AudienceBand).Returns(0);

        var bend = IntensityModel.AmplificationBend(signal.Object, elapsedScenarioMinutes: 2);

        // velocity 1.0 * 3.0/min * 2 min * (audience band 0 => x1.0) = 6.0
        bend.Should().BeApproximately(6.0, 1e-9);
        signal.VerifyGet(s => s.Velocity, Times.AtLeastOnce);
    }

    [Fact]
    public void AmplificationBend_NoSignal_IsZero()
    {
        IntensityModel.AmplificationBend(null, 10).Should().Be(0.0);
    }

    [Fact]
    public void Tick_NegativeElapsed_Throws()
    {
        var act = () => IntensityModel.Tick(10, -1, StorylinePhase.Escalating, Standard);
        act.Should().Throw<ArgumentOutOfRangeException>();
    }
}
