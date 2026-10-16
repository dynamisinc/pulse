namespace Pulse.WebApi.Tests.Features.EngineRuntime.Persistence;

using System;
using System.Collections.Generic;
using FluentAssertions;
using Microsoft.Extensions.Time.Testing;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Xunit;

/// <summary>
/// demo-feedback story 18 (AC-3, AC-5, AC-7): the native clock's restart-resilience surface — it records a UTC wall
/// anchor beside the monotonic one, tells its change sink after every anchor change (never on a read), and restores
/// from a persisted anchor without counting as a Start. A <see cref="FakeTimeProvider"/> stands in for wall time.
/// </summary>
public sealed class ExerciseClockPersistenceTests
{
    private static readonly DateTimeOffset WallNow = new(2026, 10, 15, 14, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset ScenarioStart = new(2026, 3, 1, 8, 0, 0, TimeSpan.Zero);

    [Fact]
    public void StartFreezeUnfreezeJump_EachTellTheSink_AfterTheApply()
    {
        var time = new FakeTimeProvider(WallNow);
        var sink = new RecordingSink();
        var clock = new ExerciseClockService(time, sink);
        var exerciseId = Guid.NewGuid();
        sink.OnChanged = id => sink.Observed.Add((id, clock.IsRunning(id), clock.IsFrozen(id)));

        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        clock.Jump(exerciseId, 5);
        clock.Freeze(exerciseId);
        clock.Unfreeze(exerciseId);

        sink.Observed.Should().Equal(
            [(exerciseId, true, false), (exerciseId, true, false), (exerciseId, false, true), (exerciseId, true, false)],
            "every anchor change is written through, and the sink sees the state AFTER the in-memory apply");
    }

    [Fact]
    public void Reads_NeverTellTheSink()
    {
        var time = new FakeTimeProvider(WallNow);
        var sink = new RecordingSink();
        var clock = new ExerciseClockService(time, sink);
        var exerciseId = Guid.NewGuid();
        clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        sink.Observed.Clear();

        _ = clock.CurrentScenarioMinute(exerciseId);
        _ = clock.CurrentScenarioTime(exerciseId);
        _ = clock.IsFrozen(exerciseId);
        _ = clock.IsRunning(exerciseId);
        _ = clock.GetAnchor(exerciseId);

        sink.Observed.Should().BeEmpty("readers are synchronous and never cause a write (CurrentScenarioMinute never waits on SQL)");
    }

    [Fact]
    public void GetAnchor_CarriesAUtcWallAnchor_FromGetUtcNow_NeverAMonotonicTimestamp()
    {
        var time = new FakeTimeProvider(WallNow);
        var clock = new ExerciseClockService(time);
        var exerciseId = Guid.NewGuid();
        var chicago = TimeZoneInfo.FindSystemTimeZoneById("America/Chicago");

        clock.Start(exerciseId, ScenarioStart, chicago);
        time.Advance(TimeSpan.FromMinutes(7));
        clock.Jump(exerciseId, 3);

        var anchor = clock.GetAnchor(exerciseId);

        anchor.Should().NotBeNull();
        anchor!.WallAnchorUtc.Should().Be(WallNow.AddMinutes(7), "the anchor is the UTC wall instant of the last re-anchor");
        anchor.WallAnchorUtc.Offset.Should().Be(TimeSpan.Zero);
        anchor.ElapsedAtAnchor.Should().Be(TimeSpan.FromMinutes(10), "7 minutes run + a 3-minute jump");
        anchor.ScenarioStart.Should().Be(ScenarioStart);
        anchor.TimeZone.Id.Should().Be(chicago.Id);
        anchor.Frozen.Should().BeFalse();
    }

    [Fact]
    public void GetAnchor_IsNull_ForAnUnstartedClock()
    {
        new ExerciseClockService(new FakeTimeProvider(WallNow)).GetAnchor(Guid.NewGuid()).Should().BeNull();
    }

    [Fact]
    public void Restore_Running_AdvancesByTheDowntime_DF25()
    {
        var exerciseId = Guid.NewGuid();
        var before = new FakeTimeProvider(WallNow);
        var oldProcess = new ExerciseClockService(before);
        oldProcess.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        before.Advance(TimeSpan.FromMinutes(20));
        oldProcess.Jump(exerciseId, 0);
        var anchor = oldProcess.GetAnchor(exerciseId)!;

        // A NEW process, ten wall minutes later.
        var after = new FakeTimeProvider(WallNow.AddMinutes(30));
        var sink = new RecordingSink();
        var newProcess = new ExerciseClockService(after, sink);
        newProcess.Restore(exerciseId, anchor);

        newProcess.CurrentScenarioMinute(exerciseId).Should().Be(30, "20 minutes at the anchor + 10 minutes of downtime");
        newProcess.IsRunning(exerciseId).Should().BeTrue();
        after.Advance(TimeSpan.FromMinutes(2));
        newProcess.CurrentScenarioMinute(exerciseId).Should().Be(32, "the restored clock keeps running");
        sink.Observed.Should().BeEmpty("a restore is not a change: the row it came from is already current");
    }

    [Fact]
    public void Restore_Frozen_HoldsTheBankedMinute_DF25()
    {
        var exerciseId = Guid.NewGuid();
        var anchor = new ExerciseClockAnchor(ScenarioStart, TimeZoneInfo.Utc, TimeSpan.FromMinutes(42), WallNow, Frozen: true);
        var after = new FakeTimeProvider(WallNow.AddHours(3));
        var clock = new ExerciseClockService(after);

        clock.Restore(exerciseId, anchor);

        clock.IsFrozen(exerciseId).Should().BeTrue();
        clock.CurrentScenarioMinute(exerciseId).Should().Be(42, "a frozen clock does not accrue downtime");
        clock.Unfreeze(exerciseId);
        after.Advance(TimeSpan.FromMinutes(1));
        clock.CurrentScenarioMinute(exerciseId).Should().Be(43, "Resume continues from the same scenario minute");
    }

    [Fact]
    public void Restore_WithAWallAnchorInTheFuture_NeverMovesScenarioTimeBackwards()
    {
        var exerciseId = Guid.NewGuid();
        var anchor = new ExerciseClockAnchor(ScenarioStart, TimeZoneInfo.Utc, TimeSpan.FromMinutes(12), WallNow.AddMinutes(5), Frozen: false);
        var clock = new ExerciseClockService(new FakeTimeProvider(WallNow));

        clock.Restore(exerciseId, anchor);

        clock.CurrentScenarioMinute(exerciseId).Should().Be(12, "clock skew floors the downtime at zero");
    }

    [Fact]
    public void Restore_IsNotAStart_SoTheReactionLoopLeavesTheClockAlone()
    {
        var running = Guid.NewGuid();
        var frozen = Guid.NewGuid();
        var clock = new ExerciseClockService(new FakeTimeProvider(WallNow));

        clock.Restore(running, new ExerciseClockAnchor(ScenarioStart, TimeZoneInfo.Utc, TimeSpan.FromMinutes(9), WallNow, false));
        clock.Restore(frozen, new ExerciseClockAnchor(ScenarioStart, TimeZoneInfo.Utc, TimeSpan.FromMinutes(9), WallNow, true));

        ReactionLoopHost.ShouldStartClock(clock, running).Should().BeFalse("a restored running clock must never be restarted");
        ReactionLoopHost.ShouldStartClock(clock, frozen).Should().BeFalse("a restored frozen clock must never be restarted");
    }

    [Fact]
    public void Clear_LeavesTheClockUnstarted_AndOnlyThatExercise()
    {
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();
        var clock = new ExerciseClockService(new FakeTimeProvider(WallNow));
        clock.Start(a, ScenarioStart, TimeZoneInfo.Utc);
        clock.Start(b, ScenarioStart, TimeZoneInfo.Utc);
        clock.Freeze(a);

        clock.Clear(a).Should().BeTrue();
        clock.Clear(a).Should().BeFalse("clearing an unstarted clock is a no-op");

        clock.IsRunning(a).Should().BeFalse();
        clock.IsFrozen(a).Should().BeFalse();
        clock.CurrentScenarioMinute(a).Should().Be(0);
        clock.GetAnchor(a).Should().BeNull();
        clock.IsRunning(b).Should().BeTrue("clearing A never touches B (COR-001)");
    }

    [Fact]
    public void Restore_RefusesTheEmptyExercise()
    {
        var clock = new ExerciseClockService(new FakeTimeProvider(WallNow));
        var act = () => clock.Restore(Guid.Empty, new ExerciseClockAnchor(ScenarioStart, TimeZoneInfo.Utc, TimeSpan.Zero, WallNow, false));
        act.Should().Throw<ArgumentException>();
    }

    private sealed class RecordingSink : IExerciseClockChangeSink
    {
        public List<(Guid ExerciseId, bool Running, bool Frozen)> Observed { get; } = [];

        public Action<Guid>? OnChanged { get; set; }

        public void ClockChanged(Guid exerciseId)
        {
            if (OnChanged is null)
            {
                Observed.Add((exerciseId, false, false));
            }
            else
            {
                OnChanged(exerciseId);
            }
        }
    }
}
