namespace Pulse.WebApi.Tests.Features.Channels.Alerts;

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;
using Pulse.WebApi.Data.Entities;
using Pulse.WebApi.Features.Channels.Alerts;
using Pulse.WebApi.Features.Channels.Contracts;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.Identity.Staff;
using Pulse.WebApi.Features.Realtime;
using Pulse.WebApi.Features.Social;
using Pulse.WebApi.Tests.Features.EngineRuntime.Clock;
using Pulse.WebApi.Tests.Features.Identity.Staff;

/// <summary>
/// An in-memory harness for the alert source (no Docker): one shared EF in-memory store, a fresh DI scope per call
/// whose settable <see cref="ExerciseContext"/> is the acting exercise, the REAL native exercise clock over a manual
/// wall clock, and recording doubles for the broadcaster and the SOC-072 bridge. Real-SQL translation is covered by
/// <c>AlertEndpointsTests</c>.
/// </summary>
internal sealed class AlertServiceHarness : IDisposable
{
    public static readonly DateTimeOffset ScenarioStart = new(2026, 12, 3, 14, 0, 0, TimeSpan.FromHours(-6));

    private readonly ServiceProvider _root;

    public AlertServiceHarness(bool bridgeEnabled = true)
    {
        Time = new ManualTimeProvider(new DateTimeOffset(2026, 10, 29, 12, 0, 0, TimeSpan.Zero));
        Clock = new ExerciseClockService(Time);
        var databaseName = Guid.NewGuid().ToString();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddScoped<IExerciseContext>(_ => new ExerciseContext());
        services.AddScoped(provider => new PulseDbContext(
            new DbContextOptionsBuilder<PulseDbContext>().UseInMemoryDatabase(databaseName).Options,
            provider.GetRequiredService<IExerciseContext>()));
        services.AddSingleton<IExerciseClock>(Clock);
        services.AddSingleton<TimeProvider>(Time);
        services.AddSingleton(Broadcaster);
        services.AddScoped<IFeedBroadcaster>(provider => provider.GetRequiredService<RecordingAlertBroadcaster>());
        services.AddSingleton(Notifier);
        services.AddSingleton<IPlatformAlertNotifier>(provider => provider.GetRequiredService<RecordingPlatformNotifier>());
        services.AddSingleton<IOptions<ChannelAlertOptions>>(
            Options.Create(new ChannelAlertOptions { PlatformNotificationBridgeEnabled = bridgeEnabled }));
        services.AddScoped<ICurrentStaffSessionAccessor>(_ => new StubCurrentStaffSessionAccessor(
            StaffUserId is { } staff ? new CurrentStaffSession { SessionId = Guid.NewGuid(), StaffUserId = staff } : null));
        services.AddScoped<AlertReader>();
        services.AddScoped<AlertService>();
        services.AddSingleton<AlertExpirySweeper>();
        _root = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });
    }

    public ManualTimeProvider Time { get; }

    public ExerciseClockService Clock { get; }

    public RecordingAlertBroadcaster Broadcaster { get; } = new();

    public RecordingPlatformNotifier Notifier { get; } = new();

    public Guid? StaffUserId { get; set; }

    public AlertExpirySweeper Sweeper => _root.GetRequiredService<AlertExpirySweeper>();

    public static ContentCaller Controller(string human = "staff-1") =>
        new() { Origin = ChannelVocabulary.OriginController, ActingHumanId = human };

    public static AlertRaise Raise(
        string severity = ChannelVocabulary.SeverityEmergency,
        string headline = "Tornado Warning for Fairhaven County",
        string source = ChannelVocabulary.Weather,
        string? expires = null,
        string? href = null,
        Guid? contentId = null) => new()
        {
            Severity = severity,
            Headline = headline,
            SourceChannel = source,
            ExpiresScenarioTime = expires,
            Href = href,
            SourceContentId = contentId,
        };

    /// <summary>Starts an exercise's clock at <see cref="ScenarioStart"/> and returns its id.</summary>
    public Guid StartExercise()
    {
        var exerciseId = Guid.NewGuid();
        Clock.Start(exerciseId, ScenarioStart, TimeZoneInfo.Utc);
        return exerciseId;
    }

    /// <summary>Runs <paramref name="work"/> in a fresh scope acting in <paramref name="exerciseId"/>.</summary>
    public async Task<T> InAsync<T>(Guid? exerciseId, Func<AlertService, AlertReader, Task<T>> work)
    {
        await using var scope = _root.CreateAsyncScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = exerciseId;
        return await work(
            scope.ServiceProvider.GetRequiredService<AlertService>(),
            scope.ServiceProvider.GetRequiredService<AlertReader>());
    }

    /// <summary>A context outside any request, scoped to <paramref name="exerciseId"/> (null = unscoped).</summary>
    public PulseDbContext Db(Guid? exerciseId)
    {
        var scope = _root.CreateScope();
        ((ExerciseContext)scope.ServiceProvider.GetRequiredService<IExerciseContext>()).CurrentExerciseId = exerciseId;
        return scope.ServiceProvider.GetRequiredService<PulseDbContext>();
    }

    public void Dispose() => _root.Dispose();
}

/// <summary>Records every <c>AlertsChanged</c> frame.</summary>
internal sealed class RecordingAlertBroadcaster : IFeedBroadcaster
{
    public List<(Guid ExerciseId, AlertsChangedDto Frame)> Frames { get; } = new();

    public bool Throw { get; set; }

    public Task BroadcastPostAsync(Guid exerciseId, ParticipantPostDto post, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    public Task BroadcastAlertsChangedAsync(
        Guid exerciseId, AlertsChangedDto alerts, CancellationToken cancellationToken = default)
    {
        if (Throw)
        {
            throw new InvalidOperationException("hub down");
        }

        lock (Frames)
        {
            Frames.Add((exerciseId, alerts));
        }

        return Task.CompletedTask;
    }
}

/// <summary>Records every SOC-072 bridge call.</summary>
internal sealed class RecordingPlatformNotifier : IPlatformAlertNotifier
{
    public List<(Guid ExerciseId, AlertDto Alert)> Raised { get; } = new();

    public List<(Guid ExerciseId, string AlertId)> Cleared { get; } = new();

    public bool Throw { get; set; }

    public Task AlertRaisedAsync(Guid exerciseId, AlertDto alert, CancellationToken cancellationToken = default)
    {
        if (Throw)
        {
            throw new InvalidOperationException("notifications down");
        }

        Raised.Add((exerciseId, alert));
        return Task.CompletedTask;
    }

    public Task AlertClearedAsync(Guid exerciseId, string alertId, CancellationToken cancellationToken = default)
    {
        Cleared.Add((exerciseId, alertId));
        return Task.CompletedTask;
    }
}
