namespace Pulse.WebApi.Tests.Features.EngineRuntime.Persistence;

using System;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Persistence;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Xunit;

/// <summary>
/// demo-feedback story 18, Gate-1 CR-1 / M-1 / M-2: a serverless database that answers 40613 while it resumes must
/// not cost the restore or a write-through; non-transient failures fail fast; a cancelled request still persists; and
/// a frozen clock under a non-Freeze tier restores fail-safe as Freeze.
/// </summary>
public sealed class TransientRetryTests
{
    private static readonly DateTimeOffset WallNow = new(2026, 10, 16, 9, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset ScenarioStart = new(2026, 3, 1, 8, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData(40613)]
    [InlineData(40197)]
    [InlineData(40501)]
    [InlineData(49918)]
    [InlineData(49919)]
    [InlineData(49920)]
    [InlineData(4060)]
    [InlineData(10928)]
    [InlineData(10929)]
    [InlineData(-2)]
    public void TheTransientSqlErrors_AreRecognised_EvenWrapped(int number)
    {
        var sql = SqlExceptionFactory.Create(number);

        TransientSqlErrors.IsTransient(sql).Should().BeTrue();
        TransientSqlErrors.IsTransient(new DbUpdateException("save failed", sql)).Should().BeTrue("EF wraps the SqlException");
    }

    [Fact]
    public void NonTransientFailures_AreNotRetried()
    {
        TransientSqlErrors.IsTransient(SqlExceptionFactory.Create(11001, "No such host is known.")).Should().BeFalse("DNS failure");
        TransientSqlErrors.IsTransient(SqlExceptionFactory.Create(208, "Invalid object name.")).Should().BeFalse();
        TransientSqlErrors.IsTransient(new InvalidOperationException("The ConnectionString property has not been initialized.")).Should().BeFalse();
        TransientSqlErrors.IsTransient(new TimeoutException()).Should().BeTrue();
    }

    [Fact]
    public async Task Rehydrator_RetriesTwo40613s_ThenRestoresTheFreeze()
    {
        var world = new World(budgetSeconds: 30);
        var exerciseId = Guid.NewGuid();
        world.Store.FailNextReads.Enqueue(SqlExceptionFactory.Create(40613));
        world.Store.FailNextReads.Enqueue(SqlExceptionFactory.Create(40613));
        world.Store.RehydrationRows.Add(Row(exerciseId, "freeze", frozen: true, overlay: "pause"));

        var restored = await world.Rehydrator.RehydrateAsync();

        restored.Should().Be(1);
        world.Store.ReadCount.Should().Be(3);
        world.Registry.GetTier(exerciseId).Should().Be(PauseTier.Freeze, "the restore survives a resuming database");
        world.Clock.IsFrozen(exerciseId).Should().BeTrue();
        world.Overlay.Get(exerciseId).State.Should().Be(OverlayStateWire.Pause);
        world.Logger.Entries.Count(e => e.Level == LogLevel.Warning && e.Message.Contains("transient")).Should().Be(2,
            "each retry is logged at Warning");
        world.Logger.Entries.Should().NotContain(e => e.Level == LogLevel.Error);
    }

    [Fact]
    public async Task Rehydrator_ANonTransientFailure_FailsFast_WithNoRetry()
    {
        var world = new World(budgetSeconds: 90);
        world.Store.FailReadWith = new InvalidOperationException("The ConnectionString property has not been initialized.");
        var stopwatch = Stopwatch.StartNew();

        var restored = await world.Rehydrator.RehydrateAsync();

        restored.Should().Be(0);
        world.Store.ReadCount.Should().Be(1, "a non-transient failure is never retried");
        stopwatch.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(2), "a misconfigured host must not wait on the budget");
        world.Logger.Entries.Should().ContainSingle(e => e.Level == LogLevel.Error);
    }

