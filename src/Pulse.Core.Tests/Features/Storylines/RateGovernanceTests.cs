namespace Pulse.Core.Tests.Features.Storylines;

using FluentAssertions;
using Pulse.Core.Features.Storylines.Models;
using Pulse.Core.Features.Storylines.Services;

public class RateGovernanceTests
{
    private static readonly RateGovernanceConfig Config = new(maxEnginePostsPerMinute: 10, minBelievableActivity: 3);

    [Fact]
    public void Default_IsSizedAgainstNfr002()
    {
        RateGovernanceConfig.Default.MaxEnginePostsPerMinute.Should().Be(60);
        RateGovernanceConfig.Default.MinBelievableActivity.Should().BeGreaterThan(0);
        RateGovernanceConfig.Default.MinBelievableActivity
            .Should().BeLessThan(RateGovernanceConfig.Default.MaxEnginePostsPerMinute);
    }

    [Fact]
    public void Default_InheritsTheReactionCadenceDefault()
    {
        // The static Default is built via the 2-arg ctor; the init-only property's initializer still applies,
        // so the per-storyline escalation cadence defaults to 3 scenario minutes (ADP-011).
        RateGovernanceConfig.Default.MinMinutesBetweenInactionReactions.Should().Be(3);
    }

    [Theory]
    [InlineData(-1, 0)]
    [InlineData(-100, 0)]
    [InlineData(0, 0)]
    [InlineData(5, 5)]
    public void ReactionCadence_ClampsNegativeToZero(int provided, int expected)
    {
        // The cadence never stores a negative value (consistent with the other non-negative rate-governance
        // fields); a negative clamps to 0 = the "cadence gate disabled" sentinel.
        var config = RateGovernanceConfig.Default with { MinMinutesBetweenInactionReactions = provided };
        config.MinMinutesBetweenInactionReactions.Should().Be(expected);
    }

    [Fact]
    public void Config_FloorAboveCap_Throws()
    {
        var act = () => new RateGovernanceConfig(maxEnginePostsPerMinute: 5, minBelievableActivity: 6);
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void WithinCap_UnderTheCeiling_AllowsTheWholeRequest()
    {
        var decision = RateGovernance.WithinCap(Config, postsThisMinute: 2, requestedCount: 5);

        decision.Allowed.Should().Be(5);
        decision.Throttled.Should().Be(0);
        decision.WasThrottled.Should().BeFalse();
    }

    [Fact]
    public void WithinCap_OverTheCeiling_ThrottlesTheOverflow()
    {
        // 8 already this minute, cap 10 -> only 2 more may publish; a burst of 5 is trimmed to 2.
        var decision = RateGovernance.WithinCap(Config, postsThisMinute: 8, requestedCount: 5);

        decision.Allowed.Should().Be(2);
        decision.Throttled.Should().Be(3);
        decision.WasThrottled.Should().BeTrue();
    }

    [Fact]
    public void WithinCap_AlreadyAtTheCeiling_AllowsNothing()
    {
        var decision = RateGovernance.WithinCap(Config, postsThisMinute: 10, requestedCount: 4);

        decision.Allowed.Should().Be(0);
        decision.Throttled.Should().Be(4);
    }

    [Theory]
    [InlineData(0, true)]
    [InlineData(2, true)]
    [InlineData(3, false)]
    [InlineData(9, false)]
    public void BelowFloor_TrueOnlyWhenUnderMinBelievableActivity(int postsThisMinute, bool expected)
    {
        RateGovernance.BelowFloor(Config, postsThisMinute).Should().Be(expected);
    }

    [Theory]
    [InlineData(0, 3)]
    [InlineData(1, 2)]
    [InlineData(3, 0)]
    [InlineData(5, 0)]
    public void AmbientDeficit_IsHowManyPostsShortOfTheFloor(int postsThisMinute, int expectedDeficit)
    {
        RateGovernance.AmbientDeficit(Config, postsThisMinute).Should().Be(expectedDeficit);
    }

    [Fact]
    public void ExerciseRateGovernor_Update_TakesEffectLive_AndLogsTheChange()
    {
        var exercise = Guid.NewGuid();
        var governor = new ExerciseRateGovernor(exercise); // default cap 60

        // Before: a 40-post burst fits under the default cap.
        governor.WithinCap(postsThisMinute: 0, requestedCount: 40).WasThrottled.Should().BeFalse();

        var change = governor.Update(new RateGovernanceConfig(20, 6), scenarioMinute: 15);

        // After: the same burst is now throttled by the lowered cap — the change took effect live.
        governor.Current.MaxEnginePostsPerMinute.Should().Be(20);
        governor.WithinCap(postsThisMinute: 0, requestedCount: 40).Allowed.Should().Be(20);

        change.ExerciseId.Should().Be(exercise);
        change.From.MaxEnginePostsPerMinute.Should().Be(60);
        change.To.MaxEnginePostsPerMinute.Should().Be(20);
        change.ScenarioMinute.Should().Be(15);
    }

    [Fact]
    public void ExerciseRateGovernor_BelowFloor_DrivesAmbientDeficit()
    {
        var governor = new ExerciseRateGovernor(Guid.NewGuid(), new RateGovernanceConfig(30, 8));

        governor.BelowFloor(postsThisMinute: 5).Should().BeTrue();
        governor.AmbientDeficit(postsThisMinute: 5).Should().Be(3);
        governor.BelowFloor(postsThisMinute: 8).Should().BeFalse();
    }
}
