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

    // ---- D1: fractional rates under per-minute ticks ------------------------------------------------

    [Fact]
    public void Tick_AnchoredPerMinute_StandardRise_AccruesAtTwoPointFivePerMinute_NotTwo()
    {
        // D1 regression: Standard, window 20, the loop ticking every scenario minute. Escalation opens on the
        // minute-20 tick (covering 19→20) and rises through minute 50 — 31 minutes × 2.5 = 77.5 ≈ 78. The
        // pre-fix per-tick Math.Round turned every +2.5 into +2, landing on 62.
        var intensity = 0;
        for (var minute = 20; minute <= 50; minute++)
        {
            intensity = IntensityModel.Tick(intensity, 1, StorylinePhase.Escalating, Standard, fromScenarioMinute: minute - 1);
        }

        intensity.Should().Be(78, "the Standard curve rises 2.5/min (spec ~78 at minute 50), not 2.0/min (62)");
    }

    [Fact]
    public void Tick_AnchoredPerMinute_StandardDecay_AccruesAtTheCurveRate()
    {
        // 10 per-minute decay ticks at 2.0/min = -20, exactly as a single 10-minute step.
        var intensity = 60;
        for (var minute = 1; minute <= 10; minute++)
        {
            intensity = IntensityModel.Tick(intensity, 1, StorylinePhase.Decaying, Standard, fromScenarioMinute: minute - 1);
        }

        intensity.Should().Be(40);
    }

    [Fact]
    public void Tick_AnchoredPerMinute_MatchesASingleAnchoredJump()
    {
        // Tick granularity must not change the trajectory: 1-minute steps telescope to the same value as one
        // jump over the same scenario interval.
        var stepped = 10;
        for (var minute = 7; minute <= 23; minute++)
        {
            stepped = IntensityModel.Tick(stepped, 1, StorylinePhase.Escalating, Standard, fromScenarioMinute: minute - 1);
        }

        var jumped = IntensityModel.Tick(10, 17, StorylinePhase.Escalating, Standard, fromScenarioMinute: 6);

        stepped.Should().Be(jumped);
    }

    [Theory]
    [InlineData(0, 1, 2.0)]   // floor(2.5) - floor(0)
    [InlineData(1, 1, 3.0)]   // floor(5.0) - floor(2.5)
    [InlineData(19, 1, 3.0)]  // floor(50) - floor(47.5)
    [InlineData(0, 20, 50.0)]
    public void CurveStep_Anchored_QuantizesAgainstScenarioTime(int from, int elapsed, double expected)
    {
        IntensityModel.CurveStep(2.5, elapsed, from).Should().Be(expected);
    }

    [Fact]
    public void CurveStep_Unanchored_IsRateTimesElapsed()
    {
        IntensityModel.CurveStep(2.5, 3, fromScenarioMinute: null).Should().Be(7.5);
    }

    [Fact]
    public void CurveStep_AbsorbsFloatingPointError_OnAnExactProduct()
    {
        // 1.4 × 45 is 62.999… in binary floating point; the step must still be 63, not 62.
        IntensityModel.CurveStep(1.4, 45, fromScenarioMinute: 0).Should().Be(63.0);
    }

    // ---- D1 / PR #634 W-004: TickTowardTarget under per-minute anchored ticks --------------------------

    [Fact]
    public void TickTowardTarget_AnchoredPerMinute_RisesTowardTheTargetAtTwoPointFivePerMinute()
    {
        // 20 per-minute ticks on Standard toward a far target: +2.5/min = +50 (pre-fix rounding gave +2/min = +40).
        var intensity = 10;
        for (var minute = 1; minute <= 20; minute++)
        {
            intensity = IntensityModel.TickTowardTarget(intensity, target: 90, 1, Standard, fromScenarioMinute: minute - 1);
        }

        intensity.Should().Be(60, "the dial chase rises at the curve's true 2.5/min");
    }

    [Fact]
    public void TickTowardTarget_AnchoredPerMinute_DecaysTowardTheTargetAtTheSlowBurnRate()
    {
        // Slow burn decays 0.6/min: 20 per-minute ticks = -12 (pre-fix each step rounded to -1, i.e. -20).
        var intensity = 80;
        for (var minute = 1; minute <= 20; minute++)
        {
            intensity = IntensityModel.TickTowardTarget(intensity, target: 20, 1, EscalationCurves.SlowBurn, fromScenarioMinute: minute - 1);
        }

        intensity.Should().Be(68, "a lowered target is approached at the curve's true 0.6/min decay");
    }

    [Theory]
    [InlineData(50, 60)] // rising toward the target
    [InlineData(70, 65)] // decaying toward the target
    public void TickTowardTarget_AnchoredPerMinute_NeverOvershootsTheTarget(int start, int target)
    {
        var intensity = start;
        for (var minute = 1; minute <= 15; minute++)
        {
            intensity = IntensityModel.TickTowardTarget(intensity, target, 1, Standard, fromScenarioMinute: minute - 1);
            if (start < target)
            {
                intensity.Should().BeLessThanOrEqualTo(target, $"minute {minute}: a rise never overshoots the target");
            }
            else
            {
                intensity.Should().BeGreaterThanOrEqualTo(target, $"minute {minute}: a decay never undershoots the target");
            }
        }

        intensity.Should().Be(target, "15 minutes is ample to reach a target this close");
    }
}

