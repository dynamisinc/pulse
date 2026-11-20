namespace Pulse.WebApi.Tests.Features.Channels.Scheduling;

using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging.Abstractions;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels;
using Pulse.WebApi.Features.Channels.Content.Scheduling;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Tests.Data;
using Pulse.WebApi.Tests.Features.Channels.Publish;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Xunit;

/// <summary>
/// Story 05's "exactly once" against REAL SQL Server: two runner instances see the same due item, the first is parked
/// mid-publish while the second publishes it, and the first then loses the <c>Version</c> claim. The in-memory provider
/// has no transactions, so only here does the loser's telemetry row roll back with its refused state change.
/// </summary>
[Collection(MsSqlCollection.Name)]
public sealed class ContentScheduleRunnerSqlTests
{
    private readonly MsSqlContainerFixture _fixture;

    public ContentScheduleRunnerSqlTests(MsSqlContainerFixture fixture) => _fixture = fixture;

    [RequiresDockerFact]
    public async Task TwoInstancesSeeingTheSameDueItem_PublishOnce_WithExactlyOneEventAndOneBroadcast()
    {
        var exerciseId = Guid.NewGuid();
        var scenarioStart = new DateTimeOffset(2033, 9, 4, 8, 0, 0, TimeSpan.Zero);
        var outlet = ChannelRows.Outlet(exerciseId);
        var item = ChannelRows.ContentItem(exerciseId, outlet.Id);
        item.Status = ChannelVocabulary.StatusScheduled;
        item.ScheduledScenarioTime = scenarioStart.AddMinutes(10);
        item.Version = 1;
        item.CreatedScenarioTime = scenarioStart; // drafted before its 08:10 schedule (the stamp floor, W-001)
        await using (var seed = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId }))
        {
            seed.Exercises.Add(new Exercise
            {
                OrganizationId = Organization.DefaultOrganizationId,
                Id = exerciseId,
                Name = "Scheduled exactly once",
                TimeZone = "UTC",
                Status = "live",
            });
            seed.Outlets.Add(outlet);
            seed.ContentItems.Add(item);
            await seed.SaveChangesAsync();
        }

        var time = new ManualTimeProvider(DateTimeOffset.UtcNow);
        var clock = new ExerciseClockService(time);
        clock.Start(exerciseId, scenarioStart, TimeZoneInfo.Utc);
        clock.Jump(exerciseId, 30);
        var broadcaster = new RecordingBroadcaster();
        var parkFirst = new ParkFirstGate();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<TimeProvider>(time);
        services.AddSingleton<IExerciseClock>(clock);
        services.AddScoped<ExerciseContext>();
        services.AddScoped<IExerciseContext>(provider => provider.GetRequiredService<ExerciseContext>());
        services.AddScoped<OrganizationContext>();
        services.AddScoped<IOrganizationContext>(provider => provider.GetRequiredService<OrganizationContext>());
        services.AddDbContext<PulseDbContext>(options => options.UseSqlServer(_fixture.ConnectionString!));
        services.AddSingleton<IFeedBroadcaster>(broadcaster);
        services.AddScoped<IContentKindDescriptor>(_ => new TestKindDescriptor("article", "news", ISanitizerProfileRegistry.RichBasic));
        services.AddSingleton<IContentPublishGate>(parkFirst);
        services.AddChannels();

        // The real alert source needs a staff session this bare container has; the race is about the publish.
        services.RemoveAll<IAlertRaiser>();
        services.AddScoped<IAlertRaiser, FakeAlertRaiser>();
        await using var root = services.BuildServiceProvider();

        var log = new MessageLogger();
        var tiers = new PauseTierRegistry(clock, new NullPauseOverlayPublisher(), NullLogger<PauseTierRegistry>.Instance);
        ContentScheduleRunner Runner() => new(
            root.GetRequiredService<IServiceScopeFactory>(),
            tiers,
            clock,
            time,
            new ContentScheduleSignal(),
            new ContentScheduleRunnerOptions(),
            log);

        var first = Runner().RunTickAsync();
        if (await Task.WhenAny(parkFirst.Entered.Task, first, Task.Delay(TimeSpan.FromSeconds(30))) != parkFirst.Entered.Task)
        {
            parkFirst.Release.TrySetResult();
            throw new Xunit.Sdk.XunitException(
                $"The first tick never reached the parking gate (completed: {first.IsCompleted}). Runner log: {string.Join(" | ", log.Entries)}");
        }
        int second;
        try
        {
            second = await Runner().RunTickAsync();
        }
        finally
        {
            parkFirst.Release.TrySetResult(); // never strand the parked tick, even if the second one throws
        }

        second.Should().Be(1, "the second instance publishes while the first is mid-tick");
        (await first).Should().Be(0, "the first instance loses the Version claim and skips silently");

        broadcaster.Published.Should().ContainSingle();
        await using var read = _fixture.CreateContext(new ExerciseContext { CurrentExerciseId = exerciseId });
        var events = await read.TelemetryEvents.AsNoTracking().Where(e => e.Target!.EntityId == item.Id.ToString()).ToListAsync();
        events.Should().ContainSingle("the loser's event rolled back with its refused state change")
            .Which.EventType.Should().Be(ChannelTelemetryEventTypes.ContentPublished);
        var stored = await read.ContentItems.AsNoTracking().SingleAsync(candidate => candidate.Id == item.Id);
        stored.Status.Should().Be(ChannelVocabulary.StatusPublished);
        stored.PublishedScenarioTime.Should().Be(item.ScheduledScenarioTime, "its own scheduled time, not the jump target");
        stored.LastError.Should().BeNull();
    }

    /// <summary>Keeps every runner log line with its exception, so a race test that stalls says why.</summary>
    private sealed class MessageLogger : Microsoft.Extensions.Logging.ILogger<ContentScheduleRunner>
    {
        private readonly System.Collections.Concurrent.ConcurrentQueue<string> _entries = new();

        public System.Collections.Generic.IReadOnlyCollection<string> Entries => _entries;

        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull => null;

        public bool IsEnabled(Microsoft.Extensions.Logging.LogLevel logLevel) => true;

        public void Log<TState>(
            Microsoft.Extensions.Logging.LogLevel logLevel,
            Microsoft.Extensions.Logging.EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter) =>
            _entries.Enqueue($"{logLevel}: {formatter(state, exception)} {exception}");
    }

    /// <summary>Parks the FIRST publish evaluation until released (to stage two instances racing); passes the rest.</summary>
    private sealed class ParkFirstGate : IContentPublishGate
    {
        private int _calls;

        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public async Task<ContentPublishGateDecision> EvaluateAsync(
            ContentItem item, PublishContext context, CancellationToken cancellationToken = default)
        {
            if (Interlocked.Increment(ref _calls) == 1)
            {
                Entered.TrySetResult();
                await Release.Task;
            }

            return ContentPublishGateDecision.Allow();
        }
    }
}
