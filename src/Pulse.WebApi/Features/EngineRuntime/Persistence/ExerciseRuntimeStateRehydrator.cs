namespace Pulse.WebApi.Features.EngineRuntime.Persistence;

using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using System.Diagnostics;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Pulse.WebApi.Features.EngineRuntime.Clock;
using Pulse.WebApi.Features.EngineRuntime.Steering;

/// <summary>
/// Puts every exercise's pause tier, scenario clock and participant holding page back after a restart
/// (demo-feedback story 18, DF-24..DF-27). An <see cref="IHostedService"/> whose whole job runs in
/// <see cref="StartAsync"/>: the host awaits each hosted service's <c>StartAsync</c> in registration order, so with
/// this service registered FIRST (seam S-5) the state is back before <c>ReactionLoopHost</c>,
/// <c>EngineReviewTickHost</c>, <c>InjectBurstRunner</c> or <c>WhiteNoisePacer</c> can tick.
/// </summary>
/// <remarks>
/// <para>
/// <b>Per exercise, exactly as persisted.</b> The tier comes back as it was (DF-26); a running clock comes back
/// advanced by the downtime and a frozen one at the same minute (DF-25, inside
/// <see cref="IExerciseClockPersistence.Restore"/>, which is not a <c>Start</c>, so the reaction loop's
/// <c>ShouldStartClock</c> leaves it alone); the overlay comes back with its sequence, and the next publish is the
/// persisted sequence + 1 (DF-27). Nothing here writes: restoring is in-memory only, and the restored state is what
/// the row already says.
/// </para>
/// <para>
/// <b>Startup never fails because of runtime state.</b> An unreadable table is logged at Error and the host starts
/// with every exercise Running (the pre-story-18 behaviour); a row for a missing exercise, or one that does not parse,
/// is logged and skipped while every other exercise is restored.
/// </para>
/// <para>
/// <b>Serverless resume (Gate-1 CR-1).</b> UAT's database auto-pauses; the first connection after a pause fails with
/// 40613 while it wakes. A TRANSIENT read failure (<see cref="TransientSqlErrors"/>) is therefore retried with a
/// doubling backoff for up to <see cref="ExerciseRuntimePersistenceOptions.RehydrateRetryBudgetSeconds"/> (default
/// 90 s, inside App Service's 230 s start limit), each retry logged at Warning. A non-transient failure (no connection
/// string, unknown host, missing table) fails fast with no retry.
/// </para>
/// <para>
/// <b>Fail-safe Freeze (Gate-1 M-2).</b> A row whose clock is frozen but whose tier is not <c>freeze</c> can only come
/// from a partly failed Freeze write; it is restored as Freeze, with the stored holding page (or the default
/// in-fiction pause page), and logged at Warning, so a restart never silently un-freezes a world. The mirror case
/// (re-review L-C) — tier <c>freeze</c> over a RUNNING clock, an Unfreeze whose tier write failed — re-freezes the
/// clock at its elapsed value (anchor + downtime), also logged at Warning.
/// </para>
/// <para>
/// <b>Isolation (COR-001).</b> The read is the store's one documented cross-exercise reader (read-only); each row is
/// applied to its OWN exercise's in-memory state, keyed by the row's id, so restoring A never touches B.
/// </para>
/// </remarks>
public sealed partial class ExerciseRuntimeStateRehydrator : IHostedService
{
    private readonly IExerciseRuntimeStateStore _store;
    private readonly PauseTierRegistry _pauseTiers;
    private readonly IExerciseClock _clock;
    private readonly OverlayStateService _overlayState;
    private readonly ILogger<ExerciseRuntimeStateRehydrator> _logger;
    private readonly ExerciseRuntimePersistenceOptions _options;

    /// <summary>Creates the rehydrator.</summary>
    /// <param name="store">The durable row store (its cross-exercise reader).</param>
    /// <param name="pauseTiers">The pause-tier registry to restore tiers into.</param>
    /// <param name="clock">The clock to restore anchors into (when it implements <see cref="IExerciseClockPersistence"/>).</param>
    /// <param name="overlayState">The overlay store to restore holding pages into.</param>
    /// <param name="logger">Logs every restored and skipped row.</param>
    /// <param name="options">Retry tuning; defaults apply when <c>null</c>.</param>
    public ExerciseRuntimeStateRehydrator(
        IExerciseRuntimeStateStore store,
        PauseTierRegistry pauseTiers,
        IExerciseClock clock,
        OverlayStateService overlayState,
        ILogger<ExerciseRuntimeStateRehydrator> logger,
        IOptions<ExerciseRuntimePersistenceOptions>? options = null)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(pauseTiers);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(overlayState);
        ArgumentNullException.ThrowIfNull(logger);

