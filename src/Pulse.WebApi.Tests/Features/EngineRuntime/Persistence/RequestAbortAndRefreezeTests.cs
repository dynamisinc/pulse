namespace Pulse.WebApi.Tests.Features.EngineRuntime.Persistence;

using System;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Persistence;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Identity.EasyLogin;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Tests.Features.Identity.Staff;
using Xunit;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;

/// <summary>
/// demo-feedback story 18 re-review: M-A — a request aborted DURING the overlay publish can never skip the
/// write-through or the reset's row delete; L-C — a Freeze tier over a running clock (an Unfreeze whose tier write
/// failed) restores with the clock re-frozen at its elapsed value.
/// </summary>
public sealed class RequestAbortAndRefreezeTests
{
    private static readonly DateTimeOffset WallNow = new(2026, 10, 16, 9, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset ScenarioStart = new(2026, 3, 1, 8, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task ARequestAbortedDuringThePublish_StillPersistsTheTier_MA()
    {
        using var request = new CancellationTokenSource();
        var world = new World(new AbortingPublisher(request));
        var exerciseId = Guid.NewGuid();

        var result = await world.Registry.SetTierAsync(
            exerciseId, PauseTier.Freeze, "controller-1", new PauseClockStart(ScenarioStart, TimeZoneInfo.Utc), cancellationToken: request.Token);

        request.IsCancellationRequested.Should().BeTrue("the client went away mid-publish");
        result.Persisted.Should().BeTrue();
        world.Store.Rows[exerciseId].Tier.Should().Be(PauseTier.Freeze, "a request abort never skips the write-through");
    }

    [Fact]
    public async Task ARequestAbortedDuringTheResetPublish_StillDeletesTheRow_MA()
    {
        using var request = new CancellationTokenSource();
        var world = new World(new AbortingPublisher(request));
        var exerciseId = Guid.NewGuid();
        world.Store.Rows[exerciseId] = new ExerciseRuntimeStateSnapshot(exerciseId, PauseTier.Freeze, null, OverlayStateService.Cleared);
        await using var db = new PulseDbContext(
            new DbContextOptionsBuilder<PulseDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var service = new RuntimeStateResetService(
            world.Registry,
            world.Writer,
            world.Clock,
            new ExerciseContext { CurrentExerciseId = exerciseId },
            new StubCurrentStaffSessionAccessor(new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = Guid.NewGuid() }),
            new ExerciseFactsReader(db),
            TestScenarioNow.Over(db, world.Clock),
            new FakeTimeProvider(WallNow));

        var state = await service.ResetAsync(request.Token);

        request.IsCancellationRequested.Should().BeTrue();
        state!.Persisted.Should().BeTrue();
        world.Store.Rows.Should().NotContainKey(exerciseId, "a request abort never skips the reset's delete");
    }

    [Fact]
    public async Task AFreezeTierOverARunningClock_RestoresWithTheClockRefrozen_LC()
    {
        var store = new InMemoryRuntimeStateStore();
        var clock = new ExerciseClockService(new FakeTimeProvider(WallNow.AddMinutes(10)));
        var registry = new PauseTierRegistry(clock, new NullPauseOverlayPublisher(), NullLogger<PauseTierRegistry>.Instance);
        var overlay = new OverlayStateService();
        var logger = new RecordingLogger<ExerciseRuntimeStateRehydrator>();
        var exerciseId = Guid.NewGuid();
        store.RehydrationRows.Add(new PersistedExerciseRuntimeState(
            new ExerciseRuntimeState
            {
                ExerciseId = exerciseId,
                PauseTier = "freeze",
                ClockScenarioStart = ScenarioStart,
                ClockTimeZone = "UTC",
                ClockElapsedAtAnchorTicks = TimeSpan.FromMinutes(12).Ticks,
                ClockWallAnchorUtc = WallNow,
                ClockFrozen = false,
                OverlayState = "none",
                OverlaySequence = 4,
                UpdatedAt = WallNow,
            },
            ExerciseExists: true));
        var rehydrator = new ExerciseRuntimeStateRehydrator(
            store, registry, clock, overlay, logger,
            Options.Create(new ExerciseRuntimePersistenceOptions { RehydrateRetryBudgetSeconds = 0 }));

        await rehydrator.RehydrateAsync();

        registry.GetTier(exerciseId).Should().Be(PauseTier.Freeze);
        clock.IsFrozen(exerciseId).Should().BeTrue("a Freeze tier never comes back over a running clock");
        clock.CurrentScenarioMinute(exerciseId).Should().Be(22, "re-frozen at its elapsed value: 12 banked + 10 of downtime");
        overlay.Get(exerciseId).State.Should().Be(OverlayStateWire.Pause, "a restored Freeze shows the holding page");
        overlay.Get(exerciseId).Sequence.Should().Be(4);
        store.UpsertCount.Should().Be(0, "the fail-safe is in memory only");
        logger.Entries.Should().Contain(e => e.Level == LogLevel.Warning && e.Message.Contains("re-frozen"));
    }

    /// <summary>Simulates the client disconnecting mid-publish: cancels the request, then honours the token it got.</summary>
    private sealed class AbortingPublisher(CancellationTokenSource request) : IPauseOverlayPublisher
    {
        public Task PublishAsync(PauseTierTransition transition, CancellationToken cancellationToken = default)
        {
            request.Cancel();
            cancellationToken.ThrowIfCancellationRequested();
            return Task.CompletedTask;
        }
    }

    private sealed class World
    {
        public World(IPauseOverlayPublisher publisher)
        {
            Clock = new ExerciseClockService(new FakeTimeProvider(WallNow));
            PauseTierRegistry? registry = null;
            Writer = new ExerciseRuntimeStateWriter(
                Store, id => registry!.GetTier(id), Clock, new OverlayStateService(), NullLogger<ExerciseRuntimeStateWriter>.Instance);
            registry = new PauseTierRegistry(Clock, publisher, Writer, NullLogger<PauseTierRegistry>.Instance);
            Registry = registry;
        }

        public InMemoryRuntimeStateStore Store { get; } = new();

        public ExerciseClockService Clock { get; }

        public ExerciseRuntimeStateWriter Writer { get; }

        public PauseTierRegistry Registry { get; }
    }
}
