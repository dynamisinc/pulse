namespace Pulse.WebApi.Features.WhiteNoise;

using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;

/// <summary>
/// The white-noise pacer (DF-12): a hosted service that releases pool posts for every exercise whose level is not
/// <c>off</c>, at 0 / 2 / 6 / 15 posts per minute with ±40 % jitter on each gap, so the feed keeps its background
/// chatter whether or not a console is open.
/// </summary>
/// <remarks>
/// <para>
/// <b>Scope for a non-request caller (COR-001), the <c>InjectBurstRunner</c> pattern.</b> A trusted sweep reads only
/// the ids of exercises that have a pool (<c>IgnoreQueryFilters</c> on <c>NoisePosts</c>, ids only; an exercise
/// without a pool has nothing to post). Each exercise is then worked inside its OWN DI scope whose
/// <see cref="ExerciseContext.CurrentExerciseId"/> is set BEFORE <see cref="WhiteNoiseService"/> (and with it
/// <see cref="PulseDbContext"/> and the post funnel) is resolved, so every read and write is confined to that exercise
/// and a pool entry never crosses into another.
/// </para>
/// <para>
/// <b>Stops (DF-13).</b> Nothing posts while the pause tier is <see cref="PauseTier.Freeze"/> or the exercise clock is
/// frozen or not running; <c>Pause injects</c> and <c>Engine paused</c> do not stop noise. A stop drops the
/// exercise's timetable; on the next tick after it clears a new timetable starts one gap later.
/// </para>
/// <para>
/// <b>Restart.</b> The level is persisted on the exercise; the timetable is in memory. After a restart the first sweep
/// finds the persisted level and starts a fresh timetable one gap out: no catch-up burst for the downtime.
/// </para>
/// <para>
/// <b>Fault isolation per exercise.</b> One exercise's failure is logged (once per distinct failure) and its timetable
/// moves on a gap; every other exercise still ticks. A failing sweep backs off, doubling to
/// <see cref="WhiteNoisePacerOptions.MaxFailureBackoff"/>.
/// </para>
/// <para>
/// <b>Testable without sleeping.</b> <see cref="RunTickAsync"/> is one tick; tests call it directly with a
/// hand-advanced <see cref="TimeProvider"/> and a pinned <see cref="INoiseJitterSource"/>.
/// </para>
/// </remarks>
public sealed partial class WhiteNoisePacer : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly PauseTierRegistry _pauseTiers;
    private readonly IExerciseClock _clock;
    private readonly TimeProvider _timeProvider;
    private readonly WhiteNoisePacerOptions _options;
    private readonly NoiseScheduler _scheduler;
    private readonly ILogger<WhiteNoisePacer> _logger;

    // The failure last logged per exercise, so a poisoned exercise is logged once, not every tick.
    private readonly ConcurrentDictionary<Guid, string> _exerciseFailures = new();

    /// <summary>Creates the pacer.</summary>
    /// <param name="scopeFactory">Creates the sweep scope and one scope per exercise.</param>
    /// <param name="pauseTiers">The in-memory pause tiers.</param>
    /// <param name="clock">The exercise clock.</param>
    /// <param name="timeProvider">The server clock driving the timetable.</param>
    /// <param name="jitter">The jitter draws.</param>
    /// <param name="options">The tick cadence.</param>
    /// <param name="logger">Diagnostics.</param>
    public WhiteNoisePacer(
        IServiceScopeFactory scopeFactory,
        PauseTierRegistry pauseTiers,
        IExerciseClock clock,
        TimeProvider timeProvider,
        INoiseJitterSource jitter,
        WhiteNoisePacerOptions options,
        ILogger<WhiteNoisePacer> logger)
    {
        ArgumentNullException.ThrowIfNull(scopeFactory);
        ArgumentNullException.ThrowIfNull(pauseTiers);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(jitter);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(logger);

        _scopeFactory = scopeFactory;
        _pauseTiers = pauseTiers;
        _clock = clock;
        _timeProvider = timeProvider;
        _options = options;
        _scheduler = new NoiseScheduler(jitter);
        _logger = logger;
    }

    /// <summary>The in-memory timetable (exposed for tests and diagnostics).</summary>
    public NoiseScheduler Scheduler => _scheduler;

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Never run inline in the host's start-up, and never sweep during it: the first sweep waits
        // FirstSweepDelay (the InjectBurstRunner pattern), so a host that is starting — every WebApplicationFactory
        // fixture included — does no database work on the pacer's behalf.
        await Task.Yield();

        var delay = _options.FirstSweepDelay;
        var consecutiveFailures = 0;
        string? lastLoggedFailure = null;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(delay, _timeProvider, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }

            try
            {
                await RunTickAsync(stoppingToken).ConfigureAwait(false);
                if (consecutiveFailures > 0)
                {
                    LogTickRecovered(consecutiveFailures);
                }

                consecutiveFailures = 0;
                lastLoggedFailure = null;
                delay = _options.TickInterval;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
#pragma warning disable CA1031 // A transient failure (e.g. the database briefly unreachable) must not stop the pacer.
            catch (Exception ex)
            {
                consecutiveFailures++;
                var signature = FailureSignature(ex);
                if (!string.Equals(signature, lastLoggedFailure, StringComparison.Ordinal))
                {
                    LogTickFailed(ex, consecutiveFailures);
                    lastLoggedFailure = signature;
                }

                delay = BackoffDelay(consecutiveFailures, _options);
            }
#pragma warning restore CA1031
        }
    }

    /// <summary>
    /// The wait after <paramref name="consecutiveFailures"/> failed sweeps in a row: the tick interval doubled per
    /// further failure, capped at <see cref="WhiteNoisePacerOptions.MaxFailureBackoff"/>.
    /// </summary>
    /// <param name="consecutiveFailures">Failed sweeps in a row (at least 1).</param>
    /// <param name="options">The cadence.</param>
    /// <returns>The wait.</returns>
    public static TimeSpan BackoffDelay(int consecutiveFailures, WhiteNoisePacerOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        var tick = options.TickInterval;
        var cap = options.MaxFailureBackoff > tick ? options.MaxFailureBackoff : tick;
        var ticks = tick.Ticks * Math.Pow(2, Math.Clamp(consecutiveFailures - 1, 0, 30));
        return ticks >= cap.Ticks ? cap : TimeSpan.FromTicks((long)ticks);
    }

    /// <summary>
    /// One tick: finds the exercises with a pool, then, for each that is making noise, is not stopped and is due,
    /// publishes one post inside that exercise's own scope. A failure on one exercise never stops the rest.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>How many noise posts this tick published.</returns>
    public async Task<int> RunTickAsync(CancellationToken cancellationToken = default)
    {
        IReadOnlyList<Guid> exercises;
        await using (var sweepScope = _scopeFactory.CreateAsyncScope())
        {
            var dbContext = sweepScope.ServiceProvider.GetRequiredService<PulseDbContext>();

            // Trusted server-side sweep across exercises: ids only, each then processed within its own scope.
            exercises = await dbContext.NoisePosts
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Select(entry => entry.ExerciseId)
                .Distinct()
                .OrderBy(exerciseId => exerciseId)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        _scheduler.Retain(exercises.ToList());
        foreach (var failed in _exerciseFailures.Keys)
        {
            if (!exercises.Contains(failed))
            {
                _exerciseFailures.TryRemove(failed, out _);
            }
        }

        var published = 0;
        foreach (var exerciseId in exercises)
        {
            if (exerciseId == Guid.Empty)
            {
                continue;
            }

            // In-memory stop check first: a frozen or stopped exercise costs no database work.
            if (WhiteNoiseService.IsTierOrClockStopped(_pauseTiers, _clock, exerciseId))
            {
                _scheduler.IsDue(exerciseId, NoiseRates.Off, stopped: true, _timeProvider.GetUtcNow());
                continue;
            }

            try
            {
                if (await TickExerciseAsync(exerciseId, cancellationToken).ConfigureAwait(false))
                {
                    published++;
                }

                _exerciseFailures.TryRemove(exerciseId, out _);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
#pragma warning disable CA1031 // One exercise's fault must not stop the pacer for any other exercise.
            catch (Exception ex)
            {
                // Move the timetable on, so a failing exercise is retried a gap later rather than every tick.
                _scheduler.Advance(exerciseId, _timeProvider.GetUtcNow());

                var signature = FailureSignature(ex);
                if (!_exerciseFailures.TryGetValue(exerciseId, out var logged)
                    || !string.Equals(logged, signature, StringComparison.Ordinal))
                {
                    LogExerciseTickFailed(ex, exerciseId);
                    _exerciseFailures[exerciseId] = signature;
                }
            }
#pragma warning restore CA1031
        }

        return published;
    }

    private async Task<bool> TickExerciseAsync(Guid exerciseId, CancellationToken cancellationToken)
    {
        // A fresh scope per exercise: each owns a clean unit of work, so one exercise's fault cannot leave tracked
        // state behind for the next.
        await using var scope = _scopeFactory.CreateAsyncScope();

        // Set the server-authoritative scope BEFORE resolving anything that captures it (PulseDbContext reads it in
        // its constructor) — never a client value (COR-001).
        if (scope.ServiceProvider.GetRequiredService<IExerciseContext>() is ExerciseContext exerciseContext)
        {
            exerciseContext.CurrentExerciseId = exerciseId;
        }
        else
        {
            throw new InvalidOperationException(
                "The registered IExerciseContext is not settable; the white-noise pacer cannot establish its scope (COR-001).");
        }

        var service = scope.ServiceProvider.GetRequiredService<WhiteNoiseService>();
        var facts = await service.ReadPacingFactsAsync(cancellationToken).ConfigureAwait(false);

        // A lifecycle that is not staged or live (EndEx, a lifecycle pause) stops noise like a Freeze: the timetable is
        // dropped, so the first post after it clears is one gap out.
        var now = _timeProvider.GetUtcNow();
        if (!_scheduler.IsDue(exerciseId, facts?.Level ?? NoiseRates.Off, stopped: facts is { LifecycleMakingNoise: false }, now))
        {
            return false;
        }

        var outcome = await service.PublishNextAsync(cancellationToken).ConfigureAwait(false);
        _scheduler.Advance(exerciseId, now);
        return outcome == NoisePublishOutcome.Posted;
    }

    /// <summary>What makes two failures "the same" for logging: the exception type and message.</summary>
    private static string FailureSignature(Exception exception) =>
        $"{exception.GetType().FullName}: {exception.Message}";

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "White-noise pacer sweep failed ({ConsecutiveFailures} in a row); backing off. The same failure is not logged again until it changes or a sweep succeeds.")]
    private partial void LogTickFailed(Exception exception, int consecutiveFailures);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Error,
        Message = "White-noise pacer failed for exercise {ExerciseId}; every other exercise was unaffected. The same failure is not logged again.")]
    private partial void LogExerciseTickFailed(Exception exception, Guid exerciseId);

    [LoggerMessage(
        EventId = 3,
        Level = LogLevel.Information,
        Message = "White-noise pacer recovered after {FailedSweeps} failed sweeps.")]
    private partial void LogTickRecovered(int failedSweeps);
}

/// <summary>The <see cref="WhiteNoisePacer"/> cadence.</summary>
public sealed class WhiteNoisePacerOptions
{
    /// <summary>
    /// The wall-clock heartbeat between sweeps. Default 1 s: well under the shortest gap (2.4 s at High), and each
    /// next due time is measured from the previous due time, so the tick never erodes the rate.
    /// </summary>
    public TimeSpan TickInterval { get; init; } = TimeSpan.FromSeconds(1);

    /// <summary>
    /// The wait before the FIRST sweep after start-up. Default 5 s (as <c>InjectBurstRunner</c>'s idle-first wait):
    /// a restart resumes noise a few seconds later, and a starting host does no database work for the pacer.
    /// </summary>
    public TimeSpan FirstSweepDelay { get; init; } = TimeSpan.FromSeconds(5);

    /// <summary>The longest wait between sweeps while sweeps keep failing. Default 60 s.</summary>
    public TimeSpan MaxFailureBackoff { get; init; } = TimeSpan.FromSeconds(60);
}
