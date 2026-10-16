namespace Pulse.WebApi.Tests.Features.EngineRuntime.Persistence;

using System;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Persistence;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Xunit;

/// <summary>
/// demo-feedback story 18 (AC-2): <see cref="PauseTierRegistry.SetTierAsync"/> writes the tier, clock and overlay
/// snapshot through AFTER the in-memory apply and OUTSIDE its lock, awaited; Unchanged and refused outcomes write
/// nothing; a failed write is logged at Error, reported as <c>Persisted = false</c>, and never rolls the tier back.
/// </summary>
public sealed class PauseTierWriteThroughTests
{
    private static readonly DateTimeOffset WallNow = new(2026, 10, 15, 14, 0, 0, TimeSpan.Zero);
    private static readonly PauseClockStart ClockStart = new(WallNow, TimeZoneInfo.Utc);

    [Fact]
    public async Task Applied_WritesThroughOnce_AfterTheInMemoryApply_AndOutsideTheLock()
    {
        var clock = new ExerciseClockService(new FakeTimeProvider(WallNow));
        var persister = new RecordingPersister();
        var registry = new PauseTierRegistry(
            clock, new NullPauseOverlayPublisher(), persister, NullLogger<PauseTierRegistry>.Instance);
        var exerciseId = Guid.NewGuid();
        var other = Guid.NewGuid();

        (PauseTier Tier, bool ClockFrozen, bool LockFree)? seen = null;
        persister.OnPersist = id =>
        {
            // Another thread can take the registry's lock while the write runs: the write is OUTSIDE it.
            var lockFree = Task.Run(() => registry.Restore(other, PauseTier.Engine)).Wait(TimeSpan.FromSeconds(5));
            seen = (registry.GetTier(id), clock.IsFrozen(id), lockFree);
        };

        var result = await registry.SetTierAsync(exerciseId, PauseTier.Freeze, "controller-1", ClockStart);

        result.Outcome.Should().Be(PauseTierOutcome.Applied);
        result.Persisted.Should().BeTrue();
        persister.Persisted.Should().Equal([exerciseId], "exactly one write-through per applied change");
        seen.Should().Be((PauseTier.Freeze, true, true),
            "the write sees the APPLIED tier and frozen clock, and runs with the registry lock released");
    }

    [Fact]
    public async Task EveryTierChange_WritesThrough()
    {
        var persister = new RecordingPersister();
        var registry = Registry(persister);
        var exerciseId = Guid.NewGuid();

        await registry.SetTierAsync(exerciseId, PauseTier.Injects, "controller-1");
        await registry.SetTierAsync(exerciseId, PauseTier.Engine, "controller-1");
        await registry.SetTierAsync(exerciseId, PauseTier.Freeze, "controller-1", ClockStart);
        await registry.SetTierAsync(exerciseId, PauseTier.Running, "controller-1");

        persister.Persisted.Should().HaveCount(4);
    }

    [Fact]
    public async Task Unchanged_WritesNothing()
    {
        var persister = new RecordingPersister();
        var registry = Registry(persister);
        var exerciseId = Guid.NewGuid();
        await registry.SetTierAsync(exerciseId, PauseTier.Engine, "controller-1");
        persister.Persisted.Clear();

        var result = await registry.SetTierAsync(exerciseId, PauseTier.Engine, "controller-1");

        result.Outcome.Should().Be(PauseTierOutcome.Unchanged);
        result.Persisted.Should().BeTrue("nothing needed writing");
        persister.Persisted.Should().BeEmpty("an Unchanged outcome writes nothing");
    }

    [Fact]
    public async Task Refused_WritesNothing()
    {
        var persister = new RecordingPersister();
        var registry = Registry(persister);

        var result = await registry.SetTierAsync(Guid.NewGuid(), PauseTier.Freeze, "controller-1", clockStart: null);

        result.Outcome.Should().Be(PauseTierOutcome.ClockUnavailable);
        persister.Persisted.Should().BeEmpty("a refused change records nothing, so it persists nothing");
    }