    [Fact]
    public async Task Rehydrator_GivesUp_WhenTheBudgetRunsOut_AndSaysSo()
    {
        var world = new World(budgetSeconds: 1);
        world.Store.FailReadWith = SqlExceptionFactory.Create(40613);

        var act = () => world.Rehydrator.StartAsync(CancellationToken.None);

        await act.Should().NotThrowAsync("startup never fails because of runtime state");
        world.Store.ReadCount.Should().BeGreaterThan(1);
        world.Logger.Entries.Should().Contain(e => e.Level == LogLevel.Error && e.Message.Contains("GAVE UP"));
    }

    [Fact]
    public async Task Rehydrator_WithAZeroBudget_DoesNotRetry()
    {
        var world = new World(budgetSeconds: 0);
        world.Store.FailReadWith = SqlExceptionFactory.Create(40613);

        await world.Rehydrator.RehydrateAsync();

        world.Store.ReadCount.Should().Be(1, "test hosts set the budget to 0");
    }

    [Theory]
    [InlineData("running", null)]
    [InlineData("engine", "pause")]
    public async Task Rehydrator_AFrozenClockUnderANonFreezeTier_RestoresFailSafeAsFreeze(string tier, string? storedOverlay)
    {
        var world = new World(budgetSeconds: 0);
        var exerciseId = Guid.NewGuid();
        var row = Row(exerciseId, tier, frozen: true, overlay: storedOverlay ?? "none");
        row.Row.OverlayRegister = storedOverlay is null ? null : OverlayStateWire.OutOfFiction;
        world.Store.RehydrationRows.Add(row);

        await world.Rehydrator.RehydrateAsync();

        world.Registry.GetTier(exerciseId).Should().Be(PauseTier.Freeze, "a partly failed Freeze write never silently un-freezes");
        world.Clock.IsFrozen(exerciseId).Should().BeTrue();
        var overlay = world.Overlay.Get(exerciseId);
        overlay.State.Should().Be(OverlayStateWire.Pause);
        overlay.Register.Should().Be(storedOverlay is null ? OverlayStateWire.InFiction : OverlayStateWire.OutOfFiction,
            "the stored holding page wins; otherwise the default in-fiction pause page");
        overlay.Sequence.Should().Be(5);
        world.Logger.Entries.Should().Contain(e => e.Level == LogLevel.Warning && e.Message.Contains("fail-safe"));
    }

    [Fact]
    public async Task Writer_RetriesATransientFailure_AndReportsPersisted()
    {
        var (registry, store, logger) = Wired();
        store.FailNextWrites.Enqueue(SqlExceptionFactory.Create(40613));
        store.FailNextWrites.Enqueue(SqlExceptionFactory.Create(40501));
        var exerciseId = Guid.NewGuid();

        var result = await registry.SetTierAsync(exerciseId, PauseTier.Engine, "controller-1");

        result.Persisted.Should().BeTrue("two transient failures then a success is a persisted write");
        store.UpsertCount.Should().Be(3);
        store.Rows[exerciseId].Tier.Should().Be(PauseTier.Engine);
        logger.Entries.Count(e => e.Level == LogLevel.Warning).Should().Be(2);
        logger.Entries.Should().NotContain(e => e.Level == LogLevel.Error);
    }

    [Fact]
    public async Task Writer_DoesNotRetryANonTransientFailure()
    {
        var (registry, store, logger) = Wired();
        store.FailNextWrites.Enqueue(new InvalidOperationException("constraint"));

        var result = await registry.SetTierAsync(Guid.NewGuid(), PauseTier.Engine, "controller-1");

        result.Persisted.Should().BeFalse();
        store.UpsertCount.Should().Be(1);
        logger.Entries.Should().ContainSingle(e => e.Level == LogLevel.Error);
    }

    [Fact]
    public async Task Writer_GivesUpAfterTheConfiguredAttempts()
    {
        var (registry, store, logger) = Wired();
        store.FailWith = SqlExceptionFactory.Create(40613);

        var result = await registry.SetTierAsync(Guid.NewGuid(), PauseTier.Engine, "controller-1");

        result.Persisted.Should().BeFalse();
        store.UpsertCount.Should().Be(3);
        logger.Entries.Should().ContainSingle(e => e.Level == LogLevel.Error);
    }

