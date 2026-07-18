namespace Pulse.Core.Tests.Features.Storylines;

using FluentAssertions;
using Pulse.Core.Features.Storylines.Models;
using Pulse.Core.Features.Storylines.Services;

public class EscalationCurvesTests
{
    [Fact]
    public void Defaults_ShipSlowBurnStandardAndFlashPanic()
    {
        EscalationCurves.All.Select(c => c.Name)
            .Should().BeEquivalentTo("Slow burn", "Standard", "Flash panic");
    }

    [Fact]
    public void EveryCurve_CarriesFourLegalParameters()
    {
        foreach (var curve in EscalationCurves.All)
        {
            curve.RiseRateUnaddressed.Should().BeGreaterThan(0);
            curve.DecayRateAddressed.Should().BeGreaterThan(0);
            curve.Floor.Should().BeGreaterThanOrEqualTo(0);
            curve.Ceiling.Should().BeLessThanOrEqualTo(100);
            curve.Floor.Should().BeLessThan(curve.Ceiling);
        }
    }

    [Theory]
    [InlineData("Standard")]
    [InlineData("standard")]
    [InlineData("  STANDARD  ")]
    public void CurveFor_IsCaseAndWhitespaceInsensitive(string name)
    {
        EscalationCurves.CurveFor(name).Should().Be(EscalationCurves.Standard);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("no-such-curve")]
    public void CurveFor_UnknownOrBlank_FallsBackToStandard(string? name)
    {
        EscalationCurves.CurveFor(name).Should().Be(EscalationCurves.Standard);
    }

    [Fact]
    public void TryGet_ReportsWhetherNameWasKnown()
    {
        EscalationCurves.TryGet("Flash panic", out var known).Should().BeTrue();
        known.Should().Be(EscalationCurves.FlashPanic);

        EscalationCurves.TryGet("bogus", out var fallback).Should().BeFalse();
        fallback.Should().Be(EscalationCurves.Standard);
    }

    [Fact]
    public void FlashPanic_RisesSteeplyAndDecaysFast_DistinguishablyMoreThanTheOthers()
    {
        // Behavioral, not just config: over the same unaddressed span, Flash panic must climb more than
        // Standard, which climbs more than Slow burn — and its addressed decay must be the fastest.
        EscalationCurves.FlashPanic.RiseRateUnaddressed
            .Should().BeGreaterThan(EscalationCurves.Standard.RiseRateUnaddressed);
        EscalationCurves.Standard.RiseRateUnaddressed
            .Should().BeGreaterThan(EscalationCurves.SlowBurn.RiseRateUnaddressed);

        EscalationCurves.FlashPanic.DecayRateAddressed
            .Should().BeGreaterThan(EscalationCurves.Standard.DecayRateAddressed);
        EscalationCurves.Standard.DecayRateAddressed
            .Should().BeGreaterThan(EscalationCurves.SlowBurn.DecayRateAddressed);
    }

    [Fact]
    public void EscalationCurve_FloorNotBelowCeiling_Throws()
    {
        var act = () => new EscalationCurve("bad", 1, 1, ceiling: 40, floor: 50);
        act.Should().Throw<ArgumentException>();
    }

    [Theory]
    [InlineData(-1.0)]
    public void EscalationCurve_NegativeRate_Throws(double rise)
    {
        var act = () => new EscalationCurve("bad", rise, 1, 90, 10);
        act.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void AssignCurve_ChangesTheCurveLive_AndLogsASteeringAction()
    {
        var storyline = Storyline.Create(Guid.NewGuid(), "t", "e", curveName: "Standard");

        var action = storyline.AssignCurve("Flash panic", scenarioMinute: 42);

        storyline.CurveName.Should().Be("Flash panic");
        action.Kind.Should().Be(SteeringActionKind.CurveChanged);
        action.Detail.Should().Be("Standard → Flash panic");
        action.ScenarioMinute.Should().Be(42);
        action.StorylineId.Should().Be(storyline.Id);
    }

    [Fact]
    public void AssignCurve_BlankName_Throws()
    {
        var storyline = Storyline.Create(Guid.NewGuid(), "t", "e");
        var act = () => storyline.AssignCurve("  ", 1);
        act.Should().Throw<ArgumentException>();
    }
}
