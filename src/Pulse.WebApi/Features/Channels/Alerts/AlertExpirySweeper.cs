namespace Pulse.WebApi.Features.Channels.Alerts;

using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Data;

/// <summary>
/// Expires alerts across exercises when their scenario-time expiry passes (channels-foundation story 10), with the
/// scoped-background pattern of <c>InjectBurstRunner</c>: a trusted discovery read of exercise ids only
/// (<c>IgnoreQueryFilters</c>, no alert content leaves it), then each exercise worked inside its OWN DI scope whose
/// <see cref="ExerciseContext.CurrentExerciseId"/> is set BEFORE <see cref="AlertService"/> (and with it
/// <see cref="PulseDbContext"/>) is resolved, so every read and write is confined to that exercise.
/// </summary>
/// <remarks>
/// Scenario time differs per exercise (and stands still while frozen, leaps on a jump), so the discovery read cannot
/// decide "due"; it finds the exercises that have ANY uncleared alert with an expiry, and
/// <see cref="AlertService.ExpireDueAsync"/> applies the scenario-time rule in scope. <c>GET /api/alerts</c> applies
/// the same rule itself, so the sweep only has to stamp the row and push <c>AlertsChanged</c>; a sweep that runs late
/// never shows a participant an expired alert on a fresh read.
/// </remarks>
public sealed partial class AlertExpirySweeper : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly TimeProvider _timeProvider;
    private readonly ChannelAlertOptions _options;
    private readonly ILogger<AlertExpirySweeper> _logger;

    // The last failure logged per exercise, so a persistent fault is logged once, not every sweep.
    private readonly ConcurrentDictionary<Guid, string> _exerciseFailures = new();

    /// <summary>Creates the sweep.</summary>
    /// <param name="scopeFactory">Creates the per-exercise scopes.</param>
    /// <param name="timeProvider">The server wall clock (paces the loop only).</param>
    /// <param name="options">The cadences.</param>
    /// <param name="logger">Diagnostics logger.</param>
    public AlertExpirySweeper(
        IServiceScopeFactory scopeFactory,
        TimeProvider timeProvider,
        IOptions<ChannelAlertOptions> options,
        ILogger<AlertExpirySweeper> logger)
    {
        ArgumentNullException.ThrowIfNull(scopeFactory);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(logger);

        _scopeFactory = scopeFactory;
        _timeProvider = timeProvider;
        _options = options.Value;
        _logger = logger;
    }

    /// <summary>
    /// One sweep: finds the exercises with an uncleared, expiring alert and expires what is due in each, inside that
    /// exercise's own scope. One exercise's fault never stops the sweep for the rest.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>How many alerts expired across all exercises.</returns>
    public async Task<int> SweepAsync(CancellationToken cancellationToken = default)
    {
        List<Guid> exerciseIds;
        await using (var discoveryScope = _scopeFactory.CreateAsyncScope())
        {
            var dbContext = discoveryScope.ServiceProvider.GetRequiredService<PulseDbContext>();

            // Trusted server-side discovery across exercises: exercise ids only, each then processed in its own scope.
            exerciseIds = await dbContext.ChannelAlerts
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(alert => alert.ClearedScenarioTime == null
                    && alert.ExpiresScenarioTime != null
                    && alert.DeletedAt == null
                    && alert.ExerciseId != Guid.Empty)
                .Select(alert => alert.ExerciseId)
                .Distinct()
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        // Forget failures of exercises that no longer have anything to expire, so the map cannot grow.
        foreach (var failed in _exerciseFailures.Keys)
        {
            if (!exerciseIds.Contains(failed))
            {
                _exerciseFailures.TryRemove(failed, out _);
            }
        }

        var expired = 0;
        foreach (var exerciseId in exerciseIds)
        {
            try
            {
                expired += await ExpireInScopeAsync(exerciseId, cancellationToken).ConfigureAwait(false);
                _exerciseFailures.TryRemove(exerciseId, out _);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
#pragma warning disable CA1031 // One exercise's fault must not stop expiry for any other exercise.
            catch (Exception ex)
            {
                var signature = $"{ex.GetType().FullName}: {ex.Message}";
                if (!_exerciseFailures.TryGetValue(exerciseId, out var logged)
                    || !string.Equals(logged, signature, StringComparison.Ordinal))
                {
                    LogExerciseSweepFailed(ex, exerciseId);
                    _exerciseFailures[exerciseId] = signature;
                }
            }
#pragma warning restore CA1031
        }

        return expired;
    }

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Never sweep inline in the host's start-up: the first sweep waits one interval.
        await Task.Yield();

        var consecutiveFailures = 0;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(NextDelay(consecutiveFailures, _options), _timeProvider, stoppingToken)
                    .ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }

            try
            {
                await SweepAsync(stoppingToken).ConfigureAwait(false);
                consecutiveFailures = 0;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
#pragma warning disable CA1031 // A transient failure (e.g. the database briefly unreachable) must not stop the sweep.
            catch (Exception ex)
            {
                consecutiveFailures++;
                if (consecutiveFailures == 1)
                {
                    LogSweepFailed(ex);
                }
            }
#pragma warning restore CA1031
        }
    }

    /// <summary>
    /// The wait before the next sweep: the interval, doubled per consecutive failure up to
    /// <see cref="ChannelAlertOptions.MaxFailureBackoff"/>.
    /// </summary>
    /// <param name="consecutiveFailures">How many sweeps in a row have failed.</param>
    /// <param name="options">The cadences.</param>
    /// <returns>How long to wait.</returns>
    public static TimeSpan NextDelay(int consecutiveFailures, ChannelAlertOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        var interval = options.SweepInterval > TimeSpan.Zero ? options.SweepInterval : TimeSpan.FromSeconds(5);
        if (consecutiveFailures <= 0)
        {
            return interval;
        }

        var cap = options.MaxFailureBackoff > interval ? options.MaxFailureBackoff : interval;
        var backoffTicks = interval.Ticks * Math.Pow(2, Math.Min(consecutiveFailures - 1, 30));
        return backoffTicks >= cap.Ticks ? cap : TimeSpan.FromTicks((long)backoffTicks);
    }

    private async Task<int> ExpireInScopeAsync(Guid exerciseId, CancellationToken cancellationToken)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();

        // Set the server-authoritative scope BEFORE resolving anything that captures it (PulseDbContext reads it in its
        // constructor) — never a client value (COR-001).
        if (scope.ServiceProvider.GetRequiredService<IExerciseContext>() is ExerciseContext exerciseContext)
        {
            exerciseContext.CurrentExerciseId = exerciseId;
        }
        else
        {
            throw new InvalidOperationException(
                "The registered IExerciseContext is not settable; the alert expiry sweep cannot establish its scope (COR-001).");
        }

        var alerts = scope.ServiceProvider.GetRequiredService<AlertService>();
        return await alerts.ExpireDueAsync(cancellationToken).ConfigureAwait(false);
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Alert expiry sweep failed; backing off. Not logged again until a sweep succeeds.")]
    private partial void LogSweepFailed(Exception exception);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Error,
        Message = "Alert expiry sweep failed for exercise {ExerciseId}; every other exercise was unaffected. The same failure is not logged again.")]
    private partial void LogExerciseSweepFailed(Exception exception, Guid exerciseId);
}
