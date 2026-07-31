namespace Pulse.WebApi.Tests.Features.EngineRuntime;

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Pulse.Core.Features.Autonomy.Models;
using Pulse.Core.Features.Generation.Models;
using Pulse.Core.Features.Generation.Services;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Publishing;
using Pulse.WebApi.Features.EngineRuntime.Review;
using Pulse.WebApi.Features.EngineRuntime.Telemetry;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Xunit;

/// <summary>
/// The WR-005 guarantee under fault injection: when the XC-004 audit row for an engine-settings change cannot
/// be persisted, the in-memory posture change has ALREADY applied and is live, so the call must still succeed
/// (returning the applied snapshot) and must log LOUDLY at <see cref="LogLevel.Error"/> — never surface a 500
/// that tells the operator "your change did not apply" when it did. Cancellation is the one exception: it
/// propagates. Docker-free (the save fault is injected before any provider is touched), so this contract is
/// provable on any developer machine — the same reasoning as
/// <see cref="EngineReviewSafetyInvariantTests"/>.
/// </summary>
public sealed class EngineSettingsAuditFailureTests
{
    private static readonly DateTimeOffset ScenarioStart = new(2033, 6, 14, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task SetAutonomyDefault_WhenTheAuditRowCannotBePersisted_StillSucceeds_WithTheAppliedPosture()
    {
        var exerciseId = Guid.NewGuid();
        using var harness = new Harness(exerciseId, new InvalidOperationException("transient SQL failure"));

        var result = await harness.Service.SetExerciseAutonomyDefaultAsync(
            "delayed-auto", new EngineReviewActionInput("controller-7", "UTC"));

        result.Outcome.Should().Be(
            EngineReviewOutcome.Ok,
            "the posture change already applied and is live for the next burst — a 500 would falsely report that it did not");
        result.Settings!.Autonomy.ExerciseDefaultLevel.Should().Be(
            AutonomyLevel.DelayedAuto, "the returned snapshot is the APPLIED state, not a rolled-back one");
        result.Settings!.Autonomy.EffectiveLevel.Should().Be(AutonomyLevel.DelayedAuto);
        harness.Registry.GetOrCreate(exerciseId).ExerciseDefault.Should().Be(AutonomyLevel.DelayedAuto);
    }

    [Fact]
    public async Task SetAutonomyDefault_WhenTheAuditRowCannotBePersisted_LogsAtError()
    {
        var exerciseId = Guid.NewGuid();
        using var harness = new Harness(exerciseId, new InvalidOperationException("transient SQL failure"));

        await harness.Service.SetExerciseAutonomyDefaultAsync(
            "delayed-auto", new EngineReviewActionInput("controller-7", "UTC"));

        var entry = harness.Logger.Entries.Should().ContainSingle(
            "an unaudited-but-live posture change is an ops event, so exactly one loud record is written").Subject;
        entry.Level.Should().Be(LogLevel.Error, "swallowing it quietly would hide an audit gap");
        entry.Message.Should().Contain(EngineEventTypes.AutonomyDefaultChanged, "the log names which change went unaudited");
        entry.Message.Should().Contain(exerciseId.ToString(), "and which exercise it applied to");
        entry.Exception.Should().BeOfType<InvalidOperationException>("the underlying failure is attached, not discarded");
    }

    [Fact]
    public async Task SetTierPolicy_WhenTheAuditRowCannotBePersisted_StillSucceeds_AndLogsAtError()
    {
        var exerciseId = Guid.NewGuid();
        using var harness = new Harness(exerciseId, new DbUpdateException("audit insert failed"));

        var result = await harness.Service.SetTierPolicyModeAsync(
            "ambient", new EngineReviewActionInput("controller-7", "UTC"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        result.Settings!.TierPolicyMode.Should().Be(
            TierPolicyMode.Ambient, "the override is recorded and live regardless of the audit write");
        harness.TierPolicy.GetMode(exerciseId).Should().Be(TierPolicyMode.Ambient);
        harness.Logger.Entries.Should().ContainSingle().Which.Level.Should().Be(LogLevel.Error);
    }

    [Fact]
    public async Task SetAutonomyDefault_WhenThePersistIsCancelled_PropagatesTheCancellation_AndDoesNotLogItAsAnAuditGap()
    {
        var exerciseId = Guid.NewGuid();
        using var harness = new Harness(exerciseId, new OperationCanceledException());

        var act = async () => await harness.Service.SetExerciseAutonomyDefaultAsync(
            "delayed-auto", new EngineReviewActionInput("controller-7", "UTC"));

        await act.Should().ThrowAsync<OperationCanceledException>(
            "cancellation is a caller/shutdown signal, not an audit failure — it must never be swallowed");
        harness.Logger.Entries.Should().BeEmpty("a cancelled request is not an unaudited change to report");
    }

    [Fact]
    public async Task SetAutonomyDefault_WhenTheAuditRowPersistsFine_LogsNothing()
    {
        var exerciseId = Guid.NewGuid();
        using var harness = new Harness(exerciseId, saveFailure: null);

        var result = await harness.Service.SetExerciseAutonomyDefaultAsync(
            "delayed-auto", new EngineReviewActionInput("controller-7", "UTC"));

        result.Outcome.Should().Be(EngineReviewOutcome.Ok);
        harness.Logger.Entries.Should().BeEmpty("the happy path is silent — the Error log means something genuinely went wrong");
    }

    /// <summary>The real <see cref="EngineReviewService"/> over a context whose <c>SaveChangesAsync</c> can be made to throw.</summary>
    private sealed class Harness : IDisposable
    {
        private readonly FaultyDbContext _db;

        public Harness(Guid exerciseId, Exception? saveFailure)
        {
            var context = new ExerciseContext { CurrentExerciseId = exerciseId };
            var options = new DbContextOptionsBuilder<PulseDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options;

            _db = new FaultyDbContext(options, context, saveFailure);

            var clock = new ExerciseClockService(new ManualTimeProvider(ScenarioStart));
            clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);

            Registry = new EngineAutonomyRegistry();
            TierPolicy = new EngineTierPolicyRegistry();
            Logger = new CapturingLogger();

            Service = new EngineReviewService(
                new EngineReviewStore(_db),
                _db,
                context,
                clock,
                new EngineTelemetryEmitter(),
                Mock.Of<IEnginePublishService>(),
                Mock.Of<IEngineReviewBroadcaster>(),
                Registry,
                TierPolicy,
                new FakeGenerationProvider(),
                Options.Create(new GenerationOptions()),
                new GenerationProviderCutRegistry(),
                Logger);
        }

        public EngineReviewService Service { get; }

        public EngineAutonomyRegistry Registry { get; }

        public EngineTierPolicyRegistry TierPolicy { get; }

        public CapturingLogger Logger { get; }

        public void Dispose() => _db.Dispose();
    }

    /// <summary>A <see cref="PulseDbContext"/> whose <c>SaveChangesAsync</c> throws the injected fault.</summary>
    private sealed class FaultyDbContext : PulseDbContext
    {
        private readonly Exception? _saveFailure;

        public FaultyDbContext(
            DbContextOptions<PulseDbContext> options,
            IExerciseContext exerciseContext,
            Exception? saveFailure)
            : base(options, exerciseContext)
        {
            _saveFailure = saveFailure;
        }

        public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default) =>
            _saveFailure is null
                ? base.SaveChangesAsync(cancellationToken)
                : Task.FromException<int>(_saveFailure);
    }

    /// <summary>One captured log record.</summary>
    private sealed record LogEntry(LogLevel Level, string Message, Exception? Exception);

    /// <summary>An <see cref="ILogger{T}"/> that records what was logged, so the loud path is asserted, not assumed.</summary>
    private sealed class CapturingLogger : ILogger<EngineReviewService>
    {
        public List<LogEntry> Entries { get; } = [];

        public IDisposable BeginScope<TState>(TState state)
            where TState : notnull => NullLogger.Instance.BeginScope(state);

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            ArgumentNullException.ThrowIfNull(formatter);
            Entries.Add(new LogEntry(logLevel, formatter(state, exception), exception));
        }
    }
}
