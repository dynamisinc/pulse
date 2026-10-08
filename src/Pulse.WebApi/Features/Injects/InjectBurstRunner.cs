namespace Pulse.WebApi.Features.Injects;

using System.Collections.Generic;
using System.Linq;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Pulse.WebApi.Data;
using Pulse.WebApi.Features.EngineRuntime.Steering;

/// <summary>
/// The server-side burst pacer (IQ-4): a hosted service that ticks about once a second and publishes each
/// <c>firing</c> item's next due post, so a released pile-on keeps going when every console is closed.
/// </summary>
/// <remarks>
/// <para>
/// <b>Scope for a non-request caller (COR-001), the <c>EngineReviewTickHost</c> pattern.</b> A trusted server-side
/// sweep reads only the <c>(ExerciseId, Id)</c> pairs of firing items across exercises (<c>IgnoreQueryFilters</c>,
/// ids only — no content leaves it). Each exercise is then worked inside its OWN DI scope whose
/// <see cref="ExerciseContext.CurrentExerciseId"/> is set BEFORE <see cref="InjectQueueService"/> (and with it
/// <see cref="PulseDbContext"/> and the ingest funnel) is resolved, so every read and write is confined to that
/// exercise by the central filter and write guard.
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
/// <see cref="TimeProvider"/>. The loop around it only adds the period and the resilience.
/// </para>
/// </remarks>
public sealed partial class InjectBurstRunner : BackgroundService
{
    /// <summary>The tick period: one post per burst per tick keeps the feed legible (SOC-071).</summary>
    public static readonly TimeSpan TickInterval = TimeSpan.FromSeconds(1);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly PauseTierRegistry _pauseTiers;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger<InjectBurstRunner> _logger;

    /// <summary>Creates the runner.</summary>
    /// <param name="scopeFactory">Creates the sweep scope and one scope per exercise.</param>
    /// <param name="pauseTiers">The in-memory tiered-pause state (IQ-5).</param>
    /// <param name="timeProvider">The server clock driving the tick period.</param>
    /// <param name="logger">Diagnostics logger.</param>
    public InjectBurstRunner(
        IServiceScopeFactory scopeFactory,
        PauseTierRegistry pauseTiers,
        TimeProvider timeProvider,
        ILogger<InjectBurstRunner> logger)
    {
        ArgumentNullException.ThrowIfNull(scopeFactory);
        ArgumentNullException.ThrowIfNull(pauseTiers);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentNullException.ThrowIfNull(logger);

        _scopeFactory = scopeFactory;
        _pauseTiers = pauseTiers;
        _timeProvider = timeProvider;
        _logger = logger;
    }

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TickInterval, _timeProvider);

        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false))
            {
                try
                {
                    await RunTickAsync(stoppingToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
#pragma warning disable CA1031 // A transient failure (e.g. the database briefly unreachable) must not stop pacing.
                catch (Exception ex)
                {
                    LogTickFailed(ex);
                }
#pragma warning restore CA1031
            }
        }
        catch (OperationCanceledException)
        {
            // Normal shutdown — the host is stopping.
        }
    }

    /// <summary>
    /// One tick: discovers the firing items, then advances each exercise's items (at most one post per item) inside
    /// that exercise's own scope. A failure on one exercise never stops the tick for the rest.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task that completes when the tick is done.</returns>
    public async Task RunTickAsync(CancellationToken cancellationToken = default)
    {
        IReadOnlyList<FiringItem> firing;
        await using (var sweepScope = _scopeFactory.CreateAsyncScope())
        {
            var dbContext = sweepScope.ServiceProvider.GetRequiredService<PulseDbContext>();

            // Trusted server-side sweep across exercises: ids only, each then processed within its own scope.
            firing = await dbContext.InjectItems
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(item => item.Status == InjectStatuses.Firing && item.DeletedAt == null)
                .Select(item => new FiringItem(item.ExerciseId, item.Id))
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
        }

        foreach (var exercise in firing.GroupBy(item => item.ExerciseId))
        {
            if (exercise.Key == Guid.Empty
                || _pauseTiers.GetTier(exercise.Key) is PauseTier.Injects or PauseTier.Freeze)
            {
                continue;
            }

            try
            {
                await AdvanceExerciseAsync(exercise.Key, exercise.Select(item => item.ItemId), cancellationToken)
                    .ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
#pragma warning disable CA1031 // One exercise's fault must not stop pacing for the others.
            catch (Exception ex)
            {
                LogExerciseTickFailed(ex, exercise.Key);
            }
#pragma warning restore CA1031
        }
    }

    private async Task AdvanceExerciseAsync(
        Guid exerciseId,
        IEnumerable<Guid> itemIds,
        CancellationToken cancellationToken)
    {
        foreach (var itemId in itemIds)
        {
            // A fresh scope per item: each step owns a clean unit of work, so one item's conflict or fault cannot
            // leave tracked state behind for the next.
            await using var scope = _scopeFactory.CreateAsyncScope();

            // Set the server-authoritative scope BEFORE resolving anything that captures it (PulseDbContext reads it
            // in its constructor) — never a client value (COR-001).
            if (scope.ServiceProvider.GetRequiredService<IExerciseContext>() is ExerciseContext exerciseContext)
            {
                exerciseContext.CurrentExerciseId = exerciseId;
            }
            else
            {
                throw new InvalidOperationException(
                    "The registered IExerciseContext is not settable; the inject burst runner cannot establish its scope (COR-001).");
            }

            var queue = scope.ServiceProvider.GetRequiredService<InjectQueueService>();
            await queue.AdvanceAsync(itemId, cancellationToken).ConfigureAwait(false);
        }
    }

    [LoggerMessage(
        EventId = 1,
        Level = LogLevel.Warning,
        Message = "Inject burst runner tick failed; will retry on the next interval.")]
    private partial void LogTickFailed(Exception exception);

    [LoggerMessage(
        EventId = 2,
        Level = LogLevel.Error,
        Message = "Inject burst runner failed to advance exercise {ExerciseId}; other exercises were unaffected.")]
    private partial void LogExerciseTickFailed(Exception exception, Guid exerciseId);

    /// <summary>A firing item found by the discovery sweep — ids only.</summary>
    private sealed record FiringItem(Guid ExerciseId, Guid ItemId);
}
