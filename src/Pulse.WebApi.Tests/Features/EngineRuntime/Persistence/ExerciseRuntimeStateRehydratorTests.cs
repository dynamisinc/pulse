namespace Pulse.WebApi.Tests.Features.EngineRuntime.Persistence;

using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Persistence;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Xunit;

/// <summary>
/// demo-feedback story 18 (AC-5, AC-6, isolation): the rehydrator over an in-memory store — it restores each
/// exercise's tier, clock and overlay exactly as persisted, skips (and logs) a row for a missing exercise or one that
/// does not parse while restoring the rest, and never fails startup, even when the table cannot be read. The SQL path
/// is proven in <see cref="ExerciseRuntimeStateRestartTests"/>.
/// </summary>
public sealed class ExerciseRuntimeStateRehydratorTests
{
    private static readonly DateTimeOffset WallNow = new(2026, 10, 15, 14, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset ScenarioStart = new(2026, 3, 1, 8, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Restores_TierClockAndOverlay_PerExercise_WithoutTouchingAnother()
    {
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();
        var untouched = Guid.NewGuid();
        var world = new World(WallNow.AddMinutes(10));
        world.Store.RehydrationRows.Add(Row(a, "freeze", elapsedMinutes: 30, wallAnchor: WallNow, frozen: true, overlay: "pause", sequence: 4));
        world.Store.RehydrationRows.Add(Row(b, "engine", elapsedMinutes: 5, wallAnchor: WallNow, frozen: false, overlay: "none", sequence: 2));

        var restored = await world.Rehydrator.RehydrateAsync();

        restored.Should().Be(2);
        world.Registry.GetTier(a).Should().Be(PauseTier.Freeze);
        world.Clock.IsFrozen(a).Should().BeTrue();
        world.Clock.CurrentScenarioMinute(a).Should().Be(30, "a frozen clock holds its minute through downtime");
        world.Overlay.Get(a).State.Should().Be(OverlayStateWire.Pause);
        world.Overlay.NextSequence(a).Should().Be(5);

        world.Registry.GetTier(b).Should().Be(PauseTier.Engine);
        world.Clock.IsRunning(b).Should().BeTrue();
        world.Clock.CurrentScenarioMinute(b).Should().Be(15, "5 banked minutes + 10 minutes of downtime");
        world.Overlay.Get(b).State.Should().Be(OverlayStateWire.None);

        world.Registry.GetTier(untouched).Should().Be(PauseTier.Running, "an exercise with no row stays at the default");
        world.Clock.IsRunning(untouched).Should().BeFalse();
        world.Overlay.Get(untouched).Should().Be(OverlayStateService.Cleared);
    }

    [Fact]
    public async Task ARowForAMissingExercise_IsLoggedAndSkipped()
    {
        var gone = Guid.NewGuid();
        var kept = Guid.NewGuid();
        var world = new World(WallNow);
        world.Store.RehydrationRows.Add(Row(gone, "freeze", 1, WallNow, true, "pause", 1) with { ExerciseExists = false });
        world.Store.RehydrationRows.Add(Row(kept, "engine", 1, WallNow, false, "none", 0));

        var restored = await world.Rehydrator.RehydrateAsync();

        restored.Should().Be(1);
        world.Registry.GetTier(gone).Should().Be(PauseTier.Running);
        world.Clock.IsFrozen(gone).Should().BeFalse();
        world.Registry.GetTier(kept).Should().Be(PauseTier.Engine);
        world.Logger.Entries.Should().Contain(e => e.Level == LogLevel.Warning && e.Message.Contains(gone.ToString()));
    }

    [Fact]
    public async Task AnUnparseableRow_IsLoggedAndSkipped_AndTheOthersAreRestored()
    {
        var bad = Guid.NewGuid();
        var good = Guid.NewGuid();
        var world = new World(WallNow);
        var badRow = Row(bad, "freeze", 1, WallNow, true, "pause", 1);
        badRow.Row.ClockTimeZone = null; // partly-set clock columns (L-3)
        world.Store.RehydrationRows.Add(badRow);
        world.Store.RehydrationRows.Add(Row(good, "injects", 1, WallNow, false, "none", 0));

        var restored = await world.Rehydrator.RehydrateAsync();

        restored.Should().Be(1);
        world.Registry.GetTier(bad).Should().Be(PauseTier.Running, "a bad row is skipped whole, never half-restored");
        world.Clock.IsFrozen(bad).Should().BeFalse();
        world.Overlay.Get(bad).Should().Be(OverlayStateService.Cleared);
        world.Registry.GetTier(good).Should().Be(PauseTier.Injects);
        world.Logger.Entries.Should().Contain(e => e.Level == LogLevel.Warning && e.Message.Contains("partly set"));
    }

    [Fact]
    public async Task AnUnreadableTable_NeverFailsStartup()
    {
        var world = new World(WallNow);
        world.Store.FailReadWith = new InvalidOperationException("Invalid object name 'ExerciseRuntimeStates'.");

        var act = () => world.Rehydrator.StartAsync(CancellationToken.None);

        await act.Should().NotThrowAsync("startup never fails because of runtime state");
        world.Logger.Entries.Should().Contain(e => e.Level == LogLevel.Error);
    }

    [Fact]
    public async Task Restoring_WritesNothing()
    {
        var world = new World(WallNow);
        world.Store.RehydrationRows.Add(Row(Guid.NewGuid(), "freeze", 1, WallNow, true, "pause", 1));

        await world.Rehydrator.RehydrateAsync();

        world.Store.UpsertCount.Should().Be(0, "the rehydrator is read-only; the row is already current (L-4)");
    }

    private static PersistedExerciseRuntimeState Row(
        Guid exerciseId, string tier, int elapsedMinutes, DateTimeOffset wallAnchor, bool frozen, string overlay, long sequence) =>
        new(
            new ExerciseRuntimeState
            {
                ExerciseId = exerciseId,
                PauseTier = tier,
                ClockScenarioStart = ScenarioStart,
                ClockTimeZone = "UTC",
                ClockElapsedAtAnchorTicks = TimeSpan.FromMinutes(elapsedMinutes).Ticks,
                ClockWallAnchorUtc = wallAnchor,
                ClockFrozen = frozen,
                OverlayState = overlay,
                OverlayRegister = OverlayStateWire.InFiction,
                OverlaySequence = sequence,
                UpdatedAt = wallAnchor,
            },
            ExerciseExists: true);

    private sealed class World
    {
        public World(DateTimeOffset now)
        {
            Clock = new ExerciseClockService(new FakeTimeProvider(now));
            Registry = new PauseTierRegistry(Clock, new NullPauseOverlayPublisher(), NullLogger<PauseTierRegistry>.Instance);
            Rehydrator = new ExerciseRuntimeStateRehydrator(Store, Registry, Clock, Overlay, Logger);
        }

        public InMemoryRuntimeStateStore Store { get; } = new();

        public ExerciseClockService Clock { get; }

        public OverlayStateService Overlay { get; } = new();

        public PauseTierRegistry Registry { get; }

        public RecordingLogger<ExerciseRuntimeStateRehydrator> Logger { get; } = new();

        public ExerciseRuntimeStateRehydrator Rehydrator { get; }
    }
}
