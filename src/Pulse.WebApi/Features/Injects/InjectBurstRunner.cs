namespace Pulse.WebApi.Features.Injects;

using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime.Steering;

/// <summary>
/// The server-side burst pacer (IQ-4): a hosted service that publishes each <c>firing</c> item's next due post, so a
/// released pile-on keeps going when every console is closed.
/// </summary>
/// <remarks>
/// <para>
/// <b>Scope for a non-request caller (COR-001), the <c>EngineReviewTickHost</c> pattern.</b> A trusted server-side
/// sweep reads only the <c>(ExerciseId, Id)</c> pairs of firing items across exercises (<c>IgnoreQueryFilters</c>,
/// ids only — no content leaves it). Each item is then worked inside its OWN DI scope whose
/// <see cref="ExerciseContext.CurrentExerciseId"/> is set BEFORE <see cref="InjectQueueService"/> (and with it
/// <see cref="PulseDbContext"/> and the ingest funnel) is resolved, so every read and write is confined to that
/// exercise by the central filter and write guard.
/// </para>
/// <para>
/// <b>Fault isolation per ITEM (M4).</b> One poisoned item — unreadable media JSON, a non-concurrency database error —
/// is logged and skipped; every other item, in its exercise or any other, still advances. The sweep has a
/// deterministic order (exercise, queue order, id), so a poisoned item cannot make the order of the rest wander. The
/// same failure on the same item is logged once, not once per tick.
/// </para>
/// <para>
/// <b>Cadence (L6).</b> One tick every <see cref="InjectBurstRunnerOptions.ActiveInterval"/> (1 s) while anything is
/// firing — at most one post per burst per tick keeps the feed legible (SOC-071) — and every
/// <see cref="InjectBurstRunnerOptions.IdleInterval"/> (5 s) otherwise. A controller action that starts or resumes a
/// burst wakes the runner through <see cref="InjectRunnerSignal"/>, so the idle sleep never delays a burst's second
/// post (its first goes out inline in the Fire request).
/// </para>
/// <para>
/// <b>No database work while the host starts.</b> The loop WAITS before it sweeps: the first sweep runs one
/// <see cref="InjectBurstRunnerOptions.IdleInterval"/> after start (or at the first wake-up), never inside start-up. A
/// sweep at the instant the host came up competed with whatever else was starting — in the test suite, the SignalR hub
/// tests' own connection, against an unreachable placeholder database — and bought nothing: a restart resumes firing
/// bursts within the idle interval, at their original spacing (the lateness rule).
/// </para>
/// <para>
/// <b>A failing sweep backs off.</b> While the database is unreachable each failed sweep doubles the wait, from the idle
/// interval up to <see cref="InjectBurstRunnerOptions.MaxFailureBackoff"/> (a wake-up still cuts it short), and a
/// repeat of the same failure is not logged again until the failure changes or a sweep succeeds.
/// </para>
/// <para>
/// <b>Pause tiers (IQ-5).</b> Under PAUSE INJECTS or FREEZE an exercise's bursts publish nothing; ENGINE PAUSED has no
/// effect. The tier is the in-memory <see cref="PauseTierRegistry"/>, which reads RUNNING after a restart — and the
/// lateness rule then resumes each burst at its original spacing rather than dumping what came due while down.
/// </para>
/// <para>
/// <b>Exactly once across instances (IQ-9).</b> Each post is claimed under the item's version before the funnel is
/// called, so a second instance ticking the same item loses the claim and does nothing.
/// </para>
/// <para>
/// <b>Testable without sleeping.</b> <see cref="RunTickAsync"/> is one tick; tests call it directly with a hand-advanced
/// <see cref="TimeProvider"/>. The loop around it only adds the cadence, the wake-up and the resilience.
/// </para>
/// </remarks>
public sealed partial class InjectBurstRunner : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly PauseTierRegistry _pauseTiers;
    private readonly TimeProvider _timeProvider;
    private readonly InjectRunnerSignal _signal;
    private readonly InjectBurstRunnerOptions _options;
    private readonly ILogger<InjectBurstRunner> _logger;

    // The failure last logged for each item that is failing, so a poisoned item is logged once, not every tick.
    private readonly ConcurrentDictionary<Guid, string> _itemFailures = new();

    /// <summary>Creates the runner.</summary>
    /// <param name="scopeFactory">Creates the sweep scope and one scope per item.</param>
    /// <param name="pauseTiers">The in-memory tiered-pause state (IQ-5).</param>
    /// <param name="timeProvider">The server clock driving the cadence.</param>
    /// <param name="signal">The wake-up line the queue service pokes when a burst starts or resumes.</param>
    /// <param name="options">The active and idle cadences.</param>
    /// <param name="logger">Diagnostics logger.</param>
    public InjectBurstRunner(
        IServiceScopeFactory scopeFactory,
        PauseTierRegistry pauseTiers,
        TimeProvider timeProvider,
        InjectRunnerSignal signal,
        InjectBurstRunnerOptions options,
        ILogger<InjectBurstRunner> logger)
    {
        ArgumentNullException.ThrowIfNull(scopeFactory);
        ArgumentNullException.ThrowIfNull(pauseTiers);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(signal);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(logger);

        _scopeFactory = scopeFactory;
        _pauseTiers = pauseTiers;
        _timeProvider = timeProvider;
        _signal = signal;
        _options = options;
        _logger = logger;
    }

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Never run inline in the host's start-up, and never sweep during it: the first sweep waits one idle interval
        // (or a wake-up), so a host that is starting does no database work on the runner's behalf.
        await Task.Yield();

        var delay = _options.IdleInterval;
        var consecutiveFailures = 0;
        string? lastLoggedFailure = null;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await _signal.WaitAsync(delay, _timeProvider, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }

            try
            {
                var firing = await RunTickAsync(stoppingToken).ConfigureAwait(false);
                if (consecutiveFailures > 0)
                {
                    LogTickRecovered(consecutiveFailures);
                }

                consecutiveFailures = 0;
                lastLoggedFailure = null;
                delay = NextDelay(firing, consecutiveFailures, _options);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
#pragma warning disable CA1031 // A transient failure (e.g. the database briefly unreachable) must not stop pacing.
            catch (Exception ex)
            {
                consecutiveFailures++;
                var signature = FailureSignature(ex);
                if (!string.Equals(signature, lastLoggedFailure, StringComparison.Ordinal))
                {
                    LogTickFailed(ex, consecutiveFailures);
                    lastLoggedFailure = signature;
                }

                delay = NextDelay(firing: 0, consecutiveFailures, _options);
            }
#pragma warning restore CA1031
        }
    }

    /// <summary>
    /// The wait before the next sweep: <see cref="InjectBurstRunnerOptions.ActiveInterval"/> while anything is firing,
    /// <see cref="InjectBurstRunnerOptions.IdleInterval"/> otherwise — and after <paramref name="consecutiveFailures"/>
    /// failed sweeps in a row, the idle interval doubled per further failure (idle, 2x, 4x, ...), never less than the
    /// idle interval and never more than <see cref="InjectBurstRunnerOptions.MaxFailureBackoff"/>.
    /// </summary>
    /// <param name="firing">How many firing items the last successful sweep found.</param>
    /// <param name="consecutiveFailures">How many sweeps in a row have failed (0 after a success).</param>
    /// <param name="options">The cadences.</param>
    /// <returns>How long to wait (a wake-up still cuts it short).</returns>
    public static TimeSpan NextDelay(int firing, int consecutiveFailures, InjectBurstRunnerOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);

        if (consecutiveFailures <= 0)
        {
            return firing > 0 ? options.ActiveInterval : options.IdleInterval;
        }

        var idle = options.IdleInterval;
        var cap = options.MaxFailureBackoff > idle ? options.MaxFailureBackoff : idle;
        var backoffTicks = idle.Ticks * Math.Pow(2, Math.Min(consecutiveFailures - 1, 30));
        return backoffTicks >= cap.Ticks ? cap : TimeSpan.FromTicks((long)backoffTicks);
    }

    /// <summary>
    /// One tick: discovers the firing items, then advances each (at most one post per item) inside its exercise's own
    /// scope. A failure on one item never stops the tick for the rest.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>How many firing items the sweep found (the loop uses it to pick its cadence).</returns>
    public async Task<int> RunTickAsync(CancellationToken cancellationToken = default)
    {
        IReadOnlyList<FiringItem> firing;
        await using (var sweepScope = _scopeFactory.CreateAsyncScope())
        {
            var dbContext = sweepScope.ServiceProvider.GetRequiredService<PulseDbContext>();

            // Trusted server-side sweep across exercises: ids only, each then processed within its own scope. A fixed
            // order keeps the processing order stable from tick to tick.
            firing = await dbContext.InjectItems
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(item => item.Status == InjectStatuses.Firing && item.DeletedAt == null)
                .OrderBy(item => item.ExerciseId)
                .ThenBy(item => item.Order)
                .ThenBy(item => item.Id)
                .Select(item => new FiringItem(item.ExerciseId, item.Id))
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        // Forget failures of items that are no longer firing (settled, held, deleted), so the map cannot grow.
        foreach (var failedItem in _itemFailures.Keys)
        {
            if (!firing.Any(item => item.ItemId == failedItem))
            {
                _itemFailures.TryRemove(failedItem, out _);
            }
        }

        foreach (var item in firing)
        {
            if (item.ExerciseId == Guid.Empty
                || _pauseTiers.GetTier(item.ExerciseId) is PauseTier.Injects or PauseTier.Freeze)
            {
                continue;
            }

            try
            {
                await AdvanceItemAsync(item, cancellationToken).ConfigureAwait(false);
                _itemFailures.TryRemove(item.ItemId, out _);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
#pragma warning disable CA1031 // One item's fault must not stop pacing for any other item.
            catch (Exception ex)
            {
                var signature = FailureSignature(ex);
                if (!_itemFailures.TryGetValue(item.ItemId, out var logged)
                    || !string.Equals(logged, signature, StringComparison.Ordinal))
                {
                    LogItemTickFailed(ex, item.ExerciseId, item.ItemId);
                    _itemFailures[item.ItemId] = signature;
                }
            }
#pragma warning restore CA1031
        }

        return firing.Count;
    }

    /// <summary>What makes two failures "the same" for logging: the exception type and message.</summary>
    private static string FailureSignature(Exception exception) =>
        $"{exception.GetType().FullName}: {exception.Message}";

    private async Task AdvanceItemAsync(FiringItem item, CancellationToken cancellationToken)
    {
        // A fresh scope per item: each step owns a clean unit of work, so one item's conflict or fault cannot leave
        // tracked state behind for the next.
        await using var scope = _scopeFactory.CreateAsyncScope();

        // Set the server-authoritative scope BEFORE resolving anything that captures it (PulseDbContext reads it in
        // its constructor) — never a client value (COR-001).
        if (scope.ServiceProvider.GetRequiredService<IExerciseContext>() is ExerciseContext exerciseContext)
        {
            exerciseContext.CurrentExerciseId = item.ExerciseId;
        }
        else
        {
            throw new InvalidOperationException(
                "The registered IExerciseContext is not settable; the inject burst runner cannot establish its scope (COR-001).");
        }

        var queue = scope.ServiceProvider.GetRequiredService<InjectQueueService>();
        await queue.AdvanceAsync(item.ItemId, cancellationToken).ConfigureAwait(false);
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Inject burst runner sweep failed ({ConsecutiveFailures} in a row); backing off. The same failure is not logged again until it changes or a sweep succeeds.")]
    private partial void LogTickFailed(Exception exception, int consecutiveFailures);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Error,
        Message = "Inject burst runner failed to advance item {ItemId} of exercise {ExerciseId}; every other item was unaffected. The same failure on this item is not logged again.")]
    private partial void LogItemTickFailed(Exception exception, Guid exerciseId, Guid itemId);

    [LoggerMessage(
        EventId = 3,
        Level = LogLevel.Information,
        Message = "Inject burst runner recovered after {FailedSweeps} failed sweeps.")]
    private partial void LogTickRecovered(int failedSweeps);

    /// <summary>A firing item found by the discovery sweep — ids only.</summary>
    private sealed record FiringItem(Guid ExerciseId, Guid ItemId);
}

/// <summary>The <see cref="InjectBurstRunner"/> cadences (L6).</summary>
public sealed class InjectBurstRunnerOptions
{
    /// <summary>Tick period while anything is firing: one post per burst per tick (SOC-071). Default 1 s.</summary>
    public TimeSpan ActiveInterval { get; init; } = TimeSpan.FromSeconds(1);

    /// <summary>
    /// Tick period while nothing is firing — and the wait before the FIRST sweep after start-up; a wake-up cuts it
    /// short. Default 5 s.
    /// </summary>
    public TimeSpan IdleInterval { get; init; } = TimeSpan.FromSeconds(5);

    /// <summary>
    /// The longest wait between sweeps while sweeps keep failing (the wait doubles from <see cref="IdleInterval"/> per
    /// failure up to this). Default 60 s.
    /// </summary>
    public TimeSpan MaxFailureBackoff { get; init; } = TimeSpan.FromSeconds(60);
}
