namespace Pulse.WebApi.Tests.Features.ExerciseConfiguration.Chrome;

using FluentAssertions;
using Pulse.WebApi.Features.ExerciseConfiguration.Chrome;
using Xunit;

/// <summary>
/// The NFR-008 / COR-031 / XC-003 mutual-invariant suite over <see cref="ComplianceChromeGuard"/> — story 02's
/// AC3 ("chrome and watermark are never both off") at its single enforcement point.
/// </summary>
/// <remarks>
/// Pure truth-table assertions over a static function: no database, no host, no Docker. Plain
/// <see cref="FactAttribute"/> / <see cref="TheoryAttribute"/>, deliberately OUTSIDE
/// <c>MsSqlCollection</c> so they run everywhere — joining that collection would construct the container
/// fixture and hard-fail a Docker-less box for tests that touch no SQL at all.
/// </remarks>
public sealed class ComplianceChromeGuardTests
{
    [Theory]
    [InlineData(true, true)]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public void TryValidate_WithAtLeastOneMarkingOn_IsAccepted(bool chromeEnabled, bool watermarkEnabled)
    {
        var accepted = ComplianceChromeGuard.TryValidate(chromeEnabled, watermarkEnabled, out var error);

        accepted.Should().BeTrue(
            "chrome-off is a legal per-exercise state (D7-008) and so is watermark-off — what NFR-008 forbids "
            + "is only the pair that leaves NO marking at all");
        error.Should().BeNull();
    }

    [Fact]
    public void TryValidate_WithBothMarkingsOff_IsRejectedWithAnExplanatoryReason()
    {
        var accepted = ComplianceChromeGuard.TryValidate(
            complianceChromeEnabled: false,
            watermarkEnabled: false,
            out var error);

        accepted.Should().BeFalse("NFR-008: chrome and the in-content watermark are never BOTH off");
        error.Should().Be(
            ComplianceChromeGuard.BothOffMessage,
            "the 400 tells the planner which switch to turn back on, rather than failing mutely");
        error.Should().Contain("NFR-008");
    }

    [Theory]
    [InlineData(true, true, true)]
    [InlineData(true, false, true)]
    [InlineData(false, true, false)]
    public void ResolveEffectiveChromeEnabled_HonoursAStoredPairThatSatisfiesTheInvariant(
        bool storedChrome,
        bool storedWatermark,
        bool expected)
    {
        ComplianceChromeGuard.ResolveEffectiveChromeEnabled(storedChrome, storedWatermark)
            .Should().Be(expected, "a legal stored pair is served exactly as configured — chrome-off included");
    }

    [Fact]
    public void ResolveEffectiveChromeEnabled_WithAStoredPairThatViolatesTheInvariant_ServesChromeVisible()
    {
        // Unreachable through this API (the write path 400s), but reachable by a hand-edited row or a restore
        // from a system predating the guard. The read path applies the SAME invariant so a participant surface
        // is never left with no exercise marking at all.
        ComplianceChromeGuard.ResolveEffectiveChromeEnabled(
            storedComplianceChromeEnabled: false,
            storedWatermarkEnabled: false)
            .Should().BeTrue("an unmarked participant world is the failure NFR-008 exists to prevent");
    }

    [Theory]
    [InlineData(true, true, true)]
    [InlineData(true, false, true)]
    [InlineData(false, true, true)]
    [InlineData(false, false, false)]
    public void IsSatisfied_IsTrueExactlyWhenAtLeastOneMarkingRemains(
        bool chromeEnabled,
        bool watermarkEnabled,
        bool expected)
    {
        ComplianceChromeGuard.IsSatisfied(chromeEnabled, watermarkEnabled).Should().Be(expected);
    }
}
