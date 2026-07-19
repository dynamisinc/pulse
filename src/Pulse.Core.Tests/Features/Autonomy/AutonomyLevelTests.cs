namespace Pulse.Core.Tests.Features.Autonomy;

using FluentAssertions;
using Pulse.Core.Features.Autonomy.Models;

public class AutonomyLevelTests
{
    [Fact]
    public void Levels_AscendInAutonomy_SoLowerIsLessAutonomous()
    {
        // The ordering IS the autonomy ordering — the safety controls depend on it (§8.2).
        ((int)AutonomyLevel.Suggest).Should().BeLessThan((int)AutonomyLevel.DelayedAuto);
        ((int)AutonomyLevel.DelayedAuto).Should().BeLessThan((int)AutonomyLevel.Auto);
        AutonomyLevels.Floor.Should().Be(AutonomyLevel.Suggest);
    }

    [Theory]
    [InlineData(AutonomyLevel.Suggest, AutonomyLevel.DelayedAuto, AutonomyLevel.Suggest)]
    [InlineData(AutonomyLevel.DelayedAuto, AutonomyLevel.Suggest, AutonomyLevel.Suggest)]
    [InlineData(AutonomyLevel.DelayedAuto, AutonomyLevel.DelayedAuto, AutonomyLevel.DelayedAuto)]
    [InlineData(AutonomyLevel.Auto, AutonomyLevel.Suggest, AutonomyLevel.Suggest)]
    public void Lower_ReturnsTheLessAutonomousOfTwo(AutonomyLevel a, AutonomyLevel b, AutonomyLevel expected) =>
        AutonomyLevels.Lower(a, b).Should().Be(expected);

    [Fact]
    public void IsRaise_TrueOnlyWhenCandidateIsMoreAutonomous()
    {
        AutonomyLevels.IsRaise(AutonomyLevel.Suggest, AutonomyLevel.DelayedAuto).Should().BeTrue();
        AutonomyLevels.IsRaise(AutonomyLevel.DelayedAuto, AutonomyLevel.Suggest).Should().BeFalse();
        AutonomyLevels.IsRaise(AutonomyLevel.Suggest, AutonomyLevel.Suggest).Should().BeFalse();
    }

    [Theory]
    [InlineData(AutonomyLevel.Suggest)]
    [InlineData(AutonomyLevel.DelayedAuto)]
    public void EnsureSelectable_AllowsTheV1Levels(AutonomyLevel level) =>
        AutonomyLevels.EnsureSelectable(level).Should().Be(level);

    [Fact]
    public void EnsureSelectable_RejectsAuto_AsV1Point1()
    {
        var act = () => AutonomyLevels.EnsureSelectable(AutonomyLevel.Auto);
        act.Should().Throw<NotSupportedException>().WithMessage("*v1.1*");
    }
}
