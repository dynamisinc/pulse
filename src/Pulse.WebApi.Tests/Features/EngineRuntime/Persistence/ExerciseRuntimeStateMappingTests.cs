namespace Pulse.WebApi.Tests.Features.EngineRuntime.Persistence;

using System;
using FluentAssertions;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Persistence;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Xunit;

/// <summary>
/// demo-feedback story 18: the row translation and its invariants in code — the all-null-or-all-set clock rule
/// (17 Gate-1 L-3) on the way out, and refusal (never half-restore) of any row that breaks a rule on the way back in
/// (AC-6). Model-only.
/// </summary>
public sealed class ExerciseRuntimeStateMappingTests
{
    private static readonly DateTimeOffset WallNow = new(2026, 10, 15, 14, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset ScenarioStart = new(2026, 3, 1, 8, 0, 0, TimeSpan.FromHours(-6));

    [Fact]
    public void CopyTo_ThenTryParse_RoundTripsEveryField()
    {
        var exerciseId = Guid.NewGuid();
        var chicago = TimeZoneInfo.FindSystemTimeZoneById("America/Chicago");
        var snapshot = new ExerciseRuntimeStateSnapshot(
            exerciseId,
            PauseTier.Freeze,
            new ExerciseClockAnchor(ScenarioStart, chicago, TimeSpan.FromMinutes(17.5), WallNow, Frozen: true),
            new OverlayStateSnapshot(OverlayStateWire.Pause, OverlayStateWire.OutOfFiction, string.Empty, 7));
        var row = new ExerciseRuntimeState { ExerciseId = exerciseId };

        ExerciseRuntimeStateMapping.CopyTo(snapshot, row, WallNow);

        row.PauseTier.Should().Be("freeze");
        row.ClockScenarioStart.Should().Be(ScenarioStart);
        row.ClockTimeZone.Should().Be(chicago.Id);
        row.ClockElapsedAtAnchorTicks.Should().Be(TimeSpan.FromMinutes(17.5).Ticks);
        row.ClockWallAnchorUtc.Should().Be(WallNow);
        row.ClockFrozen.Should().BeTrue();
        row.OverlayState.Should().Be("pause");
        row.OverlayRegister.Should().Be("out-of-fiction");
        row.OverlayMessage.Should().BeNull("an empty message is stored as null");
        row.OverlaySequence.Should().Be(7);
        row.UpdatedAt.Should().Be(WallNow);

        ExerciseRuntimeStateMapping.TryParse(row, out var parsed, out var reason).Should().BeTrue(reason);
        parsed!.Tier.Should().Be(PauseTier.Freeze);
        parsed.Clock.Should().NotBeNull();
        parsed.Clock!.ElapsedAtAnchor.Should().Be(TimeSpan.FromMinutes(17.5));
        parsed.Clock.TimeZone.Id.Should().Be(chicago.Id);
        parsed.Clock.Frozen.Should().BeTrue();
        parsed.Overlay.Should().Be(new OverlayStateSnapshot("pause", "out-of-fiction", string.Empty, 7));
    }

    [Fact]
    public void CopyTo_AnUnstartedClock_WritesAllFourClockColumnsNull_L3()
    {
        var exerciseId = Guid.NewGuid();
        var row = new ExerciseRuntimeState
        {
            ExerciseId = exerciseId,
            ClockScenarioStart = ScenarioStart,
            ClockTimeZone = "UTC",
            ClockElapsedAtAnchorTicks = 5,
            ClockWallAnchorUtc = WallNow,
            ClockFrozen = true,
        };

        ExerciseRuntimeStateMapping.CopyTo(
            new ExerciseRuntimeStateSnapshot(exerciseId, PauseTier.Engine, null, OverlayStateService.Cleared), row, WallNow);

        row.ClockScenarioStart.Should().BeNull();
        row.ClockTimeZone.Should().BeNull();
        row.ClockElapsedAtAnchorTicks.Should().BeNull();
        row.ClockWallAnchorUtc.Should().BeNull();
        row.ClockFrozen.Should().BeFalse();
    }

    [Fact]
    public void CopyTo_RefusesAnotherExercisesRow()
    {
        var act = () => ExerciseRuntimeStateMapping.CopyTo(
            new ExerciseRuntimeStateSnapshot(Guid.NewGuid(), PauseTier.Running, null, OverlayStateService.Cleared),
            new ExerciseRuntimeState { ExerciseId = Guid.NewGuid() },
            WallNow);

        act.Should().Throw<ArgumentException>("a snapshot is only ever written onto its own exercise's row (COR-001)");
    }

    [Theory]
    [InlineData(true, false, false, false)]
    [InlineData(true, true, true, false)]
    [InlineData(false, false, false, true)]
    [InlineData(false, true, true, true)]
    public void TryParse_RefusesPartlySetClockColumns_L3(bool start, bool zone, bool elapsed, bool wall)
    {
        var row = ValidRow();
        row.ClockScenarioStart = start ? ScenarioStart : null;
        row.ClockTimeZone = zone ? "UTC" : null;
        row.ClockElapsedAtAnchorTicks = elapsed ? 10 : null;
        row.ClockWallAnchorUtc = wall ? WallNow : null;

        ExerciseRuntimeStateMapping.TryParse(row, out var snapshot, out var reason).Should().BeFalse();
        snapshot.Should().BeNull();
        reason.Should().Contain("partly set");
    }

    [Fact]
    public void TryParse_RefusesAFrozenFlagWithoutAClock()
    {
        var row = ValidRow();
        row.ClockFrozen = true;

        ExerciseRuntimeStateMapping.TryParse(row, out _, out var reason).Should().BeFalse();
        reason.Should().Contain("frozen");
    }

    [Theory]
    [InlineData("tier")]
    [InlineData("zone")]
    [InlineData("overlay")]
    [InlineData("register")]
    [InlineData("sequence")]
    [InlineData("elapsed")]
    public void TryParse_RefusesAnUnrestorableValue(string broken)
    {
        var row = ValidRow();
        row.ClockScenarioStart = ScenarioStart;
        row.ClockTimeZone = "UTC";
        row.ClockElapsedAtAnchorTicks = 10;
        row.ClockWallAnchorUtc = WallNow;

        switch (broken)
        {
            case "tier": row.PauseTier = "FROZEN"; break;
            case "zone": row.ClockTimeZone = "Mars/Olympus_Mons"; break;
            case "overlay": row.OverlayState = "broadcast"; break;
            case "register": row.OverlayRegister = "sideways"; break;
            case "sequence": row.OverlaySequence = -1; break;
            case "elapsed": row.ClockElapsedAtAnchorTicks = -1; break;
        }

        ExerciseRuntimeStateMapping.TryParse(row, out var snapshot, out var reason).Should().BeFalse();
        snapshot.Should().BeNull();
        reason.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public void TryParse_ADefaultRow_IsRunningWithNoClockAndNoHoldingPage()
    {
        ExerciseRuntimeStateMapping.TryParse(ValidRow(), out var snapshot, out _).Should().BeTrue();

        snapshot!.Tier.Should().Be(PauseTier.Running);
        snapshot.Clock.Should().BeNull();
        snapshot.Overlay.State.Should().Be(OverlayStateWire.None);
        snapshot.Overlay.Register.Should().Be(OverlayStateWire.InFiction, "a null register reads as the cleared overlay's");
    }

    private static ExerciseRuntimeState ValidRow() => new() { ExerciseId = Guid.NewGuid(), UpdatedAt = WallNow };
}