    [Fact]
    public async Task AFailedWrite_ReportsPersistedFalse_LogsAtError_AndKeepsTheTier()
    {
        var time = new FakeTimeProvider(WallNow);
        var clock = new ExerciseClockService(time);
        var overlay = new OverlayStateService();
        var store = new InMemoryRuntimeStateStore { FailWith = new InvalidOperationException("SQL is down") };
        var logger = new RecordingLogger<ExerciseRuntimeStateWriter>();
        PauseTierRegistry? registry = null;
        var writer = new ExerciseRuntimeStateWriter(store, id => registry!.GetTier(id), clock, overlay, logger);
        registry = new PauseTierRegistry(clock, new NullPauseOverlayPublisher(), writer, NullLogger<PauseTierRegistry>.Instance);
        var exerciseId = Guid.NewGuid();

        var result = await registry.SetTierAsync(exerciseId, PauseTier.Freeze, "controller-1", ClockStart);

        result.Outcome.Should().Be(PauseTierOutcome.Applied, "a failed write never fails the safety action");
        result.Persisted.Should().BeFalse();
        registry.GetTier(exerciseId).Should().Be(PauseTier.Freeze, "never rolled back");
        clock.IsFrozen(exerciseId).Should().BeTrue();
        logger.Entries.Should().Contain(entry => entry.Level == LogLevel.Error && entry.Exception is InvalidOperationException);
        PauseTierStateDto.From(registry, exerciseId, result.Persisted).Persisted.Should().BeFalse(
            "the console's warning chip reads persisted:false");
    }

    [Fact]
    public async Task TheWriter_ComposesTheWholeRow_TierClockAndPublishedOverlay()
    {
        var time = new FakeTimeProvider(WallNow);
        var clock = new ExerciseClockService(time);
        var overlay = new OverlayStateService();
        var store = new InMemoryRuntimeStateStore();
        PauseTierRegistry? registry = null;
        var writer = new ExerciseRuntimeStateWriter(
            store, id => registry!.GetTier(id), clock, overlay, NullLogger<ExerciseRuntimeStateWriter>.Instance);
        var publisher = new StoreWritingPublisher(overlay, id => registry!.GetTier(id));
        registry = new PauseTierRegistry(clock, publisher, writer, NullLogger<PauseTierRegistry>.Instance);
        var exerciseId = Guid.NewGuid();

        await registry.SetTierAsync(exerciseId, PauseTier.Freeze, "controller-1", ClockStart, OverlayStateWire.InFiction);

        var row = store.Rows[exerciseId];
        row.Tier.Should().Be(PauseTier.Freeze);
        row.Clock.Should().NotBeNull();
        row.Clock!.Frozen.Should().BeTrue();
        row.Clock.WallAnchorUtc.Should().Be(WallNow);
        row.Overlay.State.Should().Be(OverlayStateWire.Pause, "the snapshot participants were sent is persisted with it");
        row.Overlay.Register.Should().Be(OverlayStateWire.InFiction);
        row.Overlay.Sequence.Should().Be(1);
    }

    private static PauseTierRegistry Registry(RecordingPersister persister) =>
        new(
            new ExerciseClockService(new FakeTimeProvider(WallNow)),
            new NullPauseOverlayPublisher(),
            persister,
            NullLogger<PauseTierRegistry>.Instance);

    /// <summary>The store half of the real publisher (no hub): ticket, authoritative tier, apply.</summary>
    private sealed class StoreWritingPublisher(OverlayStateService overlay, PauseTierReader tierReader) : IPauseOverlayPublisher
    {
        public Task PublishAsync(PauseTierTransition transition, System.Threading.CancellationToken cancellationToken = default)
        {
            var sequence = overlay.NextSequence(transition.ExerciseId);
            if (tierReader(transition.ExerciseId) == PauseTier.Freeze)
            {
                overlay.Apply(transition.ExerciseId, OverlayStateWire.Pause, transition.OverlayRegister, sequence);
            }
            else
            {
                overlay.Apply(transition.ExerciseId, OverlayStateWire.None, OverlayStateWire.InFiction, sequence);
            }

            return Task.CompletedTask;
        }
    }
}