        _store = store;
        _pauseTiers = pauseTiers;
        _clock = clock;
        _overlayState = overlayState;
        _logger = logger;
        _options = options?.Value ?? new ExerciseRuntimePersistenceOptions();
    }

    /// <summary>Restores every persisted exercise; never throws for a data or database fault.</summary>
    /// <param name="cancellationToken">Signals the host is aborting startup.</param>
    /// <returns>A task that completes when every row has been restored or skipped.</returns>
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        await RehydrateAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    /// <summary>
    /// Reads every row and restores each exercise; the body of <see cref="StartAsync"/>, exposed so a test can drive
    /// a simulated restart directly.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>How many exercises were restored.</returns>
    public async Task<int> RehydrateAsync(CancellationToken cancellationToken = default)
    {
        var rows = await ReadWithRetriesAsync(cancellationToken).ConfigureAwait(false);
        if (rows is null)
        {
            return 0;
        }

        var persistableClock = _clock as IExerciseClockPersistence;
        var restored = 0;

        foreach (var persisted in rows)
        {
            var exerciseId = persisted.Row.ExerciseId;
            if (!persisted.ExerciseExists)
            {
                LogSkippedMissingExercise(exerciseId);
                continue;
            }

            if (!ExerciseRuntimeStateMapping.TryParse(persisted.Row, out var snapshot, out var reason))
            {
                LogSkippedUnparseable(exerciseId, reason);
                continue;
            }

            snapshot = FailSafeFreeze(snapshot);

            try
            {
                if (snapshot.Clock is { } anchor)
                {
                    if (persistableClock is null)
                    {
                        LogClockNotRestorable(exerciseId);
                    }
                    else
                    {
                        persistableClock.Restore(exerciseId, anchor);

                        // L-C: a Freeze tier over a RUNNING clock is an Unfreeze whose registry write failed — re-freeze
                        // the clock at the elapsed value it has now (anchor + downtime), in memory, with no write.
                        if (snapshot.Tier == PauseTier.Freeze && !anchor.Frozen
                            && persistableClock.GetAnchor(exerciseId) is { } running)
                        {
                            LogFailSafeRefreeze(exerciseId);
                            persistableClock.Restore(exerciseId, running with { Frozen = true });
                        }
                    }
                }

                _overlayState.Restore(exerciseId, snapshot.Overlay);
                _pauseTiers.Restore(exerciseId, snapshot.Tier);
                restored++;

                if (_logger.IsEnabled(LogLevel.Information))
                {
                    var clockState = snapshot.Clock is null ? "unstarted" : snapshot.Clock.Frozen ? "frozen" : "running";
                    var scenarioMinute = _clock.CurrentScenarioMinute(exerciseId);
                    LogRestored(
                        exerciseId, snapshot.Tier, clockState, scenarioMinute, snapshot.Overlay.State, snapshot.Overlay.Sequence);
                }
            }
#pragma warning disable CA1031 // One bad row must not stop every other exercise's restore.
            catch (Exception ex)
            {
                LogSkippedRestoreFailed(ex, exerciseId);
            }
#pragma warning restore CA1031
        }

        return restored;
    }

    /// <summary>
    /// M-2: a frozen clock under a non-Freeze tier is a partly failed Freeze write — restore it as Freeze, with the
    /// stored holding page or the default in-fiction pause page (keeping the stored sequence, so DF-27 still holds).
    /// </summary>
    private ExerciseRuntimeStateSnapshot FailSafeFreeze(ExerciseRuntimeStateSnapshot snapshot)
    {
        if (snapshot.Tier == PauseTier.Freeze)
        {
            // L-C: a restored Freeze always shows the holding page (the clock is re-frozen where it is applied).
            return snapshot.Overlay.State == OverlayStateWire.Pause
                ? snapshot
                : snapshot with
                {
                    Overlay = new OverlayStateSnapshot(
                        OverlayStateWire.Pause, OverlayStateWire.InFiction, string.Empty, snapshot.Overlay.Sequence),
                };
        }

        if (snapshot.Clock is not { Frozen: true })
        {
            return snapshot;
        }

        LogFailSafeFreeze(snapshot.ExerciseId, snapshot.Tier);
        var overlay = snapshot.Overlay.State == OverlayStateWire.Pause
            ? snapshot.Overlay
            : new OverlayStateSnapshot(OverlayStateWire.Pause, OverlayStateWire.InFiction, string.Empty, snapshot.Overlay.Sequence);
        return snapshot with { Tier = PauseTier.Freeze, Overlay = overlay };
    }

    /// <summary>
    /// Reads every row, retrying TRANSIENT failures within the configured budget (CR-1). Returns <c>null</c> when the
    /// read finally failed (already logged) or startup was cancelled.
    /// </summary>
    private async Task<System.Collections.Generic.IReadOnlyList<PersistedExerciseRuntimeState>?> ReadWithRetriesAsync(
        CancellationToken cancellationToken)
    {
        var budget = TimeSpan.FromSeconds(Math.Max(0, _options.RehydrateRetryBudgetSeconds));
        var delay = TimeSpan.FromMilliseconds(Math.Max(1, _options.RehydrateRetryInitialDelayMilliseconds));
        var maxDelay = TimeSpan.FromSeconds(15);
        var stopwatch = Stopwatch.StartNew();

        for (var attempt = 1; ; attempt++)
        {
            try
            {
                var rows = await _store.ReadAllForRehydrationAsync(cancellationToken).ConfigureAwait(false);
                if (attempt > 1)
                {
                    LogReadRecovered(attempt, (int)stopwatch.Elapsed.TotalSeconds);
                }

                return rows;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return null;
            }
#pragma warning disable CA1031 // Startup must never fail because of runtime state.
            catch (Exception ex)
            {
                var remaining = budget - stopwatch.Elapsed;
                if (!TransientSqlErrors.IsTransient(ex))
                {
                    LogReadFailed(ex);
                    return null;
                }

                if (remaining <= TimeSpan.Zero)
                {
                    LogReadGaveUp(ex, attempt, (int)budget.TotalSeconds);
                    return null;
                }

                var wait = delay < remaining ? delay : remaining;
                LogReadRetrying(ex, attempt, (int)wait.TotalMilliseconds, (int)remaining.TotalSeconds);
                try
                {
                    await Task.Delay(wait, cancellationToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return null;
                }

                delay = delay + delay > maxDelay ? maxDelay : delay + delay;
            }
#pragma warning restore CA1031
        }
    }

    /// <summary>Source-generated Warning: a transient read failure will be retried (CA1848).</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "The runtime-state rehydrator hit a transient SQL failure (attempt {Attempt}; the database may be " +
                  "resuming); retrying in {DelayMs} ms, {RemainingSeconds} s of the retry budget left.")]
    private partial void LogReadRetrying(Exception exception, int attempt, int delayMs, int remainingSeconds);

    /// <summary>Source-generated Information: the read succeeded after retries (CA1848).</summary>
    [LoggerMessage(
        Level = LogLevel.Information,
        Message = "The runtime-state rehydrator read ExerciseRuntimeStates on attempt {Attempt} after {ElapsedSeconds} s.")]
    private partial void LogReadRecovered(int attempt, int elapsedSeconds);

    /// <summary>Source-generated Error: the retry budget ran out (CA1848).</summary>
    [LoggerMessage(
        Level = LogLevel.Error,
        Message = "The runtime-state rehydrator GAVE UP after {Attempts} attempts ({BudgetSeconds} s budget) of transient " +
                  "SQL failures; every exercise starts Running with an unstarted clock and no holding page (the " +
                  "pre-restart state is NOT restored).")]
    private partial void LogReadGaveUp(Exception exception, int attempts, int budgetSeconds);

    /// <summary>Source-generated Warning: a Freeze tier over a running clock was re-frozen (CA1848).</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "The runtime-state row for exercise {ExerciseId} has tier Freeze but a RUNNING clock (a partly failed " +
                  "Unfreeze write); the clock was re-frozen fail-safe at its elapsed value.")]
    private partial void LogFailSafeRefreeze(Guid exerciseId);

    /// <summary>Source-generated Warning: a frozen clock under a non-Freeze tier was restored as Freeze (CA1848).</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "The runtime-state row for exercise {ExerciseId} has a FROZEN clock but tier {Tier} (a partly failed " +
                  "Freeze write); restored fail-safe as Freeze with the holding page.")]
    private partial void LogFailSafeFreeze(Guid exerciseId, PauseTier tier);

    /// <summary>Source-generated Error: the table could not be read; every exercise starts Running (CA1848).</summary>
    [LoggerMessage(
        Level = LogLevel.Error,
        Message = "The runtime-state rehydrator could not read ExerciseRuntimeStates (a non-transient failure, not " +
                  "retried); every exercise starts Running " +
                  "with an unstarted clock and no holding page (the pre-restart state is NOT restored).")]
    private partial void LogReadFailed(Exception exception);

    /// <summary>Source-generated warning: a row for a missing exercise was skipped (CA1848).</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "Skipped the runtime-state row for exercise {ExerciseId}: the exercise no longer exists.")]
    private partial void LogSkippedMissingExercise(Guid exerciseId);

    /// <summary>Source-generated warning: an unparseable row was skipped (CA1848).</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "Skipped the runtime-state row for exercise {ExerciseId}: {Reason}. The exercise starts Running.")]
    private partial void LogSkippedUnparseable(Guid exerciseId, string reason);

    /// <summary>Source-generated warning: applying a row failed (CA1848).</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "Skipped the runtime-state row for exercise {ExerciseId}: restoring it failed.")]
    private partial void LogSkippedRestoreFailed(Exception exception, Guid exerciseId);

    /// <summary>Source-generated warning: the registered clock cannot be restored (CA1848).</summary>
    [LoggerMessage(
        Level = LogLevel.Warning,
        Message = "The registered exercise clock cannot restore a persisted anchor; exercise {ExerciseId}'s clock " +
                  "was not restored.")]
    private partial void LogClockNotRestorable(Guid exerciseId);

    /// <summary>Source-generated audit line per restored exercise (CA1848).</summary>
    [LoggerMessage(
        Level = LogLevel.Information,
        Message = "Restored exercise {ExerciseId}: tier {Tier}, clock {ClockState} at scenario minute {ScenarioMinute}, " +
                  "overlay {OverlayState} (sequence {OverlaySequence}).")]
    private partial void LogRestored(
        Guid exerciseId, PauseTier tier, string clockState, int scenarioMinute, string overlayState, long overlaySequence);
}