    [Fact]
    public async Task ACancelledRequest_StillPersistsTheAppliedChange_M1()
    {
        var (registry, store, _) = Wired();
        var exerciseId = Guid.NewGuid();
        using var aborted = new CancellationTokenSource();
        await aborted.CancelAsync();

        var result = await registry.SetTierAsync(exerciseId, PauseTier.Engine, "controller-1", cancellationToken: aborted.Token);

        result.Persisted.Should().BeTrue("the write-through never runs on the request's token");
        store.Rows[exerciseId].Tier.Should().Be(PauseTier.Engine);
    }

    [Fact]
    public async Task TheResetDelete_RetriesATransientFailure()
    {
        var (_, store, _) = Wired(out var writer);
        var exerciseId = Guid.NewGuid();
        store.Rows[exerciseId] = new ExerciseRuntimeStateSnapshot(exerciseId, PauseTier.Freeze, null, OverlayStateService.Cleared);
        store.FailNextWrites.Enqueue(SqlExceptionFactory.Create(40613));

        (await writer.DeleteAsync(exerciseId, auditEvent: null, CancellationToken.None)).Should().BeTrue();
        store.Rows.Should().NotContainKey(exerciseId);
    }

    private static (PauseTierRegistry Registry, InMemoryRuntimeStateStore Store, RecordingLogger<ExerciseRuntimeStateWriter> Logger) Wired() =>
        Wired(out _);

    private static (PauseTierRegistry Registry, InMemoryRuntimeStateStore Store, RecordingLogger<ExerciseRuntimeStateWriter> Logger) Wired(
        out ExerciseRuntimeStateWriter writer)
    {
        var clock = new ExerciseClockService(new FakeTimeProvider(WallNow));
        var store = new InMemoryRuntimeStateStore();
        var logger = new RecordingLogger<ExerciseRuntimeStateWriter>();
        PauseTierRegistry? registry = null;
        writer = new ExerciseRuntimeStateWriter(
            store,
            id => registry!.GetTier(id),
            clock,
            new OverlayStateService(),
            logger,
            Options.Create(new ExerciseRuntimePersistenceOptions { WriteAttempts = 3, WriteRetryInitialDelayMilliseconds = 1 }));
        registry = new PauseTierRegistry(clock, new NullPauseOverlayPublisher(), writer, NullLogger<PauseTierRegistry>.Instance);
        return (registry, store, logger);
    }

    private static PersistedExerciseRuntimeState Row(Guid exerciseId, string tier, bool frozen, string overlay) =>
        new(
            new ExerciseRuntimeState
            {
                ExerciseId = exerciseId,
                PauseTier = tier,
                ClockScenarioStart = ScenarioStart,
                ClockTimeZone = "UTC",
                ClockElapsedAtAnchorTicks = TimeSpan.FromMinutes(12).Ticks,
                ClockWallAnchorUtc = WallNow,
                ClockFrozen = frozen,
                OverlayState = overlay,
                OverlayRegister = OverlayStateWire.InFiction,
                OverlaySequence = 5,
                UpdatedAt = WallNow,
            },
            ExerciseExists: true);

    private sealed class World
    {
        public World(int budgetSeconds)
        {
            Clock = new ExerciseClockService(new FakeTimeProvider(WallNow));
            Registry = new PauseTierRegistry(Clock, new NullPauseOverlayPublisher(), NullLogger<PauseTierRegistry>.Instance);
            Rehydrator = new ExerciseRuntimeStateRehydrator(
                Store,
                Registry,
                Clock,
                Overlay,
                Logger,
                Options.Create(new ExerciseRuntimePersistenceOptions
                {
                    RehydrateRetryBudgetSeconds = budgetSeconds,
                    RehydrateRetryInitialDelayMilliseconds = 10,
                }));
        }

        public InMemoryRuntimeStateStore Store { get; } = new();

        public ExerciseClockService Clock { get; }

        public OverlayStateService Overlay { get; } = new();

        public PauseTierRegistry Registry { get; }

        public RecordingLogger<ExerciseRuntimeStateRehydrator> Logger { get; } = new();

        public ExerciseRuntimeStateRehydrator Rehydrator { get; }
    }
}
