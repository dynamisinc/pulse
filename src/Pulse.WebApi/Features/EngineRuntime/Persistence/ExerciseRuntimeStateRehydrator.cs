namespace Pulse.WebApi.Features.EngineRuntime.Persistence;

using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
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

    /// <summary>Creates the rehydrator.</summary>
    /// <param name="store">The durable row store (its cross-exercise reader).</param>
    /// <param name="pauseTiers">The pause-tier registry to restore tiers into.</param>
    /// <param name="clock">The clock to restore anchors into (when it implements <see cref="IExerciseClockPersistence"/>).</param>
    /// <param name="overlayState">The overlay store to restore holding pages into.</param>
    /// <param name="logger">Logs every restored and skipped row.</param>
    public ExerciseRuntimeStateRehydrator(
        IExerciseRuntimeStateStore store,
        PauseTierRegistry pauseTiers,
        IExerciseClock clock,
        OverlayStateService overlayState,
        ILogger<ExerciseRuntimeStateRehydrator> logger)
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
        System.Collections.Generic.IReadOnlyList<PersistedExerciseRuntimeState> rows;
        try
        {
            rows = await _store.ReadAllForRehydrationAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return 0;
        }
#pragma warning disable CA1031 // Startup must never fail because of runtime state.
        catch (Exception ex)
        {
            LogReadFailed(ex);
            return 0;
        }
#pragma warning restore CA1031

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

    /// <summary>Source-generated Error: the table could not be read; every exercise starts Running (CA1848).</summary>
    [LoggerMessage(
        Level = LogLevel.Error,
        Message = "The runtime-state rehydrator could not read ExerciseRuntimeStates; every exercise starts Running " +
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
