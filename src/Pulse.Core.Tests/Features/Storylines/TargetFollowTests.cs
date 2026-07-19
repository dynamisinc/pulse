namespace Pulse.Core.Tests.Features.Storylines;

using FluentAssertions;
using Pulse.Core.Features.Storylines.Models;
using Pulse.Core.Features.Storylines.Services;

public class TargetFollowTests
{
    // An Escalating storyline seated at a known intensity: DetectActivity opens it without advancing
    // intensity, so the target-follow behavior can be exercised from an exact starting point.
    private static Storyline Escalating(int intensity, int? target)
    {
        var s = Storyline.Create(Guid.NewGuid(), "t", "e", responseWindowMin: 0, initialIntensity: intensity);
        s.Seed(0);
        s.DetectActivity(0);
        if (target is int v)
        {
            s.SetTargetIntensity(v, 0);
        }

        return s;
    }

    // ---- Modulation hint (intentModulation) -----------------------------------------------------

    [Fact]
    public void Modulate_NoTarget_SaysFollowTheCurve()
    {
        var storyline = Escalating(intensity: 40, target: null);

        var modulation = TargetFollow.Modulate(storyline);

        modulation.HasTarget.Should().BeFalse();
        modulation.FollowCurve.Should().BeTrue();
        modulation.Direction.Should().Be(TargetFollowDirection.Hold);
    }

    [Fact]
    public void Modulate_TargetAboveActual_SaysRaise_WithABurstSuggestion()
    {
        var storyline = Escalating(intensity: 40, target: 80);

        var modulation = TargetFollow.Modulate(storyline);

        modulation.Direction.Should().Be(TargetFollowDirection.Raise);
        modulation.Gap.Should().Be(40);
        modulation.SuggestedPostCount.Should().BeGreaterThan(0);
    }

    [Fact]
    public void Modulate_TargetBelowActual_SaysLower_AndTapers()
    {
        var storyline = Escalating(intensity: 80, target: 40);

        var modulation = TargetFollow.Modulate(storyline);

        modulation.Direction.Should().Be(TargetFollowDirection.Lower);
        modulation.SuggestedPostCount.Should().Be(0, "lowering tapers generation rather than adding posts");
    }

    [Fact]
    public void Modulate_WithinDeadband_Holds()
    {
        var storyline = Escalating(intensity: 60, target: 61);

        TargetFollow.Modulate(storyline).Direction.Should().Be(TargetFollowDirection.Hold);
    }

    [Fact]
    public void Modulate_SuggestedPostCount_IsBoundedByTheRateCap()
    {
        var storyline = Escalating(intensity: 0, target: 100); // huge gap -> many posts uncapped
        var tightCap = new RateGovernanceConfig(maxEnginePostsPerMinute: 3, minBelievableActivity: 1);

        var modulation = TargetFollow.Modulate(storyline, tightCap);

        modulation.SuggestedPostCount.Should().BeLessThanOrEqualTo(3, "the follow loop can't request a burst past the cap (ADP-011)");
    }

    // ---- Intensity drive (TickTowardTarget) -----------------------------------------------------

    [Fact]
    public void Tick_WithTargetAboveActual_DrivesUpTowardTarget_WithoutOvershooting()
    {
        var storyline = Escalating(intensity: 40, target: 60);
        var clock = new FakeScenarioClock();

        storyline.Tick(clock.Set(4));  // rises toward 60
        storyline.Intensity.Should().BeGreaterThan(40).And.BeLessThanOrEqualTo(60);

        // Keep ticking; it converges on the target and holds there (no overshoot past 60).
        for (var m = 8; m <= 60; m += 4)
        {
            storyline.Tick(clock.Set(m));
        }

        storyline.Intensity.Should().Be(60);
    }

    [Fact]
    public void Tick_WithTargetBelowActual_DrivesDownTowardTarget()
    {
        var storyline = Escalating(intensity: 90, target: 50);
        var clock = new FakeScenarioClock();

        for (var m = 4; m <= 60; m += 4)
        {
            storyline.Tick(clock.Set(m));
        }

        storyline.Intensity.Should().Be(50);
    }

    [Fact]
    public void Tick_NeverRaisesPastAControllerLoweredTarget_EvenUnderHeavyAmplification()
    {
        var storyline = Escalating(intensity: 50, target: 50);
        var clock = new FakeScenarioClock();
        var signals = new StorylineTickSignals { Amplification = new AmplificationSignal(Velocity: 1.0, AudienceBand: 10) };

        // Actual is at the target; even maximum amplification must not push it above the target.
        for (var m = 2; m <= 40; m += 2)
        {
            storyline.Tick(clock.Set(m), signals);
            storyline.Intensity.Should().BeLessThanOrEqualTo(50, "controller authority over the target is absolute (CTL-022)");
        }
    }

    [Fact]
    public void Tick_NoTarget_FollowsTheCurve()
    {
        var storyline = Storyline.Create(Guid.NewGuid(), "t", "e", responseWindowMin: 10, initialIntensity: 40);
        storyline.Seed(0);

        storyline.Tick(new FakeScenarioClock(10)); // window opens, curve escalates
        storyline.Tick(new FakeScenarioClock(14)); // 4 more min on the curve

        // With no target the curve drives it up unbounded by any target (past where a 40-target would hold).
        storyline.TargetIntensity.Should().BeNull();
        storyline.Intensity.Should().BeGreaterThan(40);
    }

    // ---- Target set/change logging --------------------------------------------------------------

    [Fact]
    public void SetTargetIntensity_LogsASteeringAction()
    {
        var storyline = Storyline.Create(Guid.NewGuid(), "t", "e");

        var action = storyline.SetTargetIntensity(60, scenarioMinute: 12);

        storyline.TargetIntensity.Should().Be(60);
        action.Kind.Should().Be(SteeringActionKind.TargetChanged);
        action.Detail.Should().Be("none → 60");
        action.ScenarioMinute.Should().Be(12);
    }

    [Fact]
    public void SetTargetIntensity_CanBeChangedAndCleared_LiveEachLogged()
    {
        var storyline = Storyline.Create(Guid.NewGuid(), "t", "e");

        storyline.SetTargetIntensity(78, 1);
        var lowered = storyline.SetTargetIntensity(60, 5);
        var cleared = storyline.SetTargetIntensity(null, 9);

        lowered.Detail.Should().Be("78 → 60");
        cleared.Detail.Should().Be("60 → none");
        storyline.TargetIntensity.Should().BeNull();
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(101)]
    public void SetTargetIntensity_OutsideCanonicalScale_Throws(int target)
    {
        var storyline = Storyline.Create(Guid.NewGuid(), "t", "e");
        var act = () => storyline.SetTargetIntensity(target, 1);
        act.Should().Throw<ArgumentOutOfRangeException>();
    }
}
